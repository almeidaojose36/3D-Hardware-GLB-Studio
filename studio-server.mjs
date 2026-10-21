#!/usr/bin/env node
// ============================================================================
// Classroom 3D Hardware GLB Studio: local server
// ============================================================================
// Serves the studio page and brokers requests to AI services, so API keys stay on this machine and
// never reach the browser (the providers also refuse direct browser calls). Requires Node 20+ (it uses
// the built-in fetch / FormData / Blob, and the Anthropic SDK needs 20). The image-to-3D generators need
// no npm install; the AI Builder needs the Anthropic SDK (run npm install once).
//
//   node studio-server.mjs        then open http://localhost:8787
//
// Keys are read from environment variables or from a .env file next to this script:
//   ANTHROPIC_API_KEY=sk-ant-...  AI Builder: Claude writes the model's procedural code from photos
//   MESHY_API_KEY=msy_...         Meshy Image-to-3D (msy_dummy_api_key_for_test_mode_12345678 is
//                                 Meshy's free test key: it returns their sample model, no credits)
//   STABILITY_API_KEY=sk-...      Stability AI Stable Fast 3D
// Optional: PORT (default 8787), HOST (default 127.0.0.1, i.e. this computer only) and, when serving
// other machines, ALLOWED_HOSTS=myserver.local:8787,192.168.1.20:8787 (the addresses they will type).
// AI_BUILDER_MODEL and AI_BUILDER_EFFORT override the AI Builder's Claude model and effort level.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_FILE = path.join(ROOT, '3d_hardware_glb_studio_procedural_builder.html');
const GUIDE_FILE = path.join(ROOT, 'ai-builder-guide.md');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // provider upload limit
const MAX_BODY_BYTES = 30 * 1024 * 1024; // base64 inflates the image by ~4/3
const MAX_MODEL_BYTES = 250 * 1024 * 1024;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000;
const MESHY_TEST_KEY = 'msy_dummy_api_key_for_test_mode_12345678';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// ----------------------------------------------------------------------------
// Provider adapters. start() kicks off generation and returns 'done' once job.glb holds the model or
// 'running' when the caller should keep calling poll() until it returns 'done'. Base URLs can be
// overridden (MESHY_API_BASE / STABILITY_API_BASE) to point at a test double.
// ----------------------------------------------------------------------------
const PROVIDERS = {
  meshy: {
    name: 'Meshy Image-to-3D',
    detail: 'Textured PBR model, typically 1-4 minutes',
    key: () => process.env.MESHY_API_KEY,
    base: () => process.env.MESHY_API_BASE || 'https://api.meshy.ai',
    testMode: () => process.env.MESHY_API_KEY === MESHY_TEST_KEY,

    async start(job, image, options) {
      const res = await providerFetch(`${this.base()}/openapi/v1/image-to-3d`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: image.dataUri,
          should_texture: true,
          enable_pbr: options.pbr !== false,
          should_remesh: true,
          target_polycount: clampInt(options.polycount, 1000, 300000, 30000),
          target_formats: ['glb']
        })
      });
      const body = await res.json().catch(() => null);
      if (!body || !body.result) throw new Error('Meshy accepted the request but returned no task id');
      job.remoteId = String(body.result);
      job.message = 'Queued at Meshy…';
      return 'running';
    },

    async poll(job) {
      const res = await providerFetch(`${this.base()}/openapi/v1/image-to-3d/${encodeURIComponent(job.remoteId)}`, {
        headers: { Authorization: `Bearer ${this.key()}` }
      });
      const task = await res.json().catch(() => ({}));
      if (Number.isFinite(Number(task.progress))) job.progress = Math.min(99, Number(task.progress));
      if (task.status === 'SUCCEEDED') {
        const url = task.model_urls && task.model_urls.glb;
        if (!url) throw new Error('Meshy finished but did not provide a .glb download');
        job.message = 'Downloading model…';
        job.glb = await downloadModel(url);
        return 'done';
      }
      if (['FAILED', 'CANCELED', 'EXPIRED'].includes(task.status)) {
        throw new Error((task.task_error && task.task_error.message) || `Meshy task ${String(task.status).toLowerCase()}`);
      }
      job.message = task.status === 'PENDING' ? 'Queued at Meshy…' : 'Generating mesh and textures…';
      return 'running';
    }
  },

  stability: {
    name: 'Stability AI · Stable Fast 3D',
    detail: 'Fast single-image reconstruction, typically under 30 seconds',
    key: () => process.env.STABILITY_API_KEY,
    base: () => process.env.STABILITY_API_BASE || 'https://api.stability.ai',
    testMode: () => false,

    // Synchronous: the response body is the finished binary glTF
    async start(job, image, options) {
      const form = new FormData();
      form.append('image', new Blob([image.bytes], { type: image.mime }), `upload.${image.ext}`);
      form.append('texture_resolution', String([512, 1024, 2048].includes(Number(options.textureResolution)) ? Number(options.textureResolution) : 1024));
      form.append('foreground_ratio', '0.85');
      form.append('remesh', 'none');
      job.message = 'Reconstructing 3D model…';
      const res = await providerFetch(`${this.base()}/v2beta/3d/stable-fast-3d`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key()}` },
        body: form
      });
      job.glb = await readLimited(res, MAX_MODEL_BYTES);
      return 'done';
    }
  }
};

// fetch with a timeout that turns provider error responses into readable messages
async function providerFetch(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(180000) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timed out' : (err.cause && err.cause.code) || err.message;
    throw new Error(`Could not reach ${new URL(url).host} (${reason})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.message || (Array.isArray(json.errors) ? json.errors.join('; ') : '') || json.name || text;
    } catch {
      // not JSON: keep the raw text
    }
    const hint = {
      401: ' Check the API key in .env.',
      402: ' The provider account is out of credits.',
      403: ' The API key is not allowed to use this endpoint.',
      429: ' Rate limited; wait a moment and try again.'
    }[res.status] || '';
    throw new Error(`Provider returned ${res.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}.${hint}`);
  }
  return res;
}

