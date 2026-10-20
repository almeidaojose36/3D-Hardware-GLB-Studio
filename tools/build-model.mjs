#!/usr/bin/env node
// ============================================================================
// Build an AI Builder model file and render it, for working with Claude Code
// ============================================================================
// Runs a model program (a script defining buildModel() and, optionally, MODEL_INFO) in the studio's own
// sandbox inside headless Chrome or Edge, exactly as the in-studio AI Builder does, and writes:
//
//   <out>/<Name>.glb             the model, with its code, title and callouts embedded: import it in the
//                                studio (Image → 3D → Import .glb) or open it in any glTF viewer
//   <out>/views/1-front-right.jpg … 5-rear-left.jpg   the five fixed studio views
//   <out>/views/sheet.jpg        all five views on one contact sheet
//   <out>/report.json            build statistics, warnings and console output
//
// Usage: node tools/build-model.mjs models/V8_Engine/model.js [--out <dir>] [--name <Name>] [--size <px>]
//
// Needs Google Chrome or Microsoft Edge (or STUDIO_BROWSER=<path to a Chromium-based browser>). The
// three.js scripts the studio loads from its CDNs are cached in tools/.cache after the first run.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_FILE = path.join(ROOT, '3d_hardware_glb_studio_procedural_builder.html');
const CACHE_DIR = path.join(ROOT, 'tools', '.cache');
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|cdn\.tailwindcss\.com)\//;

function parseArgs(argv) {
  const args = { file: null, out: null, name: null, size: 640 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--size') args.size = Math.min(1024, Math.max(256, Number(argv[++i]) || 640));
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.file) args.file = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return args;
}

