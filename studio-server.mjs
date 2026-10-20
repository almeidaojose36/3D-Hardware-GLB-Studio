#!/usr/bin/env node
// ============================================================================
// Classroom 3D Hardware GLB Studio: local server
// ============================================================================
// Serves the studio page and brokers image-to-3D requests to an AI provider, so the provider API key
// stays on this machine and never reaches the browser (the providers also refuse direct browser
// calls). Requires Node 18+ for the built-in fetch / FormData / Blob; no npm install needed.
//
//   node studio-server.mjs        then open http://localhost:8787
//
// Keys are read from environment variables or from a .env file next to this script:
//   MESHY_API_KEY=msy_...         Meshy Image-to-3D (msy_dummy_api_key_for_test_mode_12345678 is
//                                 Meshy's free test key: it returns their sample model, no credits)
//   STABILITY_API_KEY=sk-...      Stability AI Stable Fast 3D
// Optional: PORT (default 8787), HOST (default 127.0.0.1, i.e. this computer only) and, when serving
// other machines, ALLOWED_HOSTS=myserver.local:8787,192.168.1.20:8787 (the addresses they will type).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_FILE = path.join(ROOT, '3d_hardware_glb_studio_procedural_builder.html');
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
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({
          id,
          name: p.name,
          detail: p.detail,
          configured: Boolean(p.key()),
          testMode: Boolean(p.key()) && p.testMode()
        }))
      });
      return;
    }

    if (req.method === 'POST' && route === '/api/image-to-3d') {
      if (!/^application\/json\b/.test(String(req.headers['content-type']))) throw new HttpError(415, 'Expected JSON');
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'Malformed JSON');
      }
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
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const state = !p.key() ? 'not configured' : p.testMode() ? 'TEST MODE (sample model, no credits)' : 'ready';
    console.log(`  ${p.name.padEnd(32)} ${state}`);
  }
  if (!Object.values(PROVIDERS).some((p) => p.key())) {
    console.log('\n  Add MESHY_API_KEY or STABILITY_API_KEY to a .env file to enable Image → 3D.');
    console.log(`  To try it for free: MESHY_API_KEY=${MESHY_TEST_KEY}`);
  }
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log(`\n  Listening on ${HOST}: anyone who can reach this address can spend your provider credits.`);
    console.log('  Set ALLOWED_HOSTS to the address other computers will use, e.g. ALLOWED_HOSTS=192.168.1.20:8787');
  }
  console.log('');
});