async function readLimited(res, limit) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > limit) throw new Error('Generated model is larger than the 250 MB limit');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('Generated model is larger than the 250 MB limit');
  return buf;
}

async function downloadModel(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Provider returned an invalid model URL');
  return readLimited(await providerFetch(url, {}), MAX_MODEL_BYTES);
}

// ----------------------------------------------------------------------------
// Jobs: generation runs in the background; the browser polls the job and then downloads the GLB
// from this server (signed provider URLs expire and are not readable cross-origin)
// ----------------------------------------------------------------------------
const jobs = new Map();

async function runJob(job, provider, image, options) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  try {
    let state = await provider.start(job, image, options);
    while (state !== 'done') {
      if (job.cancelled) return;
      if (Date.now() > deadline) throw new Error('Generation took longer than 30 minutes and was abandoned');
      await sleep(POLL_MS);
      if (job.cancelled) return;
      state = await provider.poll(job);
    }
    if (!job.glb || job.glb.length < 12 || job.glb.toString('ascii', 0, 4) !== 'glTF') {
      throw new Error('Provider response was not a binary glTF (.glb) file');
    }
    job.status = 'succeeded';
    job.progress = 100;
    job.message = 'Model ready';
    log(job, `succeeded (${(job.glb.length / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.glb = null;
    log(job, `failed: ${err.message}`);
  }
}

function log(job, text) {
  console.log(`[${new Date().toLocaleTimeString()}] ${job.provider} ${job.id.slice(0, 8)} ${text}`);
}

// Accepts a data URI and checks it really is a PNG / JPEG / WebP within the provider size limit
function parseImage(dataUri) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUri || ''));
  if (!m) throw new HttpError(400, 'Image must be a PNG, JPEG or WebP data URI');
  const bytes = Buffer.from(m[3], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is larger than 20 MB');
  const magic = {
    png: bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG',
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8,
    webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  }[m[2]];
  if (!magic) throw new HttpError(400, 'Image data does not match its declared type');
  return { dataUri: `data:${m[1]};base64,${bytes.toString('base64')}`, bytes, mime: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2] };
}

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}, 5 * 60 * 1000).unref();

// ----------------------------------------------------------------------------
// AI Builder: Claude studies the photos and writes a buildModel() function against the studio's
// modelling toolkit. The browser runs each version in its sandbox, renders it from fixed angles and
// posts the views back here; they go to Claude as the tool result, so it can compare its model with
// the photos and revise until it accepts a version or the refinement budget is used up.
// ----------------------------------------------------------------------------
let Anthropic = null;
try {
  ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
} catch {
  // Optional dependency: only the AI Builder needs it (npm install)
}

const BUILDER = {
  model: process.env.AI_BUILDER_MODEL || 'claude-opus-5-5',
  effort: process.env.AI_BUILDER_EFFORT || 'high',
  maxRounds: 5,
  maxRepairs: 3, // extra submissions allowed for build errors and malformed submissions
  maxPhotos: 4,
  maxConcurrent: 2, // each job spends API credits: keep accidental parallel runs bounded
  maxPhotoBytes: 3.75 * 1024 * 1024, // API limit is 5 MB of base64 per image
  maxViewBytes: 2 * 1024 * 1024,
  renderTimeoutMs: 10 * 60 * 1000,
  abandonAfterMs: 3 * 60 * 1000, // stop paying for a job whose studio tab stopped polling
  // Estimated USD per million tokens, for the running cost shown in the studio
  prices: {
    'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 }
  }
};

const builderInfo = () => ({
  id: 'ai-builder',
  name: 'AI Builder · Claude writes CAD code',
  detail:
    'Claude studies your photos and writes procedural CAD code with the studio toolkit, then refines it from studio renders; ' +
    'typically 5-15 minutes and roughly $1-3 per model at the default settings',
  configured: Boolean(process.env.ANTHROPIC_API_KEY && Anthropic),
  setup: !process.env.ANTHROPIC_API_KEY ? 'add API key' : !Anthropic ? 'run npm install' : undefined,
  testMode: false
});

let anthropicClient = null;
function anthropic() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
      maxRetries: 3
    });
  }
  return anthropicClient;
}

// strict + auto tool choice: this model rejects forced tool use, so the prompt asks for the call and
// the schema guarantees its shape. Inputs stream eagerly (the code is long) and are validated here.
const BUILDER_TOOLS = [
  {
    name: 'submit_model',
    description:
      'Submit a complete version of the model. The studio runs the code in its sandbox, exports the result as .glb and ' +
      'replies with build statistics and six studio renders, five fixed angles plus an exploded view (or the error if it failed to build). ' +
      'Always send the complete program, never a diff.',
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short display name, e.g. "Dual-Fan Graphics Card"' },
        subtitle: { type: 'string', description: 'One line naming the key features, in the style of the built-in models' },
        notes: {
          type: 'string',
          description: 'Shown to the user while they wait: in the first version what you identified in the photos, later what you changed and why. 1-3 sentences.'
        },
        summary: { type: 'string', description: 'One or two sentences for students: what the object is and what it does' },
        callouts: {
          type: 'array',
          description: '2-5 teaching callouts pinned to features of the model',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pos: { type: 'array', items: { type: 'number' }, description: '[x, y, z] point on the feature, in the coordinates buildModel() builds in' },
              tag: { type: 'string', description: 'Feature name, a few words' },
              desc: { type: 'string', description: 'One or two sentences explaining the feature' }
            },
            required: ['pos', 'tag', 'desc']
          }
        },
        code: { type: 'string', description: 'Complete JavaScript source that defines a top-level function buildModel() returning the model' }
      },
      required: ['title', 'subtitle', 'notes', 'summary', 'callouts', 'code']
    }
  },
  {
    name: 'accept_model',
    description: 'Finish: keep one of the versions that built successfully as the final model. Use it when the renders match the reference photos well.',
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', description: 'The version number to keep, normally the latest' },
        reason: { type: 'string', description: 'One sentence on why it is good enough' }
      },
      required: ['version', 'reason']
    }
  }
];

// The guide plus the toolkit source, read from the studio page so the two never drift apart. Each job
// keeps its own copy: the system prompt must stay byte-identical across the job's turns.
function builderSystemPrompt() {
  const guide = fs.readFileSync(GUIDE_FILE, 'utf8').trim();
  const toolkit = /<script id="studio-toolkit">([\s\S]*?)<\/script>/.exec(fs.readFileSync(STUDIO_FILE, 'utf8'));
  if (!toolkit) throw new Error('The studio page has no studio-toolkit script');
  return `${guide}\n\n<studio_toolkit>\n${toolkit[1].trim()}\n</studio_toolkit>`;
}

const clip = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

// The schema fixes the shape; this trims lengths and checks what JSON Schema cannot
function cleanSubmission(input) {
  if (!input || typeof input.code !== 'string') return { problem: 'submit_model needs the complete program in "code".' };
  const code = input.code;
  if (code.length < 40) return { problem: 'The code is empty or truncated. Send the complete program.' };
  if (code.length > 400000) return { problem: 'The code is longer than 400 KB. Share geometry and use loops instead of repeating code.' };
  if (!/\bbuildModel\b/.test(code)) return { problem: 'The code must define a top-level function buildModel() that returns the model.' };
  const callouts = (Array.isArray(input.callouts) ? input.callouts : [])
    .filter((c) => c && Array.isArray(c.pos) && c.pos.length === 3 && c.pos.every(Number.isFinite))
    .slice(0, 8)
    .map((c) => ({ pos: c.pos, tag: clip(c.tag, 60), desc: clip(c.desc, 400) }));
  return {
    submission: {
      title: clip(input.title, 80) || 'AI-built model',
      subtitle: clip(input.subtitle, 140),
      notes: clip(input.notes, 1500),
      summary: clip(input.summary, 600),
      callouts,
      code
    }
  };
}

// Compile without running, so syntax errors come back with the line and a caret
function syntaxProblem(code) {
  try {
    new vm.Script(code, { filename: 'model.js' });
    return null;
  } catch (err) {
    if (!(err instanceof SyntaxError)) return `${err.name}: ${err.message}`;
    const [where] = String(err.stack).split('\n\n');
    return `SyntaxError: ${err.message}\n${where.replace(/^model\.js:(\d+)/, 'at line $1:')}`;
  }
}

// With server-side fallbacks, usage.iterations lists every billed attempt (a declined attempt is billed
// too); the top-level figures then cover only the attempt that produced the reply
function addUsage(job, usage) {
  if (!usage) return;
  const entries = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  for (const u of entries) {
    job.usage.input += u.input_tokens || 0;
    job.usage.output += u.output_tokens || 0;
    job.usage.cacheRead += u.cache_read_input_tokens || 0;
    const split = u.cache_creation || {};
    if (Number.isFinite(split.ephemeral_1h_input_tokens) || Number.isFinite(split.ephemeral_5m_input_tokens)) {
      job.usage.cacheWrite1h += split.ephemeral_1h_input_tokens || 0;
      job.usage.cacheWrite5m += split.ephemeral_5m_input_tokens || 0;
    } else {
      job.usage.cacheWrite1h += u.cache_creation_input_tokens || 0;
    }
  }
}

// Which failed turns are worth sending again unchanged (the history only grows after a turn succeeds)
function retryReason(err) {
  if (err instanceof Anthropic.APIUserAbortError) return null;
  if (err instanceof Anthropic.APIConnectionError) return 'connection lost';
  if (err instanceof Anthropic.APIError) {
    // An error event in the middle of a stream (overloaded, internal) has no HTTP status
    return err.status === undefined || err.status === 429 || err.status >= 500 ? 'temporary API error' : null;
  }
  // Otherwise the SDK could not parse a streamed tool input (eager input streaming) or the stream broke off
  return 'incomplete response';
}

function costUsd(job) {
  const p = BUILDER.prices[BUILDER.model];
  if (!p) return null;
  const u = job.usage;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite1h * p.cacheWrite1h + u.cacheWrite5m * p.cacheWrite5m) / 1e6;
}

function describeApiError(err) {
  if (!Anthropic || !(err instanceof Anthropic.APIError)) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.';
  if (err instanceof Anthropic.PermissionDeniedError) return `This API key is not allowed to use ${BUILDER.model}: ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached; wait a minute and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check the internet connection.';
  return `Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`;
}

const builderJobs = new Map();

function remainingAttempts(job) {
  return job.maxRounds + BUILDER.maxRepairs - job.attempts;
}

// One Claude turn. Ends with the job awaiting a render, done, or (via the thrown error) failed.
async function runBuilderTurn(job) {
  job.status = 'thinking';
  job.live = { thinking: '', codeChars: 0 };
  job.message = job.round === 0 ? 'Claude is studying your photos…' : 'Claude is revising the model…';

  let message;
  for (let attempt = 0; ; attempt++) {
    try {
      message = await streamTurn(job);
      break;
    } catch (err) {
      if (job.cancelled) return;
      const reason = retryReason(err);
      if (!reason || attempt >= 3) throw err;
      log(job, `${reason}, re-issuing the turn (${err.message})`);
      await sleep(2000 * 2 ** attempt);
      if (job.cancelled) return;
    }
  }
  if (job.cancelled) return;
  addUsage(job, message.usage);
  const u = message.usage || {};
  log(job, `turn done: ${message.stop_reason}, out ${u.output_tokens} tok, in ${u.input_tokens} + cache ${u.cache_read_input_tokens || 0} read / ${u.cache_creation_input_tokens || 0} written`);

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details && message.stop_details.category;
    throw new Error(`Claude declined to build this model${category ? ` (${category})` : ''}. Try other photos or notes.`);
  }
  const calls = message.content.filter((b) => b.type === 'tool_use');
  // A tool input cut off at max_tokens can still parse as a valid object: never run it
  if (message.stop_reason === 'max_tokens' && calls.length) {
    if (job.maxTokens >= 128000) throw new Error('Claude ran out of output space while writing the code.');
    job.maxTokens = 128000;
    log(job, 'tool input truncated at max_tokens, retrying the turn with more room');
    return runBuilderTurn(job);
  }

  // An empty reply cannot stay in the history (the API rejects empty non-final messages)
  if (message.content.length) job.messages.push({ role: 'assistant', content: message.content });
  if (!calls.length) {
    if (job.nudges++ >= 2) throw new Error('Claude stopped without submitting a model.');
    job.messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Please call submit_model now with the complete code (or accept_model to keep a version that built).' }]
    });
    return runBuilderTurn(job);
  }

  // At most one call per turn is requested; answer any extras so the history stays valid
  const call = calls[calls.length - 1];
  const extraResults = calls.slice(0, -1).map((c) => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Ignored: only one tool call is handled per turn.' }));
  const replyAndRetry = (text) => {
    job.attempts++;
    if (remainingAttempts(job) <= 0) return finishOrFail(job, `Stopped after ${job.attempts} attempts.`);
    job.messages.push({
      role: 'user',
      content: [...extraResults, { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `${text}\n(${remainingAttempts(job)} attempt(s) left)` }]
    });
    return runBuilderTurn(job);
  };

  if (call.name === 'accept_model') {
    const chosen = job.good.get(Number(call.input && call.input.version));
    if (!chosen) {
      const built = [...job.good.keys()];
      return replyAndRetry(
        built.length
          ? `Version ${call.input && call.input.version} did not build. Versions that built: ${built.join(', ')}. Accept one of those or submit a fixed version.`
          : 'No version has built successfully yet. Fix the errors and call submit_model.'
      );
    }
    job.final = chosen;
    finishJob(job, `accepted version ${chosen.round}: ${clip(call.input.reason, 200)}`);
    return;
  }
  if (call.name !== 'submit_model') return replyAndRetry(`Unknown tool ${call.name}. Use submit_model or accept_model.`);

  const { submission, problem } = cleanSubmission(call.input);
  if (problem) return replyAndRetry(problem);
  const syntax = syntaxProblem(submission.code);
  if (syntax) return replyAndRetry(`The code does not compile, so it was not run:\n${syntax}\nFix it and call submit_model with the complete corrected code.`);

  job.attempts++;
  job.round++;
  job.pending = { ...submission, round: job.round, toolUseId: call.id, extraResults, last: job.versions + 1 >= job.maxRounds };
  job.status = 'awaiting-render';
  job.message = `Building version ${job.round}…`;
  job.renderDeadline = Date.now() + BUILDER.renderTimeoutMs;
  log(job, `version ${job.round} submitted (${(submission.code.length / 1024).toFixed(1)} KB of code)`);
}