const toName = (text) =>
  String(text || '')
    .replace(/\.[a-z0-9]{1,4}$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

// CDN scripts are cached by URL so later runs are fast and work offline
const cachePath = (url) => path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex').slice(0, 20));

async function serveCDN(route) {
  const url = route.request().url();
  const file = cachePath(url);
  try {
    if (!fs.existsSync(file)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    await route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (err) {
    console.error(`Could not load ${url} (${err.message}). The first run needs an internet connection.`);
    await route.abort();
  }
}

async function launchBrowser() {
  const options = [
    process.env.STUDIO_BROWSER && { executablePath: process.env.STUDIO_BROWSER },
    { channel: 'chrome' },
    { channel: 'msedge' },
    {} // Playwright's own Chromium, if installed with `npx playwright install chromium`
  ].filter(Boolean);
  for (const option of options) {
    try {
      // Software WebGL is allowed as a fallback on machines where headless mode gets no GPU
      return await chromium.launch({ ...option, args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // try the next browser
    }
  }
  throw new Error('No Chromium-based browser found. Install Google Chrome or Microsoft Edge, or set STUDIO_BROWSER to its executable.');
}

// Runs inside the studio page: build in the sandbox, render the views and a contact sheet
async function buildInPage({ code, name, size }) {
  const result = await BuildSandbox.build(code); // eslint-disable-line no-undef
  if (!result.ok) return { ok: false, error: result.error, logs: result.logs || [] };
  const template = buildStudioTemplate(await parseGLB(result.glb.slice(0)), { fileBase: name }); // eslint-disable-line no-undef
  const views = captureModelViews(template, size); // eslint-disable-line no-undef

  const cell = 512;
  const sheet = document.createElement('canvas');
  sheet.width = cell * 3;
  sheet.height = cell * 2;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#d5d8dd';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const images = await Promise.all(
    views.map(
      (v) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = v.dataUrl;
        })
    )
  );
  images.forEach((img, i) => {
    const x = (i % 3) * cell;
    const y = Math.floor(i / 3) * cell;
    ctx.drawImage(img, x, y, cell, cell);
    ctx.fillStyle = 'rgba(15, 19, 28, 0.8)';
    ctx.fillRect(x, y, cell, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px Arial, sans-serif';
    ctx.fillText(`${i + 1}. ${views[i].label}`, x + 10, y + 21);
  });
  ctx.fillStyle = '#1f2937';
  ctx.font = '600 22px Arial, sans-serif';
  ctx.fillText(result.info.title || name, cell * 2 + 24, cell + 50);
  ctx.font = '16px Arial, sans-serif';
  const s = result.stats;
  [
    `${s.meshes} meshes · ${s.triangles.toLocaleString()} triangles`,
    `${s.materials} materials · ${s.textures} textures`,
    `${s.size[0]} W × ${s.size[1]} H × ${s.size[2]} D units`,
    '+Z = front, +X = right, +Y = up'
  ].forEach((line, i) => ctx.fillText(line, cell * 2 + 24, cell + 90 + i * 28));

  const bytes = new Uint8Array(result.glb);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return {
    ok: true,
    glb: btoa(binary),
    stats: result.stats,
    info: result.info,
    logs: result.logs,
    buildMs: result.buildMs,
    views: views.map((v) => ({ key: v.key, label: v.label, dataUrl: v.dataUrl })),
    sheet: sheet.toDataURL('image/jpeg', 0.88)
  };
}

const writeDataUrl = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const rel = (file) => path.relative(process.cwd(), file) || file;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log('Usage: node tools/build-model.mjs <model.js> [--out <dir>] [--name <Name>] [--size <px>]');
    process.exit(args.help ? 0 : 2);
  }
  const file = path.resolve(args.file);
  const code = fs.readFileSync(file, 'utf8');
  const outDir = path.resolve(args.out || path.dirname(file));
  const fallbackName = toName(path.basename(file, path.extname(file)) === 'model' ? path.basename(path.dirname(file)) : path.basename(file));

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.route(CDN, serveCDN);
    // Web fonts only style the studio's panels, which are not rendered here
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.goto(pathToFileURL(STUDIO_FILE).href);
    await page.waitForFunction(() => typeof renderer !== 'undefined' && renderer, null, { timeout: 120000 }).catch(() => {
      throw new Error(`The studio page did not start${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);
    });

    const started = Date.now();
    const name = args.name ? toName(args.name) : null;
    const result = await page.evaluate(buildInPage, { code, name: name || fallbackName, size: args.size });
    if (!result.ok) {
      console.log(`✖ Build failed: ${result.error}`);
      if (result.logs.length) console.log(`Console output:\n  ${result.logs.join('\n  ')}`);
      process.exitCode = 1;
      return;
    }

    const modelName = name || toName(result.info.title) || fallbackName || 'AI_Model';
    fs.mkdirSync(path.join(outDir, 'views'), { recursive: true });
    const glbFile = path.join(outDir, `${modelName}.glb`);
    fs.writeFileSync(glbFile, Buffer.from(result.glb, 'base64'));
    const viewFiles = result.views.map((v, i) => {
      const viewFile = path.join(outDir, 'views', `${i + 1}-${v.key}.jpg`);
      writeDataUrl(viewFile, v.dataUrl);
      return { file: viewFile, label: v.label };
    });
    const sheetFile = path.join(outDir, 'views', 'sheet.jpg');
    writeDataUrl(sheetFile, result.sheet);
    const report = { model: modelName, glb: rel(glbFile), buildMs: result.buildMs, stats: result.stats, info: result.info, logs: result.logs };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

    const s = result.stats;
    const parts = s.parts.map((p) => `${p.name} (${p.meshes} meshes${p.explode ? `, explodes ${p.explode.join(', ')}` : ', no explode offset'})`);
    console.log(
      [
        `✔ Built ${modelName} in ${(result.buildMs / 1000).toFixed(1)} s (total ${((Date.now() - started) / 1000).toFixed(1)} s) → ${rel(glbFile)} (${(fs.statSync(glbFile).size / 1048576).toFixed(2)} MB)`,
        `  ${s.meshes} meshes · ${s.triangles.toLocaleString('en-US')} triangles · ${s.materials} materials · ${s.textures} textures`,
        `  Bounding box: ${s.size[0]} wide (X) × ${s.size[1]} tall (Y) × ${s.size[2]} deep (Z) units, centred at (${s.centre.join(', ')})`,
        `  Parts: ${parts.join('; ') || 'none'}`,
        `  Warnings: ${s.warnings.length ? `\n    - ${s.warnings.join('\n    - ')}` : 'none'}`,
        result.logs.length ? `  Console output:\n    ${result.logs.join('\n    ')}` : '',
        `  Callouts: ${result.info.callouts.length}${result.info.title ? ` · title "${result.info.title}"` : ' · no MODEL_INFO title'}`,
        '  Studio views (compare them with the reference photos):',
        `    ${rel(sheetFile)}  (all five on one sheet)`,
        ...viewFiles.map((v) => `    ${rel(v.file)}  ${v.label}`)
      ]
        .filter(Boolean)
        .join('\n')
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
