// Motion-graphics player for Shorts. Every frame is a pure function of t: window.seek(t).
// Data: ?data=<path to film.json> (written by engine/motion.py).
const W = 1080, H = 1920;
const cv = document.getElementById('film');
const ctx = cv.getContext('2d');
const Q = new URLSearchParams(location.search);
const D = await (await fetch(Q.get('data'))).json();

// ---------------------------------------------------------------- math
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIO = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const spring = (t, f = 13, d = 6) => t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(f * t);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const noise1 = (x, seed = 0) => { const i = Math.floor(x), f = x - i, r = (k) => rng(hash(seed + ':' + k))(); const u = f * f * (3 - 2 * f); return lerp(r(i), r(i + 1), u) * 2 - 1; };

// ---------------------------------------------------------------- themes
const THEMES = {
  dark:   { bg0: '#070a12', bg1: '#111a2e', fg: '#ffffff', acc: '#ffb21a', acc2: '#3fa9ff', sub: '#8a93a8', cap: 'IDB', capSize: 80, upper: true, capY: 1330, hud: 'label', panel: '#151c2c', line: '#2a3550' },
  heist:  { bg0: '#09080c', bg1: '#1a1016', fg: '#ffffff', acc: '#ff3b3b', acc2: '#ffb21a', sub: '#8d8590', cap: 'IDX', capSize: 66, upper: false, capY: 1320, hud: 'stats', panel: '#16131a', line: '#2c2530' },
  light:  { bg0: '#f6f1ea', bg1: '#ece4f6', fg: '#16151a', acc: '#ff5a1f', acc2: '#7a5cff', sub: '#8a8378', cap: 'IDB', capSize: 76, upper: true, capY: 1180, hud: 'top', panel: '#ffffff', line: '#e2dace' },
  doodle: { bg0: '#efe7d6', bg1: '#e8dec9', fg: '#2a2622', acc: '#e0452b', acc2: '#2f6fd6', sub: '#7a7064', cap: 'Hand', capSize: 92, upper: false, capY: 1300, hud: 'none', panel: '#fbf7ee', line: '#2a2622' },
  neon:   { bg0: '#05030c', bg1: '#120a2a', fg: '#ffffff', acc: '#19f0ff', acc2: '#ff2bd6', sub: '#7d77a8', cap: 'Unb', capSize: 64, upper: true, capY: 1330, hud: 'label', panel: '#0f0b22', line: '#2a2156' },
};
const T = Object.assign({}, THEMES[D.theme || 'dark'], D.colors || {});
const FPS = D.fps || 30;

// ---------------------------------------------------------------- assets
const IMG = {};
await Promise.all([...new Set(D.scenes.flatMap((s) => (s.els || []).filter((e) => e.src).map((e) => e.src)))].map((src) => new Promise((res) => {
  const im = new Image(); im.onload = () => { IMG[src] = im; res(); }; im.onerror = () => res(); im.src = src;
})));
await document.fonts.load('80px IDB'); await document.fonts.load('80px IDX'); await document.fonts.load('40px Mono');
await document.fonts.load('80px Hand'); await document.fonts.load('80px Unb'); await document.fonts.load('40px IM'); await document.fonts.load('40px RMono');

// grain tiles
const GRAIN = [0, 1, 2, 3].map((k) => {
  const c = document.createElement('canvas'); c.width = 270; c.height = 480;
  const g = c.getContext('2d'), id = g.createImageData(270, 480), r = rng(99 + k);
  for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0); return c;
});