async function streamTurn(job) {
  const stream = anthropic().beta.messages.stream(
    {
      model: BUILDER.model,
      max_tokens: job.maxTokens,
      // If a safety classifier declines a turn, the API re-runs it on its recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: BUILDER.effort },
      // One-hour cache: a turn plus building and rendering can outlast the five-minute default. The
      // marker on the system prompt shares it across jobs; the automatic one covers the conversation.
      cache_control: { type: 'ephemeral', ttl: '1h' },
      system: [{ type: 'text', text: job.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools: BUILDER_TOOLS,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: job.messages
    },
    { signal: job.abort.signal }
  );
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        job.message = event.content_block.name === 'submit_model' ? `Claude is writing version ${job.round + 1}…` : 'Claude is choosing the final version…';
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') job.live.thinking = (job.live.thinking + event.delta.thinking).slice(-600);
        else if (event.delta.type === 'input_json_delta') job.live.codeChars += event.delta.partial_json.length;
      }
    }
    return await stream.finalMessage();
  } catch (err) {
    // A failed attempt is still billed for what it produced
    const partial = stream.currentMessage;
    if (partial) addUsage(job, partial.usage);
    throw err;
  }
}

// Browser report for the pending version: stats and studio views, or the build error
function acceptRender(job, report) {
  const sub = job.pending;
  if (job.status !== 'awaiting-render' || !sub) throw new HttpError(409, 'No version is waiting for a render');
  if (Number(report.round) !== sub.round) throw new HttpError(409, `Expected the render of version ${sub.round}`);

  let content;
  let isError = false;
  if (report.ok) {
    const views = (Array.isArray(report.views) ? report.views : []).slice(0, 6).map((view) => {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(view && view.image));
      const bytes = m && Buffer.from(m[1], 'base64');
      if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > BUILDER.maxViewBytes) throw new HttpError(400, 'Views must be JPEG data URIs under 2 MB');
      return { label: clip(view.label, 120), data: bytes.toString('base64') };
    });
    if (!views.length) throw new HttpError(400, 'A successful render needs at least one view');
    job.pending = null;
    job.versions++;
    job.good.set(sub.round, sub);
    const remaining = job.maxRounds - job.versions;
    if (remaining <= 0) {
      job.final = sub;
      finishJob(job, `refinement budget used; keeping version ${sub.round}`);
      return;
    }
    content = [{ type: 'text', text: describeRender(sub, report, views, remaining) }, ...views.map((v) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: v.data } }))];
  } else {
    job.pending = null;
    isError = true;
    const logs = (Array.isArray(report.logs) ? report.logs : []).slice(0, 20).map((l) => clip(l, 300));
    if (remainingAttempts(job) <= 0) {
      finishOrFail(job, `Version ${sub.round} failed to build and no attempts are left: ${clip(report.error, 300)}`);
      return;
    }
    content =
      `Version ${sub.round} failed in the sandbox:\n${clip(report.error, 2000)}` +
      (logs.length ? `\n\nConsole output:\n${logs.join('\n')}` : '') +
      `\n\nFix the problem and call submit_model with the complete corrected code. (${remainingAttempts(job)} attempt(s) left)`;
  }
  job.messages.push({ role: 'user', content: [...sub.extraResults, { type: 'tool_result', tool_use_id: sub.toolUseId, is_error: isError, content }] });
  runBuilderTurn(job).catch((err) => endWithError(job, err));
}

