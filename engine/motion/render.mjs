// Render a motion film: node engine/motion/render.mjs <film.json (repo-relative)> <out.mp4> [--at t1,t2 dir] [--workers 2]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [DATA, OUT] = args;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, DATA), 'utf8'));
const FPS = data.fps || 30, DUR = data.duration, WORKERS = Number(opt('workers', 2));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.otf': 'font/otf', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/engine/motion/index.html?data=/${DATA}`;
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
const pages = await Promise.all(Array.from({ length: WORKERS }, async () => {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.error('[page]', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await p.goto(url); await p.waitForFunction(() => window.filmReady === true, null, { timeout: 120000 }); return p;
}));
const shot = async (p, t) => { await p.evaluate((t) => window.seek(t), t); return p.screenshot({ type: 'jpeg', quality: 93 }); };
try {
  const at = opt('at', null);
  if (at) {
    const dir = opt('dir', 'stills'); fs.mkdirSync(dir, { recursive: true });
    const ts = at.split(',').map(Number);
    for (let i = 0; i < ts.length; i++) fs.writeFileSync(path.join(dir, `s${String(i).padStart(3, '0')}.jpg`), await shot(pages[i % WORKERS], ts[i]));
  } else {
    const n = Math.round(DUR * FPS);
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-an', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r) => ff.on('close', r));
    const ready = new Map(); let next = 0, write = 0; const t0 = Date.now();
    await Promise.all(pages.map(async (p) => {
      while (next < n) {
        const i = next++;
        while (i - write > WORKERS * 4) await new Promise((r) => setTimeout(r, 5));
        ready.set(i, await shot(p, i / FPS));
        while (ready.has(write)) { const b = ready.get(write); ready.delete(write); write++; if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r)); }
        if (i % 150 === 0) process.stdout.write(`\r${i}/${n} ${(i / ((Date.now() - t0) / 1000)).toFixed(1)} fps   `);
      }
    }));
    ff.stdin.end(); await done; console.log(`\n-> ${OUT}`);
  }
} finally { await browser.close(); server.close(); }