// ---------------------------------------------------------------- draw helpers
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function font(f, size, weight = '') { ctx.font = `${weight} ${size}px ${f}`.trim(); }
function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
function noGlow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }
function alphaCol(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function textW(s) { return ctx.measureText(s).width; }
function wobbleLine(pts, seed, t, amp = 3) { // hand-drawn line that "boils" 8 times a second
  const b = Math.floor(t * 8); ctx.beginPath();
  pts.forEach(([x, y], i) => { const r = rng(hash(seed + ':' + b + ':' + i)); const px = x + (r() - .5) * amp, py = y + (r() - .5) * amp; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
}

// ---------------------------------------------------------------- timing
const SC = D.scenes;
const WORDS = D.words || [];
const AMP = D.amp || [];
const ampAt = (t) => AMP[Math.max(0, Math.min(AMP.length - 1, Math.round(t * FPS)))] || 0;
function sceneAt(t) { let i = 0; for (let k = 0; k < SC.length; k++) if (t >= SC[k].t0 - 0.12) i = k; return i; }

// ---------------------------------------------------------------- backgrounds
function background(t, si) {
  const s = SC[si], tint = s.tint || T.acc2;
  if (D.theme === 'light') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, T.bg0); g.addColorStop(1, T.bg1); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 3; k++) { // soft pastel blobs drifting
      const x = W * (.2 + .6 * (.5 + .5 * Math.sin(t * .15 + k * 2.1))), y = H * (.25 + .5 * (.5 + .5 * Math.cos(t * .11 + k * 1.7)));
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 520); rg.addColorStop(0, alphaCol(['#ffd6c2', '#d9ccff', '#c8f0e4'][k], .55)); rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    return;
  }
  if (D.theme === 'doodle') {
    ctx.fillStyle = T.bg0; ctx.fillRect(0, 0, W, H);
    const r = rng(7); ctx.fillStyle = 'rgba(120,100,70,0.05)';
    for (let i = 0; i < 400; i++) ctx.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, T.bg0); g.addColorStop(1, T.bg1); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // colored light of the current scene, crossfading
  const prev = si > 0 ? (SC[si - 1].tint || T.acc2) : tint, k = easeOut((t - s.t0 + .12) / .6);
  for (const [col, a] of [[prev, 1 - k], [tint, k]]) {
    if (a <= 0) continue;
    const rg = ctx.createRadialGradient(W / 2, 860, 0, W / 2, 860, 760); rg.addColorStop(0, alphaCol(col, .28 * a)); rg.addColorStop(1, alphaCol(col, 0));
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  if (D.theme === 'neon') { // perspective grid floor
    ctx.strokeStyle = alphaCol(T.acc2, .22); ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 40, 1150); ctx.lineTo(W / 2 + i * 260, H); ctx.stroke(); }
    for (let j = 0; j < 12; j++) { const y = 1150 + Math.pow((j + (t * .8) % 1) / 12, 2) * (H - 1150); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  if (D.theme === 'heist') { ctx.fillStyle = 'rgba(255,255,255,0.025)'; for (let y = (t * 40) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 1); }
  // dust
  const r = rng(11);
  for (let i = 0; i < 46; i++) {
    const x0 = r() * W, y0 = r() * H, sp = 8 + r() * 20, sz = 1 + r() * 2.5;
    const y = ((y0 - t * sp) % H + H) % H, x = x0 + Math.sin(t * .4 + i) * 12;
    ctx.fillStyle = `rgba(255,255,255,${.06 + .12 * r()})`; ctx.beginPath(); ctx.arc(x, y, sz, 0, 7); ctx.fill();
  }
}

// ---------------------------------------------------------------- HUD
let prevStats = null;
function hud(t, si) {
  const s = SC[si];
  if (T.hud === 'label' && D.label) {
    font('Mono', 26, 600); ctx.fillStyle = alphaCol('#ffffff', .55); ctx.letterSpacing = '4px';
    ctx.textAlign = 'left'; ctx.fillText(D.label, 70, 300); ctx.letterSpacing = '0px';
    return;
  }
  if (T.hud === 'top' && D.label) {
    font('IM', 26); ctx.fillStyle = T.sub; ctx.textAlign = 'left'; ctx.fillText(D.label, 70, 300);
    if (D.brand) { font('IDX', 30); ctx.fillStyle = T.fg; ctx.textAlign = 'right'; ctx.fillText(D.brand, W - 70, 300); }
    ctx.fillStyle = T.acc; ctx.fillRect(70, 318, 140, 4); return;
  }
  if (T.hud === 'stats' && D.stats) {
    // stat bar: values per scene, numbers tween between scenes
    const cur = s.stats || {}, pv = si > 0 ? (SC[si - 1].stats || {}) : cur, k = easeOut((t - s.t0) / .8);
    const x0 = 70, y0 = 268, w = W - 140;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(x0, y0, w, 104, 18); ctx.fill(); ctx.strokeStyle = alphaCol('#ffffff', .08); ctx.lineWidth = 2; ctx.stroke();
    const cols = D.stats, cw = w / cols.length;
    cols.forEach((c, i) => {
      const x = x0 + 26 + i * cw;
      font('Mono', 20, 600); ctx.fillStyle = T.sub; ctx.textAlign = 'left'; ctx.fillText(c.label, x, y0 + 36);
      let v = cur[c.key] ?? c.value ?? '';
      if (typeof v === 'number') { const a = typeof pv[c.key] === 'number' ? pv[c.key] : v; v = Math.round(lerp(a, v, k)); }
      font('Mono', 36, 800); ctx.fillStyle = c.color || T.fg;
      ctx.fillText(`${v}${c.suffix || ''}`, x, y0 + 80);
      if (c.bar) { // risk bar
        const vv = typeof v === 'number' ? v : parseFloat(v) || 0;
        ctx.fillStyle = alphaCol('#ffffff', .12); rr(x + 110, y0 + 62, cw - 150, 10, 5); ctx.fill();
        ctx.fillStyle = T.acc; rr(x + 110, y0 + 62, (cw - 150) * clamp(vv / 100), 10, 5); ctx.fill();
      }
    });
  }
}

// ---------------------------------------------------------------- element entrance / exit
function enter(e, lt) {
  const from = e.from || 'pop', p = spring(lt, 12, 7), q = easeOut(lt / .45);
  const o = { dx: 0, dy: 0, sc: 1, a: clamp(lt / .12), rot: 0 };
  if (from === 'pop') o.sc = .35 + .65 * p;
  else if (from === 'up') o.dy = (1 - p) * 260;
  else if (from === 'down') o.dy = -(1 - p) * 260;
  else if (from === 'left') o.dx = -(1 - p) * 700;
  else if (from === 'right') o.dx = (1 - p) * 700;
  else if (from === 'drop') { o.dy = -(1 - q) * 900; o.sc = 1 + .12 * Math.max(0, Math.sin(clamp((lt - .45) / .25) * Math.PI)) * (lt > .45 ? 1 : 0); }
  else if (from === 'slam') { o.sc = 1 + 1.6 * (1 - easeOut(lt / .22)); o.rot = (e.rot || -8) * Math.PI / 180; o.a = clamp(lt / .08); }
  else if (from === 'fade') o.a = clamp(lt / .4);
  else if (from === 'none') o.a = 1;
  return o;
}

// ---------------------------------------------------------------- visual library
const V = {};
V.text = (e, lt, t) => { // kinetic headline, accent words in *stars*
  const size = e.size || 130; font(e.font || (D.theme === 'doodle' ? 'Hand' : D.theme === 'neon' ? 'Unb' : 'IDB'), size, e.font === 'Unb' || D.theme === 'neon' ? 800 : '');
  const lines = String(e.text).split('\n'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((ln, li) => {
    const parts = ln.split(/(\*[^*]+\*)/).filter(Boolean); let total = 0;
    parts.forEach((p) => total += textW(p.replace(/\*/g, '')));
    let x = -total / 2; const y = (li - (lines.length - 1) / 2) * size * 1.02;
    parts.forEach((p) => {
      const acc = p.startsWith('*'), s = p.replace(/\*/g, ''), w = textW(s);
      ctx.fillStyle = acc ? (e.acc || T.acc) : (e.color || T.fg);
      if (acc && D.theme !== 'light' && D.theme !== 'doodle') glow(alphaCol(e.acc || T.acc, .6), 40);
      ctx.textAlign = 'left'; ctx.fillText(s, x, y); noGlow(); x += w;
    });
  });
  ctx.textBaseline = 'alphabetic';
};
V.chip = (e) => { // numbered chip: [01] ВОДА
  font('IDB', e.size || 46); const n = e.n || '', s = e.text || '';
  const nw = n ? textW(n) + 34 : 0, sw = textW(s), w = nw + sw + 48, h = (e.size || 46) * 1.55;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; if (D.theme === 'light' || D.theme === 'doodle') ctx.fillStyle = '#ffffff';
  rr(-w / 2, -h / 2, w, h, 16); ctx.fill(); ctx.strokeStyle = alphaCol(e.color || T.acc, .9); ctx.lineWidth = 3; ctx.stroke();
  if (n) { ctx.fillStyle = e.color || T.acc; rr(-w / 2 + 12, -h / 2 + 10, nw - 6, h - 20, 10); ctx.fill(); ctx.fillStyle = '#0b0b0b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, -w / 2 + 9 + nw / 2, 3); }
  ctx.fillStyle = D.theme === 'light' || D.theme === 'doodle' ? T.fg : '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s, -w / 2 + nw + 24, 3); ctx.textBaseline = 'alphabetic';
};
V.tag = (e) => { // small mono plate
  font('Mono', e.size || 28, 700); const parts = String(e.text).split('|'); const pad = 22;
  const ws = parts.map((p) => textW(p)); const w = ws.reduce((a, b) => a + b, 0) + pad * 2 * parts.length; const h = (e.size || 28) * 1.9;
  let x = -w / 2;
  parts.forEach((p, i) => {
    const bw = ws[i] + pad * 2; ctx.fillStyle = i === parts.length - 1 && parts.length > 1 ? (e.color || T.acc) : 'rgba(0,0,0,0.6)';
    if (D.theme === 'light' && !(i === parts.length - 1 && parts.length > 1)) ctx.fillStyle = '#1b1b1b';
    rr(x, -h / 2, bw, h, 8); ctx.fill(); ctx.fillStyle = i === parts.length - 1 && parts.length > 1 ? '#0b0b0b' : '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p, x + bw / 2, 2); x += bw;
  });
  ctx.textBaseline = 'alphabetic';
};
V.stamp = (e, lt) => {
  font('IDB', e.size || 110); const s = e.text, w = textW(s) + 80, h = (e.size || 110) * 1.3;
  ctx.strokeStyle = e.color || T.acc; ctx.lineWidth = 12; rr(-w / 2, -h / 2, w, h, 18); ctx.stroke();
  ctx.fillStyle = e.color || T.acc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, 0, 6); ctx.textBaseline = 'alphabetic';
};
V.drop = (e, lt, t) => {
  const c = e.color || '#3fa9ff', b = Math.sin(t * 2) * 10; ctx.translate(0, b);
  glow(alphaCol(c, .9), 90); const g = ctx.createLinearGradient(0, -160, 0, 140); g.addColorStop(0, '#9fdcff'); g.addColorStop(1, c);
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -170); ctx.bezierCurveTo(70, -60, 120, 0, 120, 50); ctx.arc(0, 50, 120, 0, Math.PI); ctx.bezierCurveTo(-120, 0, -70, -60, 0, -170); ctx.fill(); noGlow();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-48, 40, 18, 40, -.3, 0, 7); ctx.fill();
};
V.jar = (e, lt, t) => {
  const c = e.color || '#ffa31a'; glow(alphaCol(c, .8), 110);
  ctx.fillStyle = c; rr(-150, -130, 300, 300, 60); ctx.fill(); noGlow();
  const g = ctx.createLinearGradient(-150, 0, 150, 0); g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(.25, 'rgba(255,255,255,0.35)'); g.addColorStop(.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; rr(-150, -130, 300, 300, 60); ctx.fill();
  ctx.fillStyle = '#7a3d12'; rr(-125, -190, 250, 70, 18); ctx.fill(); ctx.fillStyle = '#5c2c0b'; ctx.fillRect(-125, -140, 250, 14);
  if (e.label) { ctx.fillStyle = '#fff4dc'; rr(-110, -30, 220, 110, 16); ctx.fill(); font('IDB', 56); ctx.fillStyle = '#7a3d12'; ctx.textAlign = 'center'; ctx.fillText(e.label, 0, 45); }
};
V.phone = (e, lt, t) => {
  ctx.fillStyle = '#0d0f14'; rr(-170, -320, 340, 640, 54); ctx.fill(); ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 8; ctx.stroke();
  const g = ctx.createLinearGradient(0, -300, 0, 300); g.addColorStop(0, e.screen || '#1f2b4d'); g.addColorStop(1, '#0d1020');
  ctx.fillStyle = g; rr(-148, -296, 296, 592, 40); ctx.fill(); ctx.fillStyle = '#000'; rr(-50, -284, 100, 26, 13); ctx.fill();
  if (e.time) { font('IDS', 74); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(e.time, 0, -150); }
  (e.notes || []).forEach((n, i) => {
    const k = spring(lt - .3 - i * .35); if (k <= 0) return;
    ctx.save(); ctx.translate(0, -70 + i * 120); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; rr(-132, -46, 264, 96, 22); ctx.fill();
    ctx.fillStyle = e.color || T.acc; rr(-118, -30, 44, 44, 12); ctx.fill();
    font('IDX', 24); ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.fillText(n.split('|')[0], -62, -6);
    font('IM', 20); ctx.fillStyle = '#555'; ctx.fillText(n.split('|')[1] || '', -62, 24); ctx.restore();
  });
};
V.heart = (e, lt, t) => {
  const c = e.color || '#ff3b5c', beat = 1 + .12 * Math.pow(Math.max(0, Math.sin(t * (e.bpm || 80) / 60 * Math.PI * 2)), 8);
  ctx.save(); ctx.scale(beat, beat); glow(alphaCol(c, .9), 70); ctx.fillStyle = c;
  ctx.beginPath(); ctx.moveTo(0, 70); ctx.bezierCurveTo(-140, -20, -90, -130, 0, -60); ctx.bezierCurveTo(90, -130, 140, -20, 0, 70); ctx.fill(); noGlow(); ctx.restore();
  if (e.ecg !== false) { // ECG trace
    ctx.strokeStyle = c; ctx.lineWidth = 6; glow(c, 20); ctx.beginPath();
    const span = 900, prog = clamp(lt / 1.2);
    for (let x = 0; x <= span * prog; x += 6) {
      const ph = ((x + t * 300) % 300) / 300; let y = 0;
      if (ph > .4 && ph < .45) y = -90; else if (ph >= .45 && ph < .5) y = 70; else if (ph >= .5 && ph < .53) y = -30;
      const px = -span / 2 + x, py = 260 + y; x ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke(); noGlow();
  }
};
V.building = (e, lt, t) => {
  const cols = e.cols || 5, rows = e.rows || 9, w = 520, h = 820, cw = w / cols, rh = h / rows;
  ctx.fillStyle = e.color || '#1c2438'; ctx.fillRect(-w / 2 - 30, -h / 2 - 40, w + 60, h + 80);
  const off = e.off !== undefined ? e.off : 0, r = rng(hash('b' + (e.seed || 1)));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const order = r(), lit = order > off * clamp(lt / (e.offTime || 2.5)) + (e.dark || 0);
    ctx.fillStyle = lit ? (r() > .2 ? '#ffcf6b' : '#ffe8a8') : '#0a0d16';
    if (lit) glow('rgba(255,190,80,0.6)', 18);
    ctx.fillRect(-w / 2 + i * cw + 16, -h / 2 + j * rh + 14, cw - 32, rh - 28); noGlow();
  }
  if (e.sign) { ctx.fillStyle = '#0a0d16'; rr(-150, -h / 2 - 120, 300, 70, 10); ctx.fill(); font('Mono', 30, 700); ctx.fillStyle = '#cfd6e6'; ctx.textAlign = 'center'; ctx.fillText(e.sign, 0, -h / 2 - 74); }
};
V.city = (e, lt, t) => { // skyline across the frame (draw at y = ground)
  const r = rng(hash('city' + (e.seed || 3)));
  for (let layer = 0; layer < 2; layer++) {
    let x = -620;
    while (x < 620) {
      const bw = 90 + r() * 120, bh = (layer ? 300 : 200) + r() * (layer ? 260 : 300);
      ctx.fillStyle = layer ? '#141b2e' : '#0c1120'; ctx.fillRect(x, -bh, bw, bh);
      for (let wy = -bh + 24; wy < -20; wy += 44) for (let wx = x + 14; wx < x + bw - 24; wx += 34) {
        const on = r() > (e.dark || .55) && noise1(t * .3 + wx * .01 + wy, 7) > -.6;
        if (on) { ctx.fillStyle = r() > .5 ? '#ffc861' : '#ffe39a'; ctx.fillRect(wx, wy, 16, 22); }
      }
      x += bw + 6;
    }
    ctx.translate(0, 0);
  }
};
V.window = (e, lt, t) => { // lit window with silhouette
  ctx.fillStyle = '#0d1018'; ctx.fillRect(-300, -380, 600, 760);
  glow('rgba(255,200,90,0.8)', 60); ctx.fillStyle = '#ffc04d'; ctx.fillRect(-150, -220, 300, 380); noGlow();
  ctx.fillStyle = '#e9a93a'; ctx.fillRect(-150, -30, 300, 8); ctx.fillRect(-4, -220, 8, 380);
  if (e.figure !== false) { const sway = Math.sin(t * .8) * 6; ctx.fillStyle = '#120c08'; ctx.beginPath(); ctx.arc(sway, -90, 52, 0, 7); ctx.fill(); rr(-85 + sway, -40, 170, 220, 60); ctx.fill(); }
};
V.door = (e, lt, t) => {
  ctx.fillStyle = '#20160f'; rr(-210, -420, 420, 840, 12); ctx.fill();
  ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 10; ctx.strokeRect(-170, -380, 340, 340); ctx.strokeRect(-170, 0, 340, 380);
  ctx.fillStyle = '#c9a25a'; ctx.beginPath(); ctx.arc(150, 30, 18, 0, 7); ctx.fill();
  if (e.light) { glow('rgba(255,210,120,0.9)', 50); ctx.fillStyle = '#ffd27a'; ctx.fillRect(-210, 418, 420, 8); noGlow(); }
  if (e.knock) { const k = Math.floor(t * 3) % 2; if (k) { font('IDB', 54); ctx.fillStyle = T.acc; ctx.textAlign = 'center'; ctx.fillText('ТУК', 270, -200); } }
};
V.bignum = (e, lt, t) => {
  const k = easeOut(lt / (e.dur || 1.4)), v = lerp(e.from || 0, e.to, k);
  const s = (e.fmt === 'raw' ? String(Math.round(v)) : Math.round(v).toLocaleString('ru-RU').replace(/,/g, ' ')) + (e.suffix || '');
  font(e.font || (D.theme === 'neon' ? 'Unb' : 'IDB'), e.size || 220, 800); ctx.textAlign = 'center';
  ctx.fillStyle = e.color || T.acc; if (D.theme !== 'light') glow(alphaCol(e.color || T.acc, .55), 60);
  ctx.fillText((e.prefix || '') + s, 0, 60); noGlow();
  if (e.label) { font('IDS', 44); ctx.fillStyle = T.fg; ctx.fillText(e.label, 0, 150); }
};
V.versus = (e, lt, t) => { // two number cards: A vs B
  [[-1, e.a], [1, e.b]].forEach(([side, c], i) => {
    const k = spring(lt - i * .25); if (k <= 0) return;
    ctx.save(); ctx.translate(side * 230, 0); ctx.scale(k, k);
    ctx.fillStyle = T.panel; rr(-200, -170, 400, 340, 28); ctx.fill(); ctx.strokeStyle = i ? T.acc : T.line; ctx.lineWidth = 4; ctx.stroke();
    font('Mono', 24, 700); ctx.fillStyle = T.sub; ctx.textAlign = 'center'; ctx.fillText(c.label, 0, -100);
    font('IDB', c.size || 96); ctx.fillStyle = i ? T.acc : T.fg; ctx.fillText(c.value, 0, 30);
    if (c.note) { font('IM', 26); ctx.fillStyle = T.sub; ctx.fillText(c.note, 0, 100); }
    ctx.restore();
  });
  if (lt > .3) { font('IDB', 54); ctx.fillStyle = T.sub; ctx.textAlign = 'center'; ctx.fillText('VS', 0, 20); }
};
V.bars = (e, lt, t) => {
  const items = e.items, n = items.length, bh = 110, gap = 80, max = Math.max(...items.map((i) => i.value));
  items.forEach((it, i) => {
    const y = (i - (n - 1) / 2) * (bh + gap), k = easeOut((lt - .15 * i) / .9);
    font('IDX', 46); ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.fillText(it.label, -440, y - bh / 2 - 16);
    ctx.fillStyle = alphaCol(T.fg, .08); rr(-440, y - bh / 2 + 0, 880, bh * .7, 14); ctx.fill();
    ctx.fillStyle = it.color || (i === e.hi ? T.acc : T.acc2); rr(-440, y - bh / 2, Math.max(20, 880 * it.value / max * k), bh * .7, 14); ctx.fill();
    font('Mono', 40, 800); ctx.fillStyle = D.theme === 'light' ? '#fff' : '#0b0b0b'; ctx.textAlign = 'right';
    ctx.fillText(it.text || String(Math.round(it.value * k)), -440 + Math.max(20, 880 * it.value / max * k) - 18, y - bh / 2 + bh * .48);
  });
};
V.waves = (e, lt, t) => { // sea: amplitude goes from -> to at "drop" seconds
  const w = e.w || 900, h = e.h || 420, k = e.drop !== undefined ? easeIO((lt - e.drop) / 1.2) : 0, amp = lerp(e.amp0 || 70, e.amp1 ?? 70, k);
  ctx.save(); rr(-w / 2, -h / 2, w, h, 36); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-w / 2, -h / 2, w, h);
  ['#0d3b7a', '#1560c0', '#2f8cff'].forEach((c, L) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-w / 2, h / 2);
    for (let x = -w / 2; x <= w / 2; x += 10) ctx.lineTo(x, -20 + L * 50 + Math.sin(x / 90 + t * (1.4 + L * .4) + L) * amp * (1 - L * .2));
    ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill();
  });
  ctx.restore(); ctx.strokeStyle = alphaCol('#ffffff', .15); ctx.lineWidth = 3; rr(-w / 2, -h / 2, w, h, 36); ctx.stroke();
};
V.chart = (e, lt, t) => {
  const pts = e.points || [3, 4, 3.5, 5, 6, 5.5, 7, 9], n = pts.length, w = 820, h = 480, mx = Math.max(...pts), mn = Math.min(...pts);
  ctx.fillStyle = T.panel; rr(-w / 2 - 40, -h / 2 - 90, w + 80, h + 160, 28); ctx.fill(); ctx.strokeStyle = T.line; ctx.lineWidth = 3; ctx.stroke();
  if (e.title) { font('Mono', 26, 700); ctx.fillStyle = T.sub; ctx.textAlign = 'left'; ctx.fillText(e.title, -w / 2, -h / 2 - 40); }
  ctx.strokeStyle = alphaCol(T.fg, .07); ctx.lineWidth = 2; for (let j = 0; j < 5; j++) { const y = -h / 2 + j * h / 4; ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); }
  const prog = clamp(lt / (e.dur || 1.6)) * (n - 1), col = e.color || (pts[n - 1] >= pts[0] ? '#2fe08a' : T.acc);
  ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.lineJoin = 'round'; glow(alphaCol(col, .7), 24); ctx.beginPath();
  let lx = 0, ly = 0;
  for (let i = 0; i <= Math.floor(prog) + 1 && i < n; i++) {
    const f = i <= prog ? 1 : prog - Math.floor(prog); const i0 = Math.min(i, n - 1), ip = Math.max(0, i - 1);
    const vx = lerp(ip, i0, i === 0 ? 1 : f), vy = lerp(pts[ip], pts[i0], i === 0 ? 1 : f);
    lx = -w / 2 + vx / (n - 1) * w; ly = h / 2 - (vy - mn) / (mx - mn || 1) * h; i ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly);
  }
  ctx.stroke(); noGlow(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 14, 0, 7); ctx.fill();
  if (e.price) { font('IDB', 44); ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(e.price, w / 2, -h / 2 - 34); }
};
V.card = (e, lt, t) => { // UI window
  const w = e.w || 820, h = e.h || 520, dark = D.theme !== 'light';
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  ctx.fillStyle = dark ? '#f4f4f6' : '#ffffff'; rr(-w / 2, -h / 2, w, h, 26); ctx.fill(); noGlow(); ctx.shadowOffsetY = 0;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-w / 2 + 36 + i * 30, -h / 2 + 34, 9, 0, 7); ctx.fill(); });
  if (e.url) { ctx.fillStyle = '#ececf0'; rr(-w / 2 + 140, -h / 2 + 18, w - 180, 34, 17); ctx.fill(); font('IM', 20); ctx.fillStyle = '#777'; ctx.textAlign = 'left'; ctx.fillText(e.url, -w / 2 + 160, -h / 2 + 42); }
  let y = -h / 2 + 120;
  if (e.title) { font('IDB', e.titleSize || 52); ctx.fillStyle = '#16151a'; ctx.textAlign = 'left'; ctx.fillText(e.title, -w / 2 + 44, y); y += 70; }
  (e.rows || []).forEach((row, i) => {
    const k = easeOut((lt - .25 - i * .18) / .35); if (k <= 0) return;
    ctx.globalAlpha *= k; const hi = i === e.hi;
    if (hi) { ctx.fillStyle = alphaCol(e.color || T.acc, .14); rr(-w / 2 + 30, y - 40, w - 60, 58, 12); ctx.fill(); }
    font(hi ? 'IDX' : 'IM', 32); ctx.fillStyle = hi ? (e.color || T.acc) : '#3a3940'; ctx.textAlign = 'left';
    const [a, b] = row.split('|'); ctx.fillText(a, -w / 2 + 48, y);
    if (b) { ctx.textAlign = 'right'; font('Mono', 28, 700); ctx.fillText(b, w / 2 - 48, y); }
    ctx.globalAlpha /= k; y += 66;
  });
  if (e.button) { const k = spring(lt - .9); if (k > 0) { ctx.save(); ctx.translate(0, h / 2 - 80); ctx.scale(k, k); font('IDB', 34); const bw = textW(e.button) + 90; ctx.fillStyle = e.color || T.acc; rr(-bw / 2, -36, bw, 72, 36); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(e.button, 0, 12); ctx.restore(); } }
};
V.list = (e, lt, t) => { // mono table rows, one highlighted
  const rows = e.rows, w = 860, rh = 54; font('Mono', 26, 600);
  ctx.fillStyle = T.panel; rr(-w / 2 - 20, -rows.length * rh / 2 - 90, w + 40, rows.length * rh + 130, 22); ctx.fill(); ctx.strokeStyle = T.line; ctx.lineWidth = 2; ctx.stroke();
  if (e.title) { ctx.fillStyle = T.sub; ctx.textAlign = 'left'; ctx.letterSpacing = '3px'; ctx.fillText(e.title, -w / 2 + 10, -rows.length * rh / 2 - 40); ctx.letterSpacing = '0px'; }
  rows.forEach((r, i) => {
    const k = clamp((lt - i * .06) / .2); if (k <= 0) return; const y = -rows.length * rh / 2 + i * rh + 30, hi = i === e.hi && lt > (e.hiAt || .8);
    if (hi) { ctx.fillStyle = alphaCol(T.acc, .25); ctx.fillRect(-w / 2, y - 36, w, rh - 4); }
    ctx.globalAlpha *= k; ctx.fillStyle = hi ? T.acc : alphaCol(T.fg, .75); const cols = r.split('|');
    cols.forEach((c, j) => { ctx.textAlign = j === cols.length - 1 && j > 0 ? 'right' : 'left'; ctx.fillText(c, j === cols.length - 1 && j > 0 ? w / 2 - 10 : -w / 2 + 10 + j * 300, y); });
    ctx.globalAlpha /= k;
  });
};
V.grid = (e, lt, t) => { // many small tiles appearing (agents, people, days)
  const n = e.n || 70, cols = e.cols || 10, sz = e.size || 64, gap = 14, rows = Math.ceil(n / cols), r = rng(5);
  const w = cols * (sz + gap) - gap, h = rows * (sz + gap) - gap;
  for (let i = 0; i < n; i++) {
    const k = clamp((lt - i * (e.speed || .015)) / .15); if (k <= 0) continue;
    let x = -w / 2 + (i % cols) * (sz + gap), y = -h / 2 + Math.floor(i / cols) * (sz + gap);
    const on = (e.on || []).includes(i) || (e.onFrac && r() < e.onFrac), rs = r();
    if (e.rise && on) { const rl = Math.max(0, lt - (e.riseAt || 1) - rs * .8); y -= rl * rl * 120 * (.6 + rs); x += Math.sin(t * 2 + i) * 10 * Math.min(1, rl); ctx.globalAlpha *= clamp(1 - rl / 2.2); }
    ctx.fillStyle = on ? (e.color || T.acc) : alphaCol(T.fg, .14); ctx.globalAlpha *= k;
    if (e.shape === 'dot') { if (on) glow(alphaCol(e.color || T.acc, .8), 20); ctx.beginPath(); ctx.arc(x + sz / 2, y + sz / 2, sz / 2, 0, 7); ctx.fill(); noGlow(); } else { rr(x, y, sz, sz, 12); ctx.fill(); }
    if (e.faces && on) { ctx.fillStyle = '#111'; ctx.fillRect(x + sz * .28, y + sz * .38, 6, 9); ctx.fillRect(x + sz * .62, y + sz * .38, 6, 9); }
    ctx.globalAlpha /= k;
  }
  if (e.label) { font('IDX', 40); ctx.fillStyle = T.fg; ctx.textAlign = 'center'; ctx.fillText(e.label, 0, h / 2 + 80); }
};
V.clock = (e, lt, t) => {
  const r = 230, sp = e.speed || 1; ctx.fillStyle = D.theme === 'light' ? '#fff' : T.panel; glow(alphaCol(T.acc, .4), 40); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); noGlow();
  ctx.strokeStyle = T.fg; ctx.lineWidth = 12; ctx.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.lineWidth = i % 3 ? 5 : 10; ctx.beginPath(); ctx.moveTo(Math.sin(a) * (r - 20), -Math.cos(a) * (r - 20)); ctx.lineTo(Math.sin(a) * (r - 50), -Math.cos(a) * (r - 50)); ctx.stroke(); }
  const hA = (e.hour || 10) / 12 * Math.PI * 2 + t * sp * .5, mA = t * sp * 6;
  ctx.lineCap = 'round'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hA) * 120, -Math.cos(hA) * 120); ctx.stroke();
  ctx.strokeStyle = T.acc; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(mA) * 180, -Math.cos(mA) * 180); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = T.acc; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
};
V.timer = (e, lt, t) => {
  const sec = Math.max(0, (e.from ?? 600) + (e.dir === 'up' ? 1 : -1) * lt * (e.speed || 1));
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = Math.floor(sec % 60);
  const s = (hh ? String(hh).padStart(2, '0') + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  font('Mono', e.size || 170, 800); ctx.textAlign = 'center'; ctx.fillStyle = e.color || T.acc; glow(alphaCol(e.color || T.acc, .6), 50); ctx.fillText(s, 0, 60); noGlow();
  if (e.label) { font('Mono', 30, 700); ctx.fillStyle = T.sub; ctx.letterSpacing = '6px'; ctx.fillText(e.label, 0, -110); ctx.letterSpacing = '0px'; }
};
V.planet = (e, lt, t) => {
  const c = e.color || '#ff8a3d', r = e.r || 200; glow(alphaCol(c, .7), 80);
  const g = ctx.createRadialGradient(-r * .4, -r * .4, 10, 0, 0, r); g.addColorStop(0, e.hi || '#fff3d6'); g.addColorStop(.3, c); g.addColorStop(1, e.shade || '#2a0d00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); noGlow();
  if (e.earth) { // continents
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.clip(); ctx.fillStyle = 'rgba(80,200,120,0.85)';
    const off = (t * 30) % (r * 4);
    for (const [x, y, rx, ry] of [[-60, -60, 90, 60], [70, 40, 70, 100], [-120, 90, 60, 40], [150, -90, 50, 35]]) for (const k of [0, 1]) { ctx.beginPath(); ctx.ellipse(x + off - k * r * 4, y, rx, ry, .4, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  if (e.axis) { // tilted axis that can wobble
    const a = ((e.tilt ?? 23) + (e.wobble ? Math.sin(t * 2.2) * e.wobble * clamp((lt - .6) / 1) : 0)) * Math.PI / 180;
    ctx.strokeStyle = e.axisColor || T.acc; ctx.lineWidth = 8; ctx.setLineDash([24, 14]); glow(alphaCol(e.axisColor || T.acc, .8), 20);
    ctx.beginPath(); ctx.moveTo(-Math.sin(a) * r * 1.5, Math.cos(a) * r * 1.5); ctx.lineTo(Math.sin(a) * r * 1.5, -Math.cos(a) * r * 1.5); ctx.stroke(); ctx.setLineDash([]); noGlow();
  }
  if (e.ring) { ctx.strokeStyle = alphaCol('#ffe2b8', .7); ctx.lineWidth = 14; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.7, r * .38, -.25, Math.PI * 1.05, Math.PI * 1.95, true); ctx.stroke(); }
};
V.icon = (e, lt, t) => { // simple flat icons
  const k = e.name, c = e.color || T.acc, s = (e.size || 1); ctx.scale(s, s);
  if (D.theme !== 'light' && D.theme !== 'doodle') glow(alphaCol(c, .7), 60);
  ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (k === 'lock') { rr(-130, -20, 260, 220, 34); ctx.fill(); ctx.beginPath(); ctx.arc(0, -40, 95, Math.PI, 0); ctx.stroke(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 70, 28, 0, 7); ctx.fill(); }
  else if (k === 'coin') { ctx.beginPath(); ctx.arc(0, 0, 170, 0, 7); ctx.fill(); noGlow(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(0, 0, 130, 0, 7); ctx.stroke(); font('IDB', 170); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.textAlign = 'center'; ctx.fillText(e.text || '₽', 0, 62); }
  else if (k === 'bolt') { ctx.beginPath(); ctx.moveTo(40, -220); ctx.lineTo(-110, 30); ctx.lineTo(0, 30); ctx.lineTo(-40, 220); ctx.lineTo(110, -40); ctx.lineTo(0, -40); ctx.closePath(); ctx.fill(); }
  else if (k === 'question' || k === 'exclaim') { font('IDB', 380); ctx.textAlign = 'center'; ctx.fillText(k === 'question' ? '?' : '!', 0, 130); }
  else if (k === 'check') { ctx.beginPath(); ctx.moveTo(-130, 0); ctx.lineTo(-30, 100); ctx.lineTo(150, -110); ctx.stroke(); }
  else if (k === 'cross') { ctx.beginPath(); ctx.moveTo(-120, -120); ctx.lineTo(120, 120); ctx.moveTo(120, -120); ctx.lineTo(-120, 120); ctx.stroke(); }
  else if (k === 'warning') { ctx.beginPath(); ctx.moveTo(0, -190); ctx.lineTo(190, 150); ctx.lineTo(-190, 150); ctx.closePath(); ctx.fill(); noGlow(); font('IDB', 200); ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.fillText('!', 0, 120); }
  else if (k === 'fire') { const f = Math.sin(t * 9) * 8; ctx.beginPath(); ctx.moveTo(0, -200 - f); ctx.bezierCurveTo(140, -60, 150, 60, 0, 170); ctx.bezierCurveTo(-150, 60, -120, -40, -40, -100); ctx.bezierCurveTo(-30, -40, 10, -60, 0, -200 - f); ctx.fill(); ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.ellipse(0, 90, 55, 80 + f, 0, 0, 7); ctx.fill(); }
  else if (k === 'moon') { const g = ctx.createRadialGradient(-60, -60, 10, 0, 0, 180); g.addColorStop(0, '#ffffff'); g.addColorStop(1, c); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 170, 0, 7); ctx.fill(); noGlow();
    ctx.fillStyle = 'rgba(120,120,150,0.22)'; for (const [x, y, r] of [[-50, -40, 38], [60, 30, 28], [-20, 80, 22], [70, -70, 18], [-90, 40, 16]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } }
  else if (k === 'sun') { ctx.beginPath(); ctx.arc(0, 0, 120, 0, 7); ctx.fill(); ctx.lineWidth = 22; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t * .3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 160, Math.sin(a) * 160); ctx.lineTo(Math.cos(a) * 215, Math.sin(a) * 215); ctx.stroke(); } }
  else if (k === 'eye') { ctx.beginPath(); ctx.moveTo(-220, 0); ctx.quadraticCurveTo(0, -170, 220, 0); ctx.quadraticCurveTo(0, 170, -220, 0); ctx.fill(); noGlow(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(Math.sin(t) * 30, 0, 70, 0, 7); ctx.fill(); }
  else if (k === 'key') { ctx.beginPath(); ctx.arc(-110, 0, 80, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(190, 0); ctx.moveTo(140, 0); ctx.lineTo(140, 60); ctx.moveTo(90, 0); ctx.lineTo(90, 45); ctx.stroke(); }
  else if (k === 'bell') { ctx.beginPath(); ctx.moveTo(-150, 110); ctx.quadraticCurveTo(-120, 90, -120, -10); ctx.quadraticCurveTo(-110, -150, 0, -150); ctx.quadraticCurveTo(110, -150, 120, -10); ctx.quadraticCurveTo(120, 90, 150, 110); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 140, 34, 0, 7); ctx.fill(); }
  else if (k === 'battery') { const lv = e.level ?? clamp(1 - lt / 3); ctx.lineWidth = 18; rr(-200, -100, 380, 200, 30); ctx.stroke(); ctx.fillRect(190, -40, 30, 80); ctx.fillStyle = lv < .25 ? '#ff3b3b' : c; rr(-176, -76, 332 * lv, 152, 16); ctx.fill(); }
  else if (k === 'skull') { ctx.beginPath(); ctx.arc(0, -30, 160, Math.PI * .85, Math.PI * 2.15); ctx.lineTo(80, 150); ctx.lineTo(-80, 150); ctx.closePath(); ctx.fill(); noGlow(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-60, -20, 42, 0, 7); ctx.arc(60, -20, 42, 0, 7); ctx.fill(); }
  else if (k === 'pill') { ctx.save(); ctx.rotate(-.6); rr(-200, -75, 400, 150, 75); ctx.fill(); noGlow(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(0, -75, 200, 150, [0, 75, 75, 0]); ctx.fill(); ctx.restore(); }
  else if (k === 'brain') { ctx.beginPath(); for (const [x, y, r] of [[-80, -40, 100], [60, -60, 110], [100, 40, 90], [-60, 60, 95], [0, 0, 90]]) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7); } ctx.fill(); noGlow(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(0, -150); ctx.bezierCurveTo(-30, -60, 30, 20, 0, 150); ctx.stroke(); }
  ctx.lineCap = 'butt'; noGlow();
};
V.image = (e, lt, t, sd) => { // AI illustration or photo in a rounded card, or full frame (mode: full)
  const im = IMG[e.src]; if (!im) return;
  const dur = sd || 4, p = clamp(lt / dur), z = (e.zoom === 'out' ? lerp(1.12, 1.0, p) : lerp(1.0, 1.1, p));
  if (e.mode === 'full') {
    ctx.save(); ctx.resetTransform(); const sc = Math.max(W / im.width, H / im.height) * z;
    ctx.drawImage(im, W / 2 - im.width * sc / 2 + (e.pan || 0) * p * 60, H / 2 - im.height * sc / 2, im.width * sc, im.height * sc);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(.45, 'rgba(0,0,0,0.05)'); g.addColorStop(.62, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore(); return;
  }
  const w = e.w || 860, h = e.h || 860; ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24; ctx.fillStyle = '#000'; rr(-w / 2, -h / 2, w, h, 36); ctx.fill(); noGlow(); ctx.shadowOffsetY = 0;
  rr(-w / 2, -h / 2, w, h, 36); ctx.clip(); const sc = Math.max(w / im.width, h / im.height) * z;
  ctx.drawImage(im, -im.width * sc / 2, -im.height * sc / 2 + (e.oy || 0), im.width * sc, im.height * sc); ctx.restore();
  ctx.strokeStyle = alphaCol('#ffffff', D.theme === 'light' ? .9 : .14); ctx.lineWidth = D.theme === 'light' ? 10 : 3; rr(-w / 2, -h / 2, w, h, 36); ctx.stroke();
};
V.person = (e, lt, t, sd, el) => { // small flat character (hoodie guy)
  const c = e.color || '#ff7a1a', skin = e.skin || '#f2c29b', hair = e.hair || '#2b1d14', pose = e.pose || 'idle';
  const bob = Math.sin(t * 3) * 4, shake = pose === 'scared' ? Math.sin(t * 40) * 4 : 0, walk = pose === 'walk' ? Math.sin(t * 8) : 0;
  ctx.translate(shake, bob); const s = e.size || 1; ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 250, 90, 16, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#2b3550'; ctx.lineWidth = 30; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-28, 140); ctx.lineTo(-28 - walk * 30, 238); ctx.moveTo(28, 140); ctx.lineTo(28 + walk * 30, 238); ctx.stroke();
  ctx.strokeStyle = c; ctx.lineWidth = 28;
  const arms = { idle: [[-70, 20, -90, 110], [70, 20, 90, 110]], wave: [[-70, 20, -90, 110], [70, 20, 140, -60 + Math.sin(t * 10) * 25]], scared: [[-70, 20, -130, -80], [70, 20, 130, -80]],
    think: [[-70, 20, -90, 110], [70, 20, 20, -20]], point: [[-70, 20, -90, 110], [70, 20, 190, -10]], happy: [[-70, 20, -140, -70], [70, 20, 140, -70]], walk: [[-70, 20, -90 + walk * 30, 110], [70, 20, 90 - walk * 30, 110]] }[pose] || [];
  ctx.beginPath(); for (const [x1, y1, x2, y2] of arms) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); } ctx.stroke();
  ctx.fillStyle = c; rr(-80, -10, 160, 165, 50); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.12)'; rr(-40, 70, 80, 40, 14); ctx.fill();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -90, 82, 0, 7); ctx.fill();
  ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(0, -104, 84, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); ctx.beginPath(); ctx.ellipse(-30, -150, 50, 26, -.3, 0, 7); ctx.fill();
  const blink = (t % 3.3) < .12, ex = (e.look || 0) * 8;
  ctx.fillStyle = '#1a1a1a';
  if (blink) { ctx.fillRect(-34 + ex, -88, 20, 5); ctx.fillRect(14 + ex, -88, 20, 5); }
  else if (pose === 'scared') { ctx.beginPath(); ctx.arc(-24 + ex, -88, 12, 0, 7); ctx.arc(24 + ex, -88, 12, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-24 + ex, -88, 5, 0, 7); ctx.arc(24 + ex, -88, 5, 0, 7); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(-24 + ex, -86, 8, 0, 7); ctx.arc(24 + ex, -86, 8, 0, 7); ctx.fill(); }
  const a = e.speak ? ampAt(t) : 0, mo = pose === 'scared' ? 18 : pose === 'happy' ? 12 : 4 + a * 22;
  ctx.fillStyle = '#5a1f1f'; ctx.beginPath(); ctx.ellipse(ex, -48, pose === 'happy' ? 26 : 16, mo / 2 + 2, 0, 0, 7); ctx.fill();
  if (pose === 'scared') { ctx.fillStyle = '#7fd3ff'; ctx.beginPath(); ctx.ellipse(70, -130, 10, 16, 0, 0, 7); ctx.fill(); }
  ctx.lineCap = 'butt';
};
V.silhouette = (e, lt, t) => { // hooded figure, rim light
  const c = e.color || T.acc; ctx.translate(0, Math.sin(t * .8) * 6);
  glow(alphaCol(c, .9), 60); ctx.fillStyle = '#050407';
  ctx.beginPath(); ctx.moveTo(-260, 380); ctx.quadraticCurveTo(-250, 60, -140, 0); ctx.quadraticCurveTo(-170, -260, 0, -300); ctx.quadraticCurveTo(170, -260, 140, 0); ctx.quadraticCurveTo(250, 60, 260, 380); ctx.closePath(); ctx.fill(); noGlow();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(0, -120, 90, 110, 0, 0, 7); ctx.fill();
  if (e.eyes) { ctx.fillStyle = c; glow(c, 20); ctx.fillRect(-45, -130, 30, 8); ctx.fillRect(15, -130, 30, 8); noGlow(); }
};
V.mascot = (e, lt, t) => { // channel mascot: pastel gem with a face
  const s = e.size || 1, a = e.speak !== false ? ampAt(t) : 0, bob = Math.sin(t * 2.4) * 10, sq = 1 + a * .05;
  ctx.translate(0, bob); ctx.scale(s * (2 - sq), s * sq);
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(0, 250 - bob, 150, 22, 0, 0, 7); ctx.fill();
  const P = [[0, -230], [200, -115], [200, 115], [0, 230], [-200, 115], [-200, -115]], C = ['#c9b8ff', '#ffc4d6', '#ffd9b0', '#b8f0dc', '#a9d8ff', '#e2c8ff'];
  for (let i = 0; i < 6; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 6]; ctx.fillStyle = C[i]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = '#2a2433'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.beginPath(); P.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = 'rgba(42,36,51,0.18)'; ctx.lineWidth = 4; ctx.beginPath(); P.forEach(([x, y]) => { ctx.moveTo(0, 0); ctx.lineTo(x, y); }); ctx.stroke();
  const blink = (t % 3.7) < .12, mood = e.mood || 'happy', lx = (e.look || 0) * 10;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(sx * 62, -30, 40, blink ? 4 : 50, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#2a2433'; ctx.lineWidth = 6; ctx.stroke();
    if (!blink) { ctx.fillStyle = '#2a2433'; ctx.beginPath(); ctx.arc(sx * 62 + lx, -22, 20, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * 62 + lx + 7, -30, 7, 0, 7); ctx.fill(); }
    if (mood === 'angry') { ctx.strokeStyle = '#2a2433'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(sx * 30, -78); ctx.lineTo(sx * 96, -96); ctx.stroke(); }
  }
  ctx.fillStyle = 'rgba(255,120,150,0.45)'; ctx.beginPath(); ctx.ellipse(-120, 40, 30, 16, 0, 0, 7); ctx.ellipse(120, 40, 30, 16, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#5a2030'; const mo = mood === 'shock' ? 40 : 8 + a * 46;
  ctx.beginPath(); if (mood === 'happy' && a < .1) { ctx.arc(0, 50, 34, 0, Math.PI); } else ctx.ellipse(0, 62, 30, mo / 2 + 4, 0, 0, 7); ctx.fill();
};
V.stick = (e, lt, t, sd) => { // doodle stick figure with boiling lines
  const sd2 = hash(e.id || 'st'), pose = e.pose || 'idle', wv = pose === 'wave' ? Math.sin(t * 9) * 30 : 0;
  ctx.strokeStyle = T.line; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); const b = Math.floor(t * 8), rr2 = rng(sd2 + b); ctx.ellipse(rr2() * 3, -170, 52 + rr2() * 3, 56, 0, 0, 7); ctx.stroke();
  wobbleLine([[0, -112], [0, 60]], sd2 + 'b', t); ctx.stroke();
  wobbleLine([[0, 60], [-50, 190]], sd2 + 'l', t); ctx.stroke(); wobbleLine([[0, 60], [50, 190]], sd2 + 'r', t); ctx.stroke();
  const A = { idle: [[-70, 40], [70, 40]], wave: [[-70, 40], [100, -100 + wv]], up: [[-90, -110], [90, -110]], think: [[-70, 40], [24, -150]], point: [[-70, 40], [150, -60]] }[pose] || [[-70, 40], [70, 40]];
  wobbleLine([[0, -70], A[0]], sd2 + 'a', t); ctx.stroke(); wobbleLine([[0, -70], A[1]], sd2 + 'c', t); ctx.stroke();
  ctx.fillStyle = T.line; ctx.beginPath(); ctx.arc(-18, -178, 6, 0, 7); ctx.arc(18, -178, 6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -158, 18, .2, Math.PI - .2); ctx.stroke(); ctx.lineCap = 'butt';
};
V.arrow = (e, lt, t) => { // drawn arrow from (0,0) to (dx,dy)
  const p = easeOut(lt / .5), dx = (e.dx || 300) * p, dy = (e.dy || 0) * p;
  ctx.strokeStyle = e.color || T.acc; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx, dy); ctx.stroke();
  const a = Math.atan2(dy, dx); ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 40 * Math.cos(a - .5), dy - 40 * Math.sin(a - .5)); ctx.moveTo(dx, dy); ctx.lineTo(dx - 40 * Math.cos(a + .5), dy - 40 * Math.sin(a + .5)); ctx.stroke(); ctx.lineCap = 'butt';
};
V.note = (e) => { // sticky note / speech bubble
  font(e.font || (D.theme === 'doodle' ? 'Hand' : 'IDX'), e.size || 54); const lines = String(e.text).split('\n'); const w = Math.max(...lines.map(textW)) + 80, h = lines.length * (e.size || 54) * 1.2 + 60;
  ctx.fillStyle = e.color || (D.theme === 'doodle' ? '#ffe66d' : '#ffffff'); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  rr(-w / 2, -h / 2, w, h, e.bubble ? 40 : 10); ctx.fill(); noGlow(); ctx.shadowOffsetY = 0;
  if (e.bubble) { ctx.beginPath(); ctx.moveTo(-40, h / 2 - 2); ctx.lineTo(-80, h / 2 + 60); ctx.lineTo(10, h / 2 - 2); ctx.fill(); }
  ctx.fillStyle = e.ink || '#1b1b1b'; ctx.textAlign = 'center'; lines.forEach((l, i) => ctx.fillText(l, 0, -h / 2 + 30 + (i + .8) * (e.size || 54) * 1.2 - 10));
};
V.progress = (e, lt) => {
  const w = e.w || 760, p = lerp(e.from || 0, e.to ?? 1, easeOut(lt / (e.dur || 1.5)));
  ctx.fillStyle = alphaCol(T.fg, .12); rr(-w / 2, -22, w, 44, 22); ctx.fill(); ctx.fillStyle = e.color || T.acc; rr(-w / 2, -22, Math.max(44, w * p), 44, 22); ctx.fill();
  font('Mono', 36, 800); ctx.fillStyle = T.fg; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(p * 100)}%`, 0, -50); if (e.label) { font('IDS', 34); ctx.fillText(e.label, 0, 80); }
};

// ---------------------------------------------------------------- scene
function drawScene(t, i) {
  const s = SC[i], next = SC[i + 1];
  const outK = next ? clamp((t - (next.t0 - .14)) / .26) : 0; if (outK >= 1) return;
  const sd = s.t1 - s.t0, p = clamp((t - s.t0) / Math.max(1, sd));
  ctx.save();
  // camera: slow push, exit = zoom-through or whip
  const cz = 1 + (s.cam === 'out' ? .06 * (1 - p) : .045 * p) + .25 * easeIO(outK) * (s.exit === 'whip' ? 0 : 1);
  const wx = s.exit === 'whip' ? -W * 1.1 * easeIO(outK) : 0;
  ctx.translate(W / 2 + wx, 900); ctx.scale(cz, cz); ctx.translate(-W / 2, -900);
  ctx.globalAlpha = 1 - (s.exit === 'whip' ? 0 : easeOut(outK));
  for (const e of s.els || []) {
    const at = s.t0 + (e._at ?? e.at ?? 0); let lt = t - at;
    if (lt < 0) { if (i === 0 && (e._at ?? e.at ?? 0) <= 0 && e.from === 'none') lt = 0; else continue; }
    let ex = 1;
    if (e.until !== undefined && t > s.t0 + e.until) { ex = 1 - easeOut((t - s.t0 - e.until) / .28); if (ex <= 0) continue; }
    const o = enter(e, lt); o.sc *= e.until !== undefined && ex < 1 ? (e.exit === 'grow' ? 2 - ex : ex) : 1; o.a *= ex;
    ctx.save();
    if (e.mode === 'full') { ctx.globalAlpha *= o.a; V[e.v](e, lt, t, sd); ctx.restore(); continue; }
    const x = (e.x ?? .5) * W + o.dx + (e.float ? Math.sin(t * 1.3 + (e.y || 0) * 7) * 8 : 0);
    const y = (e.y ?? .42) * H + o.dy + (e.float ? Math.cos(t * 1.1 + (e.x || 0) * 5) * 12 : 0);
    ctx.translate(x, y); ctx.rotate(o.rot + (e.rot && e.from !== 'slam' ? e.rot * Math.PI / 180 : 0));
    const sc = (e.s || 1) * o.sc; ctx.scale(sc, sc); ctx.globalAlpha *= o.a;
    if (e.shake) { const k = Math.max(0, 1 - lt / .5); ctx.translate(Math.sin(t * 60) * 16 * k, Math.cos(t * 47) * 10 * k); }
    if (V[e.v]) V[e.v](e, lt, t, sd, e);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- captions
const CH = []; (function chunk() {
  let cur = [];
  const flush = () => { if (cur.length) CH.push(cur); cur = []; };
  for (const w of WORDS) {
    const len = cur.reduce((a, x) => a + x.w.length + 1, 0);
    if (cur.length && (cur.length >= 3 || len + w.w.length > 17 || w.si !== cur[0].si)) flush();
    cur.push(w); if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
})();
function captions(t) {
  if (!CH.length || D.captions === false) return;
  const cs = SC[sceneAt(t)]; if ((cs.els || []).some((e) => e.v === 'text' && !e.keepCaps && t >= cs.t0 + (e._at ?? e.at ?? 0))) return;
  let ci = -1; for (let k = 0; k < CH.length; k++) if (t >= CH[k][0].t0 - .06) ci = k;
  if (ci < 0) return; const c = CH[ci], end = (CH[ci + 1] ? CH[ci + 1][0].t0 - .06 : c[c.length - 1].t1 + .6);
  if (t > end) return;
  const lt = t - c[0].t0 + .06, k = spring(lt, 16, 9), sc = .7 + .3 * k;
  const y = (SC[sceneAt(t)].capY || T.capY);
  font(T.cap, T.capSize, D.theme === 'neon' ? 900 : (D.theme === 'doodle' ? 700 : ''));
  const toks = c.map((w) => (T.upper ? w.w.toUpperCase() : w.w).replace(/[«»"]/g, ''));
  const sp = T.capSize * .28, widths = toks.map(textW), total = widths.reduce((a, b) => a + b, 0) + sp * (toks.length - 1);
  const lines = total > 900 ? [[0, Math.ceil(toks.length / 2)], [Math.ceil(toks.length / 2), toks.length]] : [[0, toks.length]];
  ctx.save(); ctx.translate(W / 2, y); ctx.scale(sc, sc); ctx.globalAlpha = clamp(lt / .08);
  lines.forEach(([a, b], li) => {
    const lw = widths.slice(a, b).reduce((x, y) => x + y, 0) + sp * (b - a - 1); let x = -lw / 2;
    const ly = (li - (lines.length - 1) / 2) * T.capSize * 1.08;
    for (let i = a; i < b; i++) {
      const w = c[i], active = t >= w.t0 - .04 && t < w.t1 + .05, accent = w.hl || active;
      ctx.textAlign = 'left';
      if (D.theme !== 'light' && D.theme !== 'doodle') { ctx.lineWidth = T.capSize * .16; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(toks[i], x, ly); }
      ctx.fillStyle = w.hl ? T.acc : active ? (D.theme === 'light' || D.theme === 'doodle' ? T.acc : '#ffffff') : (D.theme === 'light' || D.theme === 'doodle' ? T.fg : (D.dimInactive ? '#d8d8d8' : '#ffffff'));
      if (active && !w.hl && D.theme !== 'light' && D.theme !== 'doodle') ctx.fillStyle = T.capActive || '#ffffff';
      if (w.hl && D.theme !== 'light' && D.theme !== 'doodle') glow(alphaCol(T.acc, .5), 26);
      ctx.fillText(toks[i], x, ly); noGlow(); x += widths[i] + sp;
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- post
function post(t) {
  const fi = Math.round(t * FPS);
  if (D.theme !== 'light') {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.save(); ctx.globalAlpha = D.theme === 'light' ? .035 : .055; ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(GRAIN[fi % 4], 0, 0, W, H); ctx.restore();
}

window.seek = (t) => {
  ctx.resetTransform(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; noGlow();
  const si = sceneAt(t);
  background(t, si);
  if (si > 0) drawScene(t, si - 1);
  drawScene(t, si);
  ctx.resetTransform(); ctx.globalAlpha = 1;
  hud(t, si);
  captions(t);
  post(t);
};
window.DURATION = D.duration;
window.filmReady = true;
window.seek(Number(Q.get('t') || 0));