function describeRender(sub, report, views, remaining) {
  const s = report.stats || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : '?');
  const vec = (v) => (Array.isArray(v) ? v.map(n).join(', ') : '?');
  const parts = (Array.isArray(s.parts) ? s.parts : [])
    .filter((p) => p && typeof p === 'object')
    .slice(0, 30)
    .map((p) => `${clip(p.name, 60)} (${n(p.meshes)} meshes${Array.isArray(p.explode) ? `, explodes by ${vec(p.explode)}` : ', no explode offset'})`);
  const warnings = (Array.isArray(s.warnings) ? s.warnings : []).slice(0, 12).map((w) => clip(w, 200));
  const logs = (Array.isArray(report.logs) ? report.logs : []).slice(0, 20).map((l) => clip(l, 300));
  const size = Array.isArray(s.size) ? s.size.map(n) : ['?', '?', '?'];
  return [
    `Version ${sub.round} built in ${n(report.buildMs)} ms and exported to .glb.`,
    `Stats: ${n(s.meshes)} meshes, ${n(s.triangles)} triangles, ${n(s.materials)} materials, ${n(s.textures)} textures.`,
    `Bounding box: ${size[0]} wide (X) × ${size[1]} tall (Y) × ${size[2]} deep (Z) units, centred at (${vec(s.centre)}).`,
    `Top-level parts: ${parts.join('; ') || 'none'}.`,
    warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'Warnings: none.',
    logs.length ? `Console output:\n${logs.join('\n')}` : '',
    `The ${views.length} images after this text are studio renders of version ${sub.round}, in order: ${views.map((v, i) => `${i + 1}) ${v.label}`).join('; ')}.`,
    `Compare them with the reference photos. Check overall proportions and silhouette first, then missing or misplaced major parts, then colours and materials, then fine detail.`,
    remaining === 1
      ? `If it matches the photos well, call accept_model with version ${sub.round}. Otherwise call submit_model with complete revised code; that will be the final version and is saved without another review, so make it complete.`
      : `If it matches the photos well, call accept_model with version ${sub.round}. Otherwise call submit_model with complete revised code (${remaining} more versions available), fixing the biggest differences first.`
  ]
    .filter(Boolean)
    .join('\n');
}

function finishJob(job, reason) {
  job.status = 'done';
  job.message = 'Model ready';
  job.live = null;
  log(job, `done (${reason}); ≈ $${(costUsd(job) || 0).toFixed(2)}`);
}

// Out of attempts: keep the best version that built, if any
function finishOrFail(job, reason) {
  const latest = [...job.good.values()].pop();
  if (latest) {
    job.final = latest;
    finishJob(job, `${reason} Keeping version ${latest.round}.`);
  } else {
    failJob(job, new Error(`${reason} No version built successfully.`));
  }
}

// A turn that cannot continue ends the job, keeping the latest version that built (already paid for)
function endWithError(job, err) {
  if (job.cancelled || job.status === 'done' || job.status === 'failed') return;
  if (!job.good.size) {
    failJob(job, err);
    return;
  }
  job.notice = `Claude stopped early (${describeApiError(err)}), so the latest version that built was kept.`;
  finishOrFail(job, 'Stopped early.');
}

function failJob(job, err) {
  if (job.cancelled || job.status === 'done' || job.status === 'failed') return;
  job.status = 'failed';
  job.error = describeApiError(err);
  job.live = null;
  log(job, `failed: ${job.error}`);
}

function publicSubmission(sub) {
  if (!sub) return null;
  const { round, title, subtitle, notes, summary, callouts, code, last } = sub;
  return { round, title, subtitle, notes, summary, callouts, code, last };
}

function builderState(job) {
  const u = job.usage;
  return {
    status: job.status,
    message: job.message,
    error: job.error,
    model: BUILDER.model,
    maxRounds: job.maxRounds,
    versions: job.versions,
    round: job.round,
    live: job.status === 'thinking' && job.live ? { thinking: job.live.thinking.slice(-400), codeChars: job.live.codeChars } : null,
    submission: job.status === 'awaiting-render' ? publicSubmission(job.pending) : null,
    result: job.status === 'done' ? publicSubmission(job.final) : null,
    notice: job.notice || null,
    usage: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite1h + u.cacheWrite5m },
    costUsd: costUsd(job)
  };
}

function createBuilderJob(body) {
  const info = builderInfo();
  if (!info.configured) {
    throw new HttpError(400, Anthropic ? 'The AI Builder needs ANTHROPIC_API_KEY in .env' : 'The AI Builder needs the Anthropic SDK: run npm install in the studio folder, then restart the server');
  }
  const active = [...builderJobs.values()].filter((j) => j.status === 'thinking' || j.status === 'awaiting-render');
  if (active.length >= BUILDER.maxConcurrent) throw new HttpError(429, 'Two AI Builder jobs are already running; wait for one to finish');
  const photos = Array.isArray(body.images) ? body.images : [];
  if (!photos.length || photos.length > BUILDER.maxPhotos) throw new HttpError(400, `Send between 1 and ${BUILDER.maxPhotos} photos`);
  const images = photos.map(parseImage);
  if (images.some((img) => img.bytes.length > BUILDER.maxPhotoBytes)) throw new HttpError(413, 'Each photo must be under 3.75 MB for the AI Builder');
  const maxRounds = clampInt(body.maxRounds, 1, BUILDER.maxRounds, 3);
  const name = clip(body.name, 48).replace(/[^A-Za-z0-9_]+/g, '_') || 'AI_Model';
  const notes = clip(body.notes, 600);

  const brief = [
    `Build a 3D model of the object in the reference photo${images.length > 1 ? 's' : ''} above.`,
    `Model name: ${name}`,
    `What the user says it is: ${notes || 'not specified; identify it from the photos'}`,
    maxRounds === 1
      ? 'You have one version: it is built and saved without a review round, so make it as complete and accurate as you can.'
      : `You can submit up to ${maxRounds} versions. After each one you will see six studio renders of it (five fixed angles and an exploded view) to compare with the photos.`,
    'Start by studying the photos: identify the object, its real-world dimensions, its major sub-assemblies, materials, colours and distinctive details. Then call submit_model with your first complete version.'
  ].join('\n');

  const job = {
    id: crypto.randomUUID(),
    provider: 'ai-builder',
    status: 'thinking',
    message: 'Starting…',
    error: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    maxRounds,
    maxTokens: 64000,
    system: builderSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          ...images.flatMap((img, i) => [
            { type: 'text', text: `Reference photo ${i + 1} of ${images.length}:` },
            { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.bytes.toString('base64') } }
          ]),
          { type: 'text', text: brief }
        ]
      }
    ],
    round: 0,
    versions: 0,
    attempts: 0,
    nudges: 0,
    pending: null,
    good: new Map(),
    final: null,
    notice: null,
    live: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0 },
    abort: new AbortController(),
    cancelled: false
  };
  builderJobs.set(job.id, job);
  log(job, `started (${images.length} photo(s), up to ${maxRounds} version(s), ${BUILDER.model} at ${BUILDER.effort} effort)`);
  runBuilderTurn(job).catch((err) => endWithError(job, err));
  return job;
}

function cancelBuilderJob(job, reason) {
  job.cancelled = true;
  job.abort.abort();
  builderJobs.delete(job.id);
  log(job, reason);
}

setInterval(() => {
  const now = Date.now();
  for (const job of builderJobs.values()) {
    const active = job.status === 'thinking' || job.status === 'awaiting-render';
    if (active && now - job.lastSeen > BUILDER.abandonAfterMs) cancelBuilderJob(job, 'abandoned: the studio tab stopped checking on it');
    else if (job.status === 'awaiting-render' && now > job.renderDeadline) endWithError(job, new Error('The studio tab did not report the render in time.'));
    // Finished jobs stay readable for an hour after the tab last asked about them
    else if (!active && now - job.lastSeen > JOB_TTL_MS) builderJobs.delete(job.id);
  }
}, 30 * 1000).unref();

// ----------------------------------------------------------------------------
// HTTP server
// ----------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  if (!/^application\/json\b/.test(String(req.headers['content-type']))) throw new HttpError(415, 'Expected JSON');
  try {
    return JSON.parse((await readBody(req)).toString('utf8'));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Malformed JSON');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Only answer requests addressed to this server by name (blocks DNS-rebinding) and only accept API
// writes from the studio page itself: the custom header forces a CORS preflight, which this server
// never approves, so other websites open in the browser cannot spend the API credits.
function checkRequest(req, isWrite) {
  const allowedHosts = new Set([
    `localhost:${PORT}`,
    `127.0.0.1:${PORT}`,
    `[::1]:${PORT}`,
    `${HOST}:${PORT}`,
    ...String(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  ]);
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) throw new HttpError(403, 'Unexpected Host header');
  if (!isWrite) return;
  if (req.headers['x-studio-client'] !== '1') throw new HttpError(403, 'Missing studio client header');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Cross-origin request refused');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const route = url.pathname;
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
    checkRequest(req, isWrite);

    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(STUDIO_FILE).pipe(res);
      return;
    }

    if (req.method === 'GET' && route === '/api/providers') {
      sendJSON(res, 200, {
        providers: [
          builderInfo(),
          ...Object.entries(PROVIDERS).map(([id, p]) => ({
            id,
            name: p.name,
            detail: p.detail,
            configured: Boolean(p.key()),
            testMode: Boolean(p.key()) && p.testMode()
          }))
        ]
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/ai-builder') {
      const job = createBuilderJob(await readJSON(req));
      sendJSON(res, 202, { jobId: job.id });
      return;
    }

    const builderMatch = /^\/api\/ai-builder\/([0-9a-f-]{36})(\/render)?$/.exec(route);
    if (builderMatch) {
      const job = builderJobs.get(builderMatch[1]);
      if (!job) throw new HttpError(404, 'Unknown or expired AI Builder job');
      job.lastSeen = Date.now();
      if (req.method === 'GET' && !builderMatch[2]) {
        sendJSON(res, 200, builderState(job));
        return;
      }
      if (req.method === 'POST' && builderMatch[2]) {
        acceptRender(job, await readJSON(req));
        sendJSON(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE' && !builderMatch[2]) {
        cancelBuilderJob(job, 'cancelled');
        sendJSON(res, 200, { cancelled: true });
        return;
      }
    }

    if (req.method === 'POST' && route === '/api/image-to-3d') {
      const body = await readJSON(req);
      const provider = PROVIDERS[body.provider];
      if (!provider) throw new HttpError(400, 'Unknown provider');
      if (!provider.key()) throw new HttpError(400, `${provider.name} has no API key configured on the server`);
      const image = parseImage(body.image);
      const job = {
        id: crypto.randomUUID(),
        provider: body.provider,
        status: 'running',
        progress: 0,
        message: 'Uploading image…',
        createdAt: Date.now(),
        glb: null,
        error: null,
        cancelled: false
      };
      jobs.set(job.id, job);
      log(job, `started (${(image.bytes.length / 1024).toFixed(0)} KB image)`);
      runJob(job, provider, image, body.options || {});
      sendJSON(res, 202, { jobId: job.id });
      return;
    }

    const jobMatch = /^\/api\/image-to-3d\/([0-9a-f-]{36})(\/model\.glb)?$/.exec(route);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) throw new HttpError(404, 'Unknown or expired job');
      if (req.method === 'DELETE' && !jobMatch[2]) {
        job.cancelled = true;
        jobs.delete(job.id);
        log(job, 'cancelled');
        sendJSON(res, 200, { cancelled: true });
        return;
      }
      if (req.method === 'GET' && jobMatch[2]) {
        if (job.status !== 'succeeded') throw new HttpError(409, 'Model is not ready');
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': job.glb.length, 'Cache-Control': 'no-store' });
        res.end(job.glb);
        return;
      }
      if (req.method === 'GET') {
        sendJSON(res, 200, { status: job.status, progress: job.progress, message: job.message, error: job.error });
        return;
      }
    }

    throw new HttpError(404, 'Not found');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) sendJSON(res, err.status || 500, { error: err.status ? err.message : 'Internal server error' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  3D Hardware GLB Studio  →  http://localhost:${PORT}\n`);
  const builder = builderInfo();
  console.log(`  ${'AI Builder (Claude)'.padEnd(32)} ${builder.configured ? `ready (${BUILDER.model}, ${BUILDER.effort} effort)` : `not configured (${builder.setup})`}`);
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const state = !p.key() ? 'not configured' : p.testMode() ? 'TEST MODE (sample model, no credits)' : 'ready';
    console.log(`  ${p.name.padEnd(32)} ${state}`);
  }
  if (!builder.configured && !Object.values(PROVIDERS).some((p) => p.key())) {
    console.log('\n  Add ANTHROPIC_API_KEY, MESHY_API_KEY or STABILITY_API_KEY to a .env file to enable Image → 3D.');
    console.log(`  To try it for free: MESHY_API_KEY=${MESHY_TEST_KEY}`);
  }
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log(`\n  Listening on ${HOST}: anyone who can reach this address can spend your provider credits.`);
    console.log('  Set ALLOWED_HOSTS to the address other computers will use, e.g. ALLOWED_HOSTS=192.168.1.20:8787');
  }
  console.log('');
});
