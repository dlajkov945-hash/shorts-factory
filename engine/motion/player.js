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
  light:  { bg0: '#f6f1ea', bg1: '#ece4f6', fg: '#16151a', acc: '#ff5a1f', acc2: '#7a5cff', sub: '#8a8378', cap: 'IDB', capSize: 76, upper: true, capY: 1330, hud: 'top', panel: '#ffffff', line: '#e2dace' },
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
  // channel watermark: barely visible, top right. No other name labels (Dima: keep videos clean)
  if (D.watermark !== false) { font('IDX', 30); ctx.fillStyle = alphaCol(D.theme === 'light' || D.theme === 'doodle' ? '#000000' : '#ffffff', .2); ctx.textAlign = 'right'; ctx.fillText(D.watermark || 'лайков', W - 70, T.hud === 'stats' && D.stats ? 420 : 300); }
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
      if (typeof v === 'number') { const a = typeof pv[c.key] === 'number' ? pv[c.key] : v; v = Math.round(lerp(a, v, k)); if (Math.abs(v) >= 10000) v = v.toLocaleString('ru-RU').replace(/\u00a0|,/g, ' '); }
      font('Mono', 36, 800); ctx.fillStyle = c.color || T.fg;
      ctx.fillText(`${v}${c.suffix || ''}`, x, y0 + 80);
      if (c.bar) { // risk bar
        const vv = typeof v === 'number' ? v : parseFloat(String(v).replace(/ /g, '')) || 0;
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
    const sub = n.split('|')[1] || ''; let fs = 20; font('IM', fs); while (textW(sub) > 186 && fs > 12) font('IM', --fs);
    ctx.fillStyle = '#555'; ctx.fillText(sub, -62, 24); ctx.restore();
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
    const g = ctx.createLinearGradient(0, 0, 0, H); const cl = e.clean || D.captions === false; g.addColorStop(0, `rgba(0,0,0,${cl ? .12 : .35})`); g.addColorStop(.45, `rgba(0,0,0,${cl ? 0 : .05})`); g.addColorStop(.62, `rgba(0,0,0,${cl ? .05 : .55})`); g.addColorStop(1, `rgba(0,0,0,${cl ? .3 : .85})`);
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
V.hang = (e, lt, t) => { // doodle pull-up bar with a stick figure hanging (mood: strain|calm|happy, shake, fire, sweat, stretch)
  const sd2 = hash(e.id || 'hg'), mood = e.mood || 'calm', bw = e.bw || 300, by = -300;
  ctx.strokeStyle = T.line; ctx.lineCap = 'round'; ctx.lineWidth = 14;
  wobbleLine([[-bw, by], [bw, by]], sd2 + 'bar', t); ctx.stroke();
  ctx.lineWidth = 10; wobbleLine([[-bw + 20, by], [-bw + 20, 330]], sd2 + 'p1', t); ctx.stroke(); wobbleLine([[bw - 20, by], [bw - 20, 330]], sd2 + 'p2', t); ctx.stroke();
  const sh = e.shake ? Math.sin(t * 55) * 5 : 0, sw = (e.swing ?? 0.05) * Math.sin(t * 2.2), st = 1 + (e.stretch ? .08 * easeOut(lt / 1.2) : 0);
  ctx.save(); ctx.translate(sh, by); ctx.rotate(sw); ctx.lineWidth = 9;
  const hx = 70; // hands on bar
  ctx.beginPath(); ctx.arc(-hx, 0, 13, 0, 7); ctx.arc(hx, 0, 13, 0, 7); ctx.fillStyle = e.fire ? '#e0452b' : T.line; ctx.fill();
  wobbleLine([[-hx, 0], [0, 150 * st]], sd2 + 'a1', t); ctx.stroke(); wobbleLine([[hx, 0], [0, 150 * st]], sd2 + 'a2', t); ctx.stroke();
  const b = Math.floor(t * 8), r2 = rng(sd2 + b); ctx.beginPath(); ctx.ellipse(r2() * 3, 92 * st, 48 + r2() * 3, 52, 0, 0, 7); ctx.fillStyle = T.bg0; ctx.fill(); ctx.stroke();
  ctx.fillStyle = T.line; ctx.beginPath(); ctx.arc(-17, 84 * st, 6, 0, 7); ctx.arc(17, 84 * st, 6, 0, 7); ctx.fill();
  ctx.beginPath();
  if (mood === 'happy') ctx.arc(0, 104 * st, 16, .2, Math.PI - .2); else if (mood === 'strain') { ctx.moveTo(-18, 116 * st); ctx.lineTo(-6, 108 * st); ctx.lineTo(6, 116 * st); ctx.lineTo(18, 108 * st); } else { ctx.moveTo(-14, 112 * st); ctx.lineTo(14, 112 * st); }
  ctx.stroke();
  wobbleLine([[0, 146 * st], [0, 330 * st]], sd2 + 'b', t); ctx.stroke();
  const lg = Math.sin(t * 3) * 8; wobbleLine([[0, 330 * st], [-34 + lg, 470 * st]], sd2 + 'l', t); ctx.stroke(); wobbleLine([[0, 330 * st], [34 + lg, 470 * st]], sd2 + 'r', t); ctx.stroke();
  if (e.fire) { for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const fl = (t * 3 + k / 3) % 1; ctx.strokeStyle = alphaCol(k % 2 ? '#ffb21a' : '#e0452b', 1 - fl); ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(sx * hx + (k - 1) * 18, -10 - fl * 110); ctx.quadraticCurveTo(sx * hx + (k - 1) * 18 + 18, -40 - fl * 110, sx * hx + (k - 1) * 18, -70 - fl * 110); ctx.stroke(); } ctx.strokeStyle = T.line; }
  if (e.sweat) { ctx.fillStyle = '#2f6fd6'; for (let k = 0; k < 2; k++) { const f = (t * 1.3 + k * .5) % 1; ctx.globalAlpha *= 1; ctx.beginPath(); ctx.ellipse((k ? 70 : -70), 70 * st + f * 120, 9, 14, 0, 0, 7); ctx.fill(); } }
  ctx.restore(); ctx.lineCap = 'butt';
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
V.choices = (e, lt, t) => { // answer options A / B / C
  const opts = e.items, h = 120, gap = 34;
  opts.forEach((o, i) => {
    const k = spring(lt - i * (e.step || .45)); if (k <= 0) return;
    const y = (i - (opts.length - 1) / 2) * (h + gap); ctx.save(); ctx.translate((1 - k) * 600, y);
    ctx.fillStyle = D.theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.08)'; rr(-430, -h / 2, 860, h, 26); ctx.fill();
    ctx.strokeStyle = alphaCol(o.color || T.acc, .9); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = o.color || T.acc; rr(-410, -h / 2 + 18, h - 36, h - 36, 18); ctx.fill();
    font('IDB', 54); ctx.fillStyle = '#0b0b0b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.key || 'АБВГ'[i], -410 + (h - 36) / 2, 3);
    font('IDX', 50); ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.fillText(o.text, -270, 3); ctx.textBaseline = 'alphabetic'; ctx.restore();
  });
};
V.lines = (e, lt, t) => { // Asch test card: sample line on the left, options 1 2 3 on the right. mark (correct idx 1..3, markAt), wrong (idx, wrongAt), len [s, a, b, c]
  const L = e.len || [300, 230, 300, 370], pw = 880, ph = 640;
  ctx.fillStyle = D.theme === 'light' || D.theme === 'doodle' ? '#ffffff' : '#f3efe6'; glow('rgba(0,0,0,0.5)', 40); rr(-pw / 2, -ph / 2, pw, ph, 30); ctx.fill(); noGlow();
  ctx.strokeStyle = '#1b1820'; ctx.lineWidth = 6; ctx.setLineDash([14, 12]); ctx.beginPath(); ctx.moveTo(-pw / 2 + 280, -ph / 2 + 40); ctx.lineTo(-pw / 2 + 280, ph / 2 - 40); ctx.stroke(); ctx.setLineDash([]);
  const base = ph / 2 - 120, draw = (x, len, k, col) => { ctx.strokeStyle = col; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - len * easeOut(k)); ctx.stroke(); ctx.lineCap = 'butt'; };
  draw(-pw / 2 + 140, L[0], lt / .5, '#1b1820');
  font('IDX', 40); ctx.fillStyle = '#7a7480'; ctx.textAlign = 'center'; ctx.fillText('ОБРАЗЕЦ', -pw / 2 + 140, base + 80);
  for (let i = 0; i < 3; i++) {
    const x = -pw / 2 + 400 + i * 175, st = (e.step ?? .35) * i + .3, k = (lt - st) / .45; if (k <= 0) continue;
    const isMark = e.mark === i + 1 && lt >= (e.markAt ?? 99), isWrong = e.wrong === i + 1 && lt >= (e.wrongAt ?? 99);
    const col = isMark ? '#18b85a' : isWrong ? '#e2322f' : '#1b1820';
    if (isMark || isWrong) { const q = spring(lt - (isMark ? e.markAt : e.wrongAt)); ctx.fillStyle = alphaCol(col, .14); rr(x - 70, base - 420, 140, 520, 24); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 8 * q; ctx.stroke(); }
    draw(x, L[i + 1], k, col);
    font('IDB', 70); ctx.fillStyle = col; ctx.fillText(String(i + 1), x, base + 88);
  }
};
V.crowd = (e, lt, t) => { // row of n heads, bubbles with answers appear one by one (go + step*i); last head = "ВЫ". look: heads turn to you; ally: index that answers allyAns in green
  const n = e.n || 8, gap = 112, x0 = -(n - 1) * gap / 2, go = e.go ?? 0, step = e.step ?? .5;
  for (let i = 0; i < n; i++) {
    const you = i === n - 1, x = x0 + i * gap, bob = Math.sin(t * 2 + i) * 4;
    const isAlly = e.ally !== undefined && i === e.ally;
    ctx.save(); ctx.translate(x, bob);
    ctx.fillStyle = you ? T.acc : isAlly ? '#18b85a' : '#5d5566'; ctx.beginPath(); ctx.ellipse(0, 120, 52, 62, 0, Math.PI, 0); ctx.fill(); // shoulders
    ctx.fillStyle = you ? '#ffd9c2' : '#e8d5c4'; ctx.beginPath(); ctx.arc(0, 30, 42, 0, 7); ctx.fill();
    const lk = e.look && lt >= (e.lookAt ?? 0) && !you ? 7 : 0;
    ctx.fillStyle = '#1b1820'; ctx.beginPath(); ctx.arc(-14 + lk, 26, 6, 0, 7); ctx.arc(14 + lk, 26, 6, 0, 7); ctx.fill();
    if (you && e.sweat) { ctx.fillStyle = '#7fd3ff'; const yy = 10 + ((t * 60) % 40); ctx.beginPath(); ctx.arc(40, yy, 7, 0, 7); ctx.fill(); }
    // bubble
    const ans = you ? e.you : isAlly ? (e.allyAns || '2') : e.ans; const at = go + step * i, k = spring(lt - at);
    if (ans !== undefined && ans !== '' && lt >= at) {
      const col = you ? T.acc : isAlly ? '#18b85a' : '#ffffff'; ctx.save(); ctx.translate(0, -60); ctx.scale(k, k);
      ctx.fillStyle = col; rr(-46, -92, 92, 84, 22); ctx.fill(); ctx.beginPath(); ctx.moveTo(-12, -10); ctx.lineTo(0, 12); ctx.lineTo(12, -10); ctx.fill();
      font('IDB', 62); ctx.fillStyle = you || isAlly ? '#ffffff' : '#1b1820'; ctx.textAlign = 'center'; ctx.fillText(ans, 0, -28); ctx.restore();
    }
    if (you) { font('IDX', 38); ctx.fillStyle = T.acc; ctx.textAlign = 'center'; ctx.fillText('ВЫ', 0, 230); }
    ctx.restore();
  }
};
V.smokeroom = (e, lt, t) => { // waiting room fills with smoke (Latané & Darley 1968). n seated people at desks, you (index, accent, "ВЫ"),
  // smoke f0 -> f1 (0..1 of room height from ceiling) over dur from go / go_on; puff: vent spews; calm: others keep writing; stand / stand_on: you get up and walk to door (door: true)
  const n = e.n || 1, you = e.you ?? 0, W = 940, H = 720, top = -360, bot = top + H;
  const sg = e.go ?? 0, L = lerp(e.f0 ?? 0, e.f1 ?? (e.f0 ?? 0), easeIO((lt - sg) / (e.dur || 3)));
  // room: back wall, floor, skirting
  ctx.fillStyle = '#2a2730'; rr(-W / 2, top, W, H, 26); ctx.fill();
  ctx.fillStyle = '#3a3440'; ctx.fillRect(-W / 2, bot - 210, W, 210);
  ctx.fillStyle = '#4a4250'; ctx.fillRect(-W / 2, bot - 214, W, 8);
  // vent top-left
  const vx = -W / 2 + 70, vy = top + 70; ctx.fillStyle = '#9a9aa4'; rr(vx, vy, 130, 80, 10); ctx.fill();
  ctx.strokeStyle = '#55555e'; ctx.lineWidth = 6; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(vx + 14, vy + 16 + i * 16); ctx.lineTo(vx + 116, vy + 16 + i * 16); ctx.stroke(); }
  // clock on wall
  ctx.fillStyle = '#efe9e0'; ctx.beginPath(); ctx.arc(W / 2 - 120, top + 110, 50, 0, 7); ctx.fill(); ctx.strokeStyle = '#1b1820'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2 - 120, top + 110); ctx.lineTo(W / 2 - 120 + 34 * Math.cos(t * 1.4), top + 110 + 34 * Math.sin(t * 1.4)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2 - 120, top + 110); ctx.lineTo(W / 2 - 120, top + 84); ctx.stroke();
  // door with exit sign
  if (e.door) { const dx = W / 2 - 230, dy = bot - 470; ctx.fillStyle = '#5b4636'; rr(dx, dy, 170, 470, 8); ctx.fill(); ctx.fillStyle = '#e0b04a'; ctx.beginPath(); ctx.arc(dx + 30, dy + 250, 10, 0, 7); ctx.fill();
    glow('#18e070', 30); ctx.fillStyle = '#18b85a'; rr(dx + 10, dy - 70, 150, 50, 8); ctx.fill(); noGlow(); font('IDX', 30); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('ВЫХОД', dx + 85, dy - 34); }
  // people at desks
  const gap = n > 1 ? 280 : 0, x0 = -(n - 1) * gap / 2 - (e.door ? 90 : 0);
  const st = e.stand !== undefined ? clamp((lt - e.stand) / .5) : 0, walk = e.stand !== undefined ? easeIO((lt - e.stand - .7) / 1.6) : 0;
  for (let i = 0; i < n; i++) {
    const me = i === you, x = x0 + i * gap, deskY = bot - 150;
    let px = x, py = deskY - 120 + Math.sin(t * 2 + i) * 3;
    if (me) { py -= 110 * st; px = lerp(x, W / 2 - 145, walk); }
    ctx.save(); ctx.translate(px, py);
    ctx.fillStyle = me ? T.acc : '#6d6578'; ctx.beginPath(); ctx.ellipse(0, 110, 62, 72, 0, Math.PI, 0); ctx.fill(); if (me && st > 0) { ctx.fillRect(-58, 108, 116, 110 * st); }
    ctx.fillStyle = me ? '#ffd9c2' : '#e8d5c4'; ctx.beginPath(); ctx.arc(0, 20, 48, 0, 7); ctx.fill();
    const worried = me && L > .25; ctx.fillStyle = '#1b1820';
    ctx.beginPath(); ctx.arc(-16, 16 - (worried ? 4 : 0), worried ? 8 : 6, 0, 7); ctx.arc(16, 16 - (worried ? 4 : 0), worried ? 8 : 6, 0, 7); ctx.fill();
    if (!me && e.calm) { ctx.strokeStyle = '#1b1820'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-12, 44); ctx.lineTo(12, 44); ctx.stroke(); }
    if (worried) { ctx.beginPath(); ctx.ellipse(0, 46, 9, 12, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#7fd3ff'; const yy = -6 + ((t * 60) % 40); ctx.beginPath(); ctx.arc(46, yy, 8, 0, 7); ctx.fill(); }
    if (me) { font('IDX', 34); ctx.fillStyle = T.acc; ctx.textAlign = 'center'; ctx.fillText('ВЫ', 0, -48); }
    ctx.restore();
    // desk + paper + writing hand
    ctx.fillStyle = '#8a6a4a'; rr(x - 120, deskY, 240, 34, 6); ctx.fill(); ctx.fillStyle = '#6a4f36'; ctx.fillRect(x - 108, deskY + 34, 16, 110); ctx.fillRect(x + 92, deskY + 34, 16, 110);
    ctx.fillStyle = '#f4f1ea'; ctx.save(); ctx.translate(x, deskY - 4); ctx.rotate(-.06); ctx.fillRect(-60, -12, 120, 16); ctx.restore();
    if (!(me && st > 0)) { const hx = x + 30 + (e.calm || !me ? Math.sin(t * 9 + i) * 14 : 0); ctx.fillStyle = me ? '#ffd9c2' : '#e8d5c4'; ctx.beginPath(); ctx.arc(hx, deskY - 8, 16, 0, 7); ctx.fill(); }
  }
  // smoke: layer from ceiling down to L, wavy edge, drifting blobs
  if (L > 0.005) {
    ctx.save(); rr(-W / 2, top, W, H, 26); ctx.clip();
    const edge = top + L * H;
    const g = ctx.createLinearGradient(0, top, 0, edge + 40); g.addColorStop(0, 'rgba(200,200,206,0.92)'); g.addColorStop(1, 'rgba(170,170,178,0.62)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-W / 2, top);
    for (let x = -W / 2; x <= W / 2; x += 20) ctx.lineTo(x, edge + Math.sin(x / 70 + t * 1.3) * 22 + Math.sin(x / 31 - t * 2.1) * 10);
    ctx.lineTo(W / 2, top); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 9; i++) { const r = rng(hash('sm' + i)); const bx = -W / 2 + ((r() * W + t * (20 + r() * 30)) % W), by = top + r() * L * H, br = 70 + r() * 90;
      ctx.fillStyle = 'rgba(225,225,232,0.22)'; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  if (e.puff && L < .98) for (let i = 0; i < 6; i++) { const k = ((t * .8 + i / 6) % 1); ctx.fillStyle = `rgba(215,215,222,${.7 * (1 - k)})`;
    ctx.beginPath(); ctx.arc(vx + 65 + k * 160 + Math.sin(i * 3 + t) * 20, vy + 90 + k * 60, 26 + k * 70, 0, 7); ctx.fill(); }
};
V.button = (e, lt, t) => { // big glossy 3D push button: n (label on cap), color, press (sec after appear, or press_on word), pulse glow
  const c = e.color || '#ff2b2b', s = e.size || 1; ctx.scale(s, s);
  const pt = e.press !== undefined ? lt - e.press : -1;
  const down = pt >= 0 ? (pt < .12 ? pt / .12 : pt < .45 ? 1 : Math.max(0, 1 - (pt - .45) / .2)) : 0;
  // base: dark metal cylinder
  ctx.fillStyle = '#1a1a20'; ctx.beginPath(); ctx.ellipse(0, 90, 300, 95, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2c2c34'; ctx.fillRect(-300, 20, 600, 70); ctx.beginPath(); ctx.ellipse(0, 20, 300, 95, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#4a4a56'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, 20, 300, 95, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.ellipse(0, 10, 235, 72, 0, 0, 7); ctx.fill();
  // cap: cylinder side + dome, pushed down by `down`
  const h = 110 - 80 * down, top = 10 - h;
  const pulse = .55 + .45 * Math.sin(t * 5);
  glow(alphaCol(c, .9), 40 + 50 * pulse + 80 * down);
  const dark = alphaCol('#000000', .35);
  ctx.fillStyle = c; ctx.fillRect(-220, top, 440, h); ctx.beginPath(); ctx.ellipse(0, 10, 220, 66, 0, 0, Math.PI); ctx.fill(); noGlow();
  ctx.fillStyle = dark; ctx.fillRect(-220, top, 440, h); ctx.beginPath(); ctx.ellipse(0, 10, 220, 66, 0, 0, Math.PI); ctx.fill();
  const g = ctx.createRadialGradient(-70, top - 40, 10, 0, top, 260); g.addColorStop(0, '#ffffff'); g.addColorStop(.18, c); g.addColorStop(1, alphaCol('#000000', .0));
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, top, 220, 66, 0, 0, 7); ctx.fill();
  ctx.fillStyle = g; ctx.globalAlpha *= .55; ctx.beginPath(); ctx.ellipse(0, top, 220, 66, 0, 0, 7); ctx.fill(); ctx.globalAlpha /= .55;
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-80, top - 22, 70, 16, -.15, 0, 7); ctx.fill();
  if (e.n !== undefined) { ctx.save(); ctx.translate(0, top); ctx.scale(1, .32); font('IDB', 230); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(e.n), 0, 10); ctx.restore(); ctx.textBaseline = 'alphabetic'; }
  // press flash: expanding ring
  if (pt >= 0 && pt < .9) { const k = pt / .9; ctx.strokeStyle = alphaCol(c, (1 - k) * .9); ctx.lineWidth = 18 * (1 - k) + 2; ctx.beginPath(); ctx.ellipse(0, 10, 240 + 260 * k, 75 + 85 * k, 0, 0, 7); ctx.stroke(); }
};
V.voltmeter = (e, lt, t) => { // shock generator dial 0..max: v0 -> v1 over dur from go (sec) / go_on (word); zones, ОПАСНО and XXX at the end
  const max = e.max || 450, go = e.go ?? 0.2, k = easeIO((lt - go) / (e.dur || 1.2));
  const v = lerp(e.v0 ?? 0, e.v1 ?? 0, clamp(k)), R = 380, cy = 60;
  const ang = (x) => Math.PI + Math.PI * clamp(x / max);
  // body
  ctx.fillStyle = '#17141b'; rr(-470, -420, 940, 640, 46); ctx.fill(); ctx.strokeStyle = '#3a3340'; ctx.lineWidth = 6; ctx.stroke();
  for (const sx of [-430, 430]) for (const sy of [-380, 180]) { ctx.fillStyle = '#4a4450'; ctx.beginPath(); ctx.arc(sx, sy, 10, 0, 7); ctx.fill(); }
  // zones
  const zones = [[0, 75, '#2fe08a'], [75, 195, '#c8e02f'], [195, 300, '#ffb21a'], [300, 375, '#ff6a1a'], [375, 435, '#ff2b2b'], [435, max, '#7a0f1a']];
  ctx.lineWidth = 46; ctx.lineCap = 'butt';
  for (const [a, b, c] of zones) { ctx.strokeStyle = c; ctx.globalAlpha *= v >= a ? 1 : .28; ctx.beginPath(); ctx.arc(0, cy, R, ang(a), ang(b)); ctx.stroke(); ctx.globalAlpha /= v >= a ? 1 : .28; }
  // ticks every 15 V
  for (let x = 0; x <= max; x += 15) {
    const a = ang(x), big = x % 75 === 0, r0 = R - 40, r1 = R - (big ? 80 : 58);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = big ? 6 : 3; ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    if (big || x === max) { font('Mono', 30, 700); ctx.fillStyle = '#d8d0dc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(x), Math.cos(a) * (R - 118), cy + Math.sin(a) * (R - 118)); }
  }
  // danger labels
  font('IDX', 34); ctx.textBaseline = 'middle';
  const lab = (x, s, c) => { const a = ang(x); ctx.save(); ctx.translate(Math.cos(a) * (R + 46), cy + Math.sin(a) * (R + 46)); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.fillText(s, 0, 0); ctx.restore(); };
  lab(405, 'ОПАСНО', v >= 375 ? '#ff4a4a' : 'rgba(255,90,90,0.45)'); lab(443, 'XXX', v >= 435 ? '#ffffff' : 'rgba(255,255,255,0.4)');
  // needle (trembles while moving and at high voltage)
  const tremble = (k > 0 && k < 1 ? 1 : 0) * .02 + clamp((v - 300) / 150) * .012;
  const a = ang(v) + Math.sin(t * 47) * tremble;
  const hot = v >= 375 ? '#ff2b2b' : v >= 195 ? '#ffb21a' : '#2fe08a';
  glow(alphaCol(hot, .9), 30); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 12; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)); ctx.stroke(); noGlow();
  ctx.fillStyle = '#2a242e'; ctx.beginPath(); ctx.arc(0, cy, 42, 0, 7); ctx.fill(); ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(0, cy, 18, 0, 7); ctx.fill();
  // digital readout
  ctx.fillStyle = '#0a080c'; rr(-210, 100, 420, 100, 18); ctx.fill();
  font('IDX', 76); ctx.fillStyle = hot; ctx.textAlign = 'center'; glow(alphaCol(hot, .7), 24); ctx.fillText(Math.round(v / 15) * 15 + ' В', 0, 152); noGlow();
  ctx.textBaseline = 'alphabetic'; ctx.lineCap = 'butt';
  // spark when moving
  if (k > 0 && k < 1) { const sx = Math.cos(a) * (R - 30), sy = cy + Math.sin(a) * (R - 30); ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 4; glow('#7fd3ff', 20);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(sx, sy); const r = rng(hash('sp' + Math.floor(t * 20) + i)); ctx.lineTo(sx + (r() - .5) * 120, sy + (r() - .5) * 120); ctx.stroke(); } noGlow(); }
};
V.shiplock = (e, lt, t) => { // ship lock (шлюз), side view. Keyframes [[sec, value], ...] relative to element start:
  // level (0 low .. 1 high water in chamber), ship (x 0..1 across), gA (lower gate open 0..1), gB (upper gate open 0..1), valve (0..1 water flowing)
  const kf = (arr, d) => { if (!arr) return d; let v = arr[0][1]; for (let i = 0; i < arr.length; i++) { const [ts, vs] = arr[i]; if (lt >= ts) { v = vs; const n = arr[i + 1]; if (n && lt < n[0]) v = lerp(vs, n[1], easeIO((lt - ts) / (n[0] - ts))); } } return v; };
  const lvl = kf(e.level, 0), sx = kf(e.ship, .1), gA = kf(e.gA, 0), gB = kf(e.gB, 0), valve = kf(e.valve, 0), drain = kf(e.drain, 0);
  const Wd = 1060, x0 = -Wd / 2, lowY = 230, highY = -250, chamberL = -200, chamberR = 200, floor = 430;
  // scenery: hills, clouds, trees on the upper bank
  ctx.fillStyle = '#cfe3b8'; ctx.beginPath(); ctx.moveTo(x0, highY - 40); for (let x = x0; x <= x0 + Wd; x += 40) ctx.lineTo(x, highY - 120 - 70 * Math.sin(x * .006 + 1) - 30 * Math.sin(x * .017)); ctx.lineTo(x0 + Wd, lowY); ctx.lineTo(x0, lowY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 2; i++) { const cx = ((i * 520 + t * 18) % 1300) - 650, cyy = -620 + i * 90; for (const [dx, r] of [[-50, 40], [0, 58], [55, 42]]) { ctx.beginPath(); ctx.arc(cx + dx, cyy, r, 0, 7); ctx.fill(); } }
  const ink = '#2a2622', paper = T.panel || '#fbf7ee', water = '#5fb6ff', waterD = '#2f7fd6';
  const wob = (k) => Math.sin(t * 2.2 + k) * 4;
  // ground blocks: low riverbed left, chamber, high dam right
  ctx.fillStyle = '#d9c9a8'; ctx.fillRect(x0, floor, Wd, 360); // earth
  ctx.fillStyle = '#c7b48e'; ctx.fillRect(chamberR + 20, highY + 60, x0 + Wd - chamberR - 20, floor - highY - 60); // upper level ground under high river
  // water: low river (left), chamber (lvl), high river (right)
  const chY = lerp(lowY, highY, lvl);
  const wfill = (xa, xb, y) => { const g = ctx.createLinearGradient(0, y, 0, floor); g.addColorStop(0, water); g.addColorStop(1, waterD); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(xa, floor); ctx.lineTo(xa, y + wob(xa)); for (let x = xa; x <= xb; x += 20) ctx.lineTo(x, y + Math.sin(t * 2.4 + x * .02) * 5); ctx.lineTo(xb, floor); ctx.closePath(); ctx.fill(); };
  wfill(x0, chamberL, lowY);
  wfill(chamberL, chamberR, chY);
  ctx.save(); ctx.beginPath(); ctx.rect(chamberR + 20, -400, 400, highY + 60 + 400); ctx.clip(); wfill(chamberR + 20, x0 + Wd, highY); ctx.restore();
  ctx.fillStyle = '#c7b48e'; ctx.fillRect(chamberR + 20, highY + 60, x0 + Wd - chamberR - 20, floor - highY - 60);
  for (const [tx, ts] of [[-470, 1], [-410, .8], [460, .9]]) { const ty = tx > 0 ? highY - 20 : lowY - 10; ctx.save(); ctx.translate(tx, ty + (tx > 0 ? 0 : 0)); ctx.scale(ts, ts); ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-8, -30, 16, 40); ctx.fillStyle = '#4f9a5a'; ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -150 + Math.sin(t * 1.5 + tx) * 3); ctx.lineTo(55, -25); ctx.lineTo(-55, -25); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  // chamber walls
  ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(chamberL, floor); ctx.lineTo(chamberR + 20, floor); ctx.lineTo(chamberR + 20, highY + 60); ctx.lineTo(x0 + Wd, highY + 60); ctx.stroke();
  // valve stream (from upper river into chamber through pipe)
  if (valve > 0.01) { ctx.strokeStyle = alphaCol(water, .9); ctx.lineWidth = 26 * valve; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(chamberR + 20, highY + 110 + i * 14); ctx.quadraticCurveTo(chamberR - 30, highY + 140 + i * 10, chamberR - 60 - i * 20, chY + 10); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 10; i++) { const r = rng(hash('bub' + i)); const yy = chY + 20 + ((t * 120 + r() * 200) % 200); ctx.beginPath(); ctx.arc(chamberR - 80 - r() * 120, yy, 4 + r() * 6, 0, 7); ctx.fill(); } }
  if (drain > 0.01) { ctx.strokeStyle = alphaCol(water, .9); ctx.lineWidth = 24 * drain; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(chamberL + 40, floor - 20 - i * 12); ctx.quadraticCurveTo(chamberL - 10, floor - 10, chamberL - 90 - i * 30, lowY + 12); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 8; i++) { const r = rng(hash('dr' + i)); const xx = chamberL - 60 - ((t * 140 + r() * 160) % 160); ctx.beginPath(); ctx.arc(xx, lowY + 14 + r() * 30, 4 + r() * 5, 0, 7); ctx.fill(); } }
  // gates: rise up out of water when open (vertical lift gates)
  const gate = (gx, top, open, col) => { const h = floor - top + 20, lift = open * (h + 40); ctx.fillStyle = col; ctx.strokeStyle = ink; ctx.lineWidth = 6; rr(gx - 18, top - lift, 36, h, 6); ctx.fill(); ctx.stroke();
    for (let y = top - lift + 30; y < top - lift + h - 10; y += 50) { ctx.beginPath(); ctx.moveTo(gx - 18, y); ctx.lineTo(gx + 18, y); ctx.stroke(); } };
  gate(chamberL, highY - 30, gA, '#e0452b'); gate(chamberR + 20, highY - 30, gB, '#e0452b');
  // ship rides chamber water when inside, else river level
  const shipX = lerp(x0 + 60, x0 + Wd - 60, sx);
  const inCh = shipX > chamberL && shipX < chamberR + 20;
  const sy = shipX <= chamberL ? lowY : shipX >= chamberR + 20 ? highY : chY;
  ctx.save(); ctx.translate(shipX, sy + Math.sin(t * 2) * 4); ctx.rotate(Math.sin(t * 1.6) * .015); ctx.scale(1.15, 1.15); if (e.flip) ctx.scale(-1, 1);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-140, -50); ctx.lineTo(150, -50); ctx.lineTo(110, 26); ctx.lineTo(-120, 26); ctx.closePath(); ctx.fill(); ctx.stroke(); // hull
  ctx.fillStyle = e.color || '#2f6fd6'; ctx.fillRect(-128, -18, 262, 14);
  ctx.fillStyle = '#ffffff'; rr(-80, -120, 130, 70, 8); ctx.fill(); ctx.stroke(); // cabin
  ctx.fillStyle = '#9fdcff'; for (let i = 0; i < 3; i++) { rr(-66 + i * 40, -104, 26, 24, 4); ctx.fill(); }
  ctx.fillStyle = '#e0452b'; rr(-10, -170, 34, 52, 6); ctx.fill(); ctx.stroke(); // funnel
  if (e.smoke !== false) { ctx.fillStyle = 'rgba(120,110,100,0.35)'; for (let i = 0; i < 4; i++) { const k = ((t * .8 + i * .25) % 1); ctx.beginPath(); ctx.arc(7 - k * 90, -190 - k * 120, 14 + k * 26, 0, 7); ctx.fill(); } }
  if (e.face) { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(110, -20, 6, 0, 7); ctx.fill(); }
  ctx.restore();
  void inCh;
};
V.elevator = (e, lt, t) => { // lift shaft in section (doodle). Keyframes [[sec, value], ...] from element start:
  // pos (cab 0 ground .. 1 top), cw (counterweight 0 low .. 1 high, default 1-pos), cwv (counterweight visible 0..1),
  // r1 r2 r3 (rope state: 0 ok, 0.3 frayed/glowing, 1 snapped), brake (safety wedges 0..1), sparks (0..1), gov (governor tripped 0..1),
  // spd (governor speed), smoke (motor overload 0..1), mood: [[sec, "happy|scared|calm|wave"], ...] person in the cab.
  // mode: "brake" close-up of the safety wedge on the rail, "governor" close-up of the speed governor.
  const kf = (arr, d) => { if (arr === undefined) return d; if (!Array.isArray(arr)) return arr; let v = arr[0][1]; for (let i = 0; i < arr.length; i++) { const [ts, vs] = arr[i]; if (lt >= ts) { v = vs; const n = arr[i + 1]; if (n && lt < n[0] && typeof vs === 'number') v = lerp(vs, n[1], (e.linear ? clamp : easeIO)((lt - ts) / (n[0] - ts))); } } return v; };
  const ink = '#2a2622', steel = '#9aa3ad', red = '#e0452b', yel = '#f2b51c';
  const sd2 = hash(e.id || 'lift');
  const brake = kf(e.brake, 0), sparks = kf(e.sparks, 0), gov = kf(e.gov, 0), spd = kf(e.spd, 1);
  const sparkBurst = (x, y, dir, k) => { if (k <= .02) return; ctx.save(); glow('#ffcf4a', 24); ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) { const r = rng(hash('sp' + Math.floor(t * 24) + i + x)); const a = -Math.PI / 2 + dir * (.3 + r() * 1.3), L = (40 + r() * 140) * k;
      ctx.strokeStyle = r() > .5 ? '#ffe27a' : '#ff9a2b'; ctx.lineWidth = 3 + r() * 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y - Math.sin(a) * L * -1); ctx.stroke(); }
    noGlow(); ctx.restore(); };
  if (e.mode === 'brake') { // close-up: rail in the middle, cab frame on the left, wedge rises and grips
    ctx.fillStyle = '#e9e0cc'; rr(-420, -480, 840, 960, 40); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.stroke();
    const slide = (1 - brake) * Math.sin(t * 0) ; void slide;
    const fall = kf(e.fall, 0); // rail texture scrolls while the cab falls
    ctx.save(); rr(-420, -480, 840, 960, 40); ctx.clip();
    ctx.fillStyle = steel; ctx.fillRect(40, -480, 90, 960); ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.strokeRect(40, -490, 90, 980);
    ctx.strokeStyle = 'rgba(42,38,34,0.35)'; ctx.lineWidth = 4; for (let k = 0; k < 9; k++) { const y = ((k * 130 + fall * 2600) % 1170) - 585; ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(130, y); ctx.stroke(); }
    // cab frame (left) with the wedge housing
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 8; rr(-400, -300, 330, 560, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd36b'; rr(-70, -60, 110, 260, 10); ctx.fill(); ctx.stroke(); // housing
    // wedge: slides up and right into the rail
    const wy = lerp(150, 10, brake), wx = lerp(-40, 10, brake);
    ctx.fillStyle = red; ctx.beginPath(); ctx.moveTo(wx, wy - 120); ctx.lineTo(wx + 30, wy - 120); ctx.lineTo(wx + 30, wy + 60); ctx.lineTo(wx - 30, wy + 60); ctx.closePath(); ctx.fill(); ctx.stroke();
    // lever from governor rope
    ctx.strokeStyle = ink; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-200, 230); ctx.lineTo(wx - 10, wy + 60); ctx.stroke();
    ctx.strokeStyle = '#6b5b4a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-200, 230); ctx.lineTo(-200, 480); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.restore();
    sparkBurst(40, wy - 40, 1, sparks); sparkBurst(40, wy + 20, 1, sparks * .7);
    if (brake > .95) { const q = spring(lt - (e.lockAt || 0), 12, 7); void q; }
    return;
  }
  if (e.mode === 'governor') { // close-up: wheel with flyweights; spins with spd, weights fly out, pawl catches at gov
    ctx.fillStyle = '#e9e0cc'; rr(-420, -480, 840, 960, 40); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.stroke();
    const ang = (e._ang = (t * 2.2 * spd)) * (1 - gov * .999) + gov * 0; const R = 230;
    ctx.save(); ctx.translate(0, -40);
    ctx.lineWidth = 10; ctx.strokeStyle = ink; ctx.fillStyle = gov > .5 ? '#ffd9d2' : '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill(); ctx.stroke();
    // ratchet teeth on the rim
    for (let k = 0; k < 16; k++) { const a = ang + k * Math.PI / 8; ctx.fillStyle = ink; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(R - 4, -14); ctx.lineTo(R + 30, 0); ctx.lineTo(R - 4, 14); ctx.fill(); ctx.restore(); }
    // flyweights swing out with speed
    const out = clamp((spd - 1) / 3); for (const sgn of [-1, 1]) { ctx.save(); ctx.rotate(ang); const px = sgn * lerp(60, 150, out); ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px, -40 * sgn); ctx.stroke(); ctx.fillStyle = out > .7 ? red : yel; ctx.beginPath(); ctx.arc(px, -40 * sgn, 38, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
    // pawl (catch) on the right drops into teeth
    ctx.save(); ctx.translate(R + 70, -120); ctx.rotate(lerp(-.5, .35, gov)); ctx.fillStyle = gov > .5 ? red : '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-30, 150); ctx.lineTo(10, 150); ctx.lineTo(24, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(12, 6, 10, 0, 7); ctx.fill(); ctx.restore();
    // motion lines when fast
    if (spd > 1.5 && gov < .5) { ctx.strokeStyle = 'rgba(42,38,34,0.5)'; ctx.lineWidth = 6; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, R + 60 + k * 22, ang * 1.0 + k, ang + k + .9); ctx.stroke(); } }
    ctx.restore();
    // rope going down to the cab
    ctx.strokeStyle = '#6b5b4a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-R, -40); ctx.lineTo(-R, 470); ctx.moveTo(R, -40); ctx.lineTo(R, 470); ctx.stroke();
    if (gov > .5) sparkBurst(R + 50, -60, -1, clamp((1 - (lt - (e.tripAt || 0)) / 1.2)) * (sparks || 1));
    return;
  }
  const pos = kf(e.pos, 0), cwp = kf(e.cw, 1 - pos), cwv = kf(e.cwv, 1), smoke = kf(e.smoke, 0);
  const top = -700, mrB = -430, pit = 450, wl = -340, wr = 340, SH = 110, SX = 70, SY = -575;
  const cabW = 280, cabH = 250, cabX = SX - SH; // cab centred under the sheave's left side
  const cabB = lerp(pit - 10, mrB + 30 + cabH, pos), cabT = cabB - cabH;
  const cwX = SX + SH, cwH = 190, cwT = lerp(pit - 10 - cwH, mrB + 40, cwp);
  // building: machine room + shaft
  ctx.fillStyle = '#e9e0cc'; ctx.fillRect(wl, top, wr - wl, pit - top);
  ctx.fillStyle = '#d6c9ad'; ctx.fillRect(wl, top, wr - wl, mrB - top);
  ctx.strokeStyle = ink; ctx.lineWidth = 9; ctx.lineJoin = 'round';
  wobbleLine([[wl, top], [wr, top], [wr, pit], [wl, pit], [wl, top]], sd2 + 'box', t, 2); ctx.stroke();
  ctx.lineWidth = 6; wobbleLine([[wl, mrB], [SX - SH - 40, mrB]], sd2 + 'mf1', t, 2); ctx.stroke(); wobbleLine([[SX - SH + 40, mrB], [SX + SH - 40, mrB]], sd2 + 'mf2', t, 2); ctx.stroke(); wobbleLine([[SX + SH + 40, mrB], [wr, mrB]], sd2 + 'mf3', t, 2); ctx.stroke();
  // floors: landing marks + little doors on the left wall
  for (let k = 0; k < 4; k++) { const fy = lerp(pit - 10, mrB + 30 + cabH, k / 3); ctx.strokeStyle = 'rgba(42,38,34,0.35)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(wl, fy); ctx.lineTo(wl - 40, fy); ctx.stroke();
    ctx.fillStyle = Math.abs(pos - k / 3) < .04 ? '#7fd36b' : 'rgba(42,38,34,0.25)'; ctx.beginPath(); ctx.arc(wl - 22, fy - 40, 9, 0, 7); ctx.fill(); }
  // rails
  ctx.strokeStyle = steel; ctx.lineWidth = 10; for (const rx of [cabX - cabW / 2 - 14, cabX + cabW / 2 + 14]) { ctx.beginPath(); ctx.moveTo(rx, mrB); ctx.lineTo(rx, pit); ctx.stroke(); }
  // governor (top left) + its rope down to the pit, tied to the cab
  const GX = wl + 55, GY = top + 95, gr = 34, ga = t * (2 + 6 * clamp(spd - 1, 0, 3)) * (gov > .5 ? 0 : 1);
  ctx.strokeStyle = '#6b5b4a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(GX - gr, GY); ctx.lineTo(GX - gr, pit - 20); ctx.moveTo(GX + gr, GY); ctx.lineTo(GX + gr, cabB - 60); ctx.stroke();
  ctx.fillStyle = gov > .5 ? red : '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(GX, GY, gr, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(GX, GY); ctx.lineTo(GX + Math.cos(ga) * gr, GY + Math.sin(ga) * gr); ctx.moveTo(GX, GY); ctx.lineTo(GX - Math.cos(ga) * gr, GY - Math.sin(ga) * gr); ctx.stroke();
  if (gov > .5) { ctx.strokeStyle = red; ctx.lineWidth = 6; for (let k = 0; k < 3; k++) { const a = -2.4 + k * .6; ctx.beginPath(); ctx.moveTo(GX + Math.cos(a) * (gr + 10), GY + Math.sin(a) * (gr + 10)); ctx.lineTo(GX + Math.cos(a) * (gr + 30), GY + Math.sin(a) * (gr + 30)); ctx.stroke(); } }
  // motor + traction sheave
  const shk = smoke > .05 ? Math.sin(t * 50) * 4 * smoke : 0;
  ctx.save(); ctx.translate(shk, 0);
  ctx.fillStyle = smoke > .3 ? '#ffb3a6' : '#8fb7e6'; ctx.strokeStyle = ink; ctx.lineWidth = 7; rr(SX - 60, SY - 105, 120, 70, 12); ctx.fill(); ctx.stroke();
  const rot = pos * 9 + (e.spin ? t * 3 : 0);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(SX, SY, SH - 30, 0, 7); ctx.fill(); ctx.lineWidth = 9; ctx.stroke();
  ctx.lineWidth = 6; for (let k = 0; k < 4; k++) { const a = rot + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(SX, SY); ctx.lineTo(SX + Math.cos(a) * (SH - 34), SY + Math.sin(a) * (SH - 34)); ctx.stroke(); }
  ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(SX, SY, 16, 0, 7); ctx.fill();
  ctx.restore();
  if (smoke > .02) { for (let i = 0; i < 6; i++) { const k = ((t * .9 + i / 6) % 1); ctx.fillStyle = `rgba(90,85,80,${.45 * smoke * (1 - k)})`; ctx.beginPath(); ctx.arc(SX - 20 + Math.sin(i * 3 + t) * 30, SY - 120 - k * 160, 16 + k * 40, 0, 7); ctx.fill(); } }
  // ropes: 3 per side, over the top of the sheave
  const ropes = [kf(e.r1, 0), kf(e.r2, 0), kf(e.r3, 0)];
  ctx.lineCap = 'round';
  ropes.forEach((st, i) => {
    const dx = (i - 1) * 16, snapped = st > .5, fray = !snapped && st > .15;
    ctx.strokeStyle = fray ? (Math.sin(t * 14) > 0 ? red : '#ff9a7a') : '#4a4a52'; ctx.lineWidth = 7;
    if (fray) glow(alphaCol(red, .8), 18);
    if (!snapped) {
      ctx.beginPath(); ctx.arc(SX, SY, SH - 8 - i * 8, Math.PI, 0); ctx.stroke(); // over the sheave
      ctx.beginPath(); ctx.moveTo(SX - SH + 8 + i * 8, SY); ctx.lineTo(cabX + dx, cabT); ctx.stroke();
      if (cwv > .05) { ctx.beginPath(); ctx.moveTo(SX + SH - 8 - i * 8, SY); ctx.lineTo(cwX + dx * .6, cwT); ctx.stroke(); }
    } else { // whipping loose ends
      const k = clamp((st - .5) * 2), wv = Math.sin(t * 9 + i) * 30 * (1 - k * .5);
      ctx.beginPath(); ctx.arc(SX, SY, SH - 8 - i * 8, Math.PI, Math.PI * 1.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(SX - SH + 8 + i * 8, SY); ctx.quadraticCurveTo(SX - SH - 40 + wv, SY + 90, SX - SH + 10 - wv, SY + 160 + i * 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cabX + dx, cabT); ctx.quadraticCurveTo(cabX + dx + wv, cabT - 50, cabX + dx + 30 - wv, cabT - 100 - i * 15); ctx.stroke();
    }
    noGlow();
  });
  ctx.lineCap = 'butt';
  // counterweight
  if (cwv > .02) { ctx.save(); ctx.translate(cwX, cwT + cwH / 2); const q = cwv; ctx.scale(q, q); ctx.fillStyle = '#5a5f6a'; ctx.strokeStyle = ink; ctx.lineWidth = 7; rr(-55, -cwH / 2, 110, cwH, 10); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(-45, -cwH / 2 + k * cwH / 5); ctx.lineTo(45, -cwH / 2 + k * cwH / 5); ctx.stroke(); } ctx.restore(); }
  // cab
  ctx.save(); ctx.translate(cabX, cabB);
  ctx.fillStyle = '#fbf7ee'; ctx.strokeStyle = ink; ctx.lineWidth = 9; rr(-cabW / 2, -cabH, cabW, cabH, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd36b'; ctx.fillRect(-cabW / 2 + 8, -cabH + 8, cabW - 16, 16);
  // safety wedges at both rails (bottom corners)
  for (const sg of [-1, 1]) { const bx = sg * (cabW / 2 + 2), wy = lerp(-10, -40, brake); ctx.fillStyle = brake > .3 ? red : '#ffd36b'; ctx.strokeStyle = ink; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(bx, wy - 46); ctx.lineTo(bx + sg * lerp(4, 14, brake), wy - 46); ctx.lineTo(bx + sg * lerp(4, 14, brake), wy + 6); ctx.lineTo(bx - sg * 10, wy + 6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // person
  const mood = kf(e.mood, 'calm'), scared = mood === 'scared', hap = mood === 'happy' || mood === 'wave';
  const pj = scared ? Math.sin(t * 40) * 3 : 0; ctx.translate(pj, 0);
  ctx.strokeStyle = ink; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(0, -180, 34, 37, 0, 0, 7); ctx.fillStyle = '#fbf7ee'; ctx.fill(); ctx.stroke();
  wobbleLine([[0, -143], [0, -60]], sd2 + 'pb', t, 2); ctx.stroke();
  wobbleLine([[0, -60], [-28, 0]], sd2 + 'pl', t, 2); ctx.stroke(); wobbleLine([[0, -60], [28, 0]], sd2 + 'pr', t, 2); ctx.stroke();
  const wav = mood === 'wave' ? Math.sin(t * 10) * 20 : 0;
  const arms = scared ? [[-60, -190], [60, -190]] : mood === 'wave' ? [[-40, -80], [70, -175 + wav]] : hap ? [[-55, -150], [55, -150]] : [[-38, -80], [38, -80]];
  wobbleLine([[0, -125], arms[0]], sd2 + 'pa', t, 2); ctx.stroke(); wobbleLine([[0, -125], arms[1]], sd2 + 'pc', t, 2); ctx.stroke();
  ctx.fillStyle = ink; if (scared) { ctx.beginPath(); ctx.arc(-12, -188, 8, 0, 7); ctx.arc(12, -188, 8, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -164, 10, 13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#5fb6ff'; for (let k = 0; k < 2; k++) { const yy = -205 + ((t * 80 + k * 30) % 60); ctx.beginPath(); ctx.arc(38 + k * 8, yy, 6, 0, 7); ctx.fill(); } }
  else { ctx.beginPath(); ctx.arc(-12, -186, 5, 0, 7); ctx.arc(12, -186, 5, 0, 7); ctx.fill(); ctx.beginPath(); if (hap) ctx.arc(0, -172, 13, .2, Math.PI - .2); else { ctx.moveTo(-10, -165); ctx.lineTo(10, -165); } ctx.stroke(); }
  ctx.lineCap = 'butt'; ctx.restore();
  // sparks at the rails
  sparkBurst(cabX - cabW / 2 - 14, cabB - 40, -1, sparks); sparkBurst(cabX + cabW / 2 + 14, cabB - 40, 1, sparks);
  // pit buffer springs
  ctx.strokeStyle = ink; ctx.lineWidth = 5; for (const bx of [cabX, cwX]) { ctx.beginPath(); for (let k = 0; k <= 8; k++) ctx.lineTo(bx + (k % 2 ? 18 : -18), pit - 2 - k * 6); ctx.stroke(); }
};
V.keys = (e, lt, t) => { // keyboard: layout ru|en, hl letters light up at hlAt, typing = random presses
  const rows = e.layout === 'en' ? ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'] : ['ЙЦУКЕНГШЩЗХ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];
  const k = 76, g = 10, light = D.theme === 'light' || D.theme === 'doodle', hl = e.hl || '', hk = clamp((lt - (e.hlAt ?? .6)) / .4);
  const pressed = e.typing ? rng(hash('k' + Math.floor(t * 9)))() : -1;
  rows.forEach((row, r) => {
    const w = row.length * (k + g) - g, y = (r - 1) * (k + g) - k / 2;
    [...row].forEach((ch, i) => {
      const x = -w / 2 + i * (k + g) + r * 18, on = hl.includes(ch), pr = e.typing && Math.floor(pressed * 30) === r * 11 + i;
      ctx.fillStyle = light ? '#d9d2c6' : '#05060a'; rr(x, y + 6, k, k, 14); ctx.fill();
      ctx.fillStyle = on && hk > 0 ? alphaCol(e.color || T.acc, .25 + .75 * hk) : (light ? '#ffffff' : '#1d2333'); rr(x, y + (pr ? 6 : 0), k, k, 14); ctx.fill();
      font('IDX', 36); ctx.fillStyle = on && hk > .5 ? '#fff' : (light ? '#2a2733' : '#cfd6e6'); ctx.textAlign = 'center'; ctx.fillText(ch, x + k / 2, y + k / 2 + 13 + (pr ? 6 : 0));
    });
  });
};
V.battery = (e, lt, t) => { // big phone battery: pct from->to over dur, colour by level, blinks when low, charging bolt
  const k = easeOut(lt / (e.dur || 1.6)), p = clamp(lerp(e.p0 ?? 100, e.p1 ?? e.p0 ?? 100, k) / 100);
  const w = 520, h = 250, col = e.color || (p > .5 ? '#2fd36b' : p > .2 ? '#ffc21a' : '#ff3b3b');
  const blink = p <= .1 && !e.charging ? (Math.sin(t * 12) > 0 ? 1 : .25) : 1;
  ctx.fillStyle = D.theme === 'light' || D.theme === 'doodle' ? '#ffffff' : '#10131b'; rr(-w / 2, -h / 2, w, h, 48); ctx.fill();
  ctx.strokeStyle = D.theme === 'light' ? '#16151a' : '#e8ecf5'; ctx.lineWidth = 18; ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; rr(w / 2 + 6, -48, 36, 96, 14); ctx.fill();
  ctx.globalAlpha *= blink; if (D.theme !== 'light') glow(alphaCol(col, .8), 40); ctx.fillStyle = col;
  rr(-w / 2 + 24, -h / 2 + 24, Math.max(18, (w - 48) * p), h - 48, 26); ctx.fill(); noGlow(); ctx.globalAlpha /= blink;
  if (e.charging) { const pu = 1 + .08 * Math.sin(t * 8); ctx.save(); ctx.scale(.42 * pu, .42 * pu); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#16151a'; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(40, -220); ctx.lineTo(-110, 30); ctx.lineTo(0, 30); ctx.lineTo(-40, 220); ctx.lineTo(110, -40); ctx.lineTo(0, -40); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  if (e.pct !== false) { font('IDB', 92); ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.globalAlpha *= blink; ctx.fillText(`${Math.round(p * 100)}%`, 0, h / 2 + 120); ctx.globalAlpha /= blink; }
};
V.socket = (e, lt, t) => { // wall power outlet (EU), glows softly
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#cfc6b8'; ctx.lineWidth = 6; glow('rgba(0,0,0,0.18)', 30); rr(-150, -150, 300, 300, 46); ctx.fill(); noGlow(); ctx.stroke();
  ctx.fillStyle = '#f1ece4'; ctx.beginPath(); ctx.arc(0, 0, 105, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a2733'; ctx.beginPath(); ctx.arc(-42, 0, 17, 0, 7); ctx.arc(42, 0, 17, 0, 7); ctx.fill();
  if (e.glow !== false) { ctx.strokeStyle = alphaCol(T.acc, .35 + .25 * Math.sin(t * 4)); ctx.lineWidth = 10; rr(-170, -170, 340, 340, 56); ctx.stroke(); }
};
V.plug = (e, lt, t) => { // phone bottom with port, cable plug rises from below; fit:false = bounces off (wrong connector)
  const fit = e.fit !== false, tTouch = .8;
  ctx.fillStyle = "#16151a"; rr(-150, -560, 300, 600, 56); ctx.fill(); ctx.fillStyle = "#26324d"; rr(-128, -540, 256, 540, 38); ctx.fill();
  ctx.fillStyle = '#0a0a0e'; rr(-38, 22, 76, 14, 7); ctx.fill(); // port (narrow)
  let py = lerp(560, 50, easeOut(lt / tTouch)), sh = 0;
  if (lt > tTouch) { const b = lt - tTouch; if (fit) py = lerp(50, 30, clamp(b / .15)); else { py = 50 + Math.abs(Math.sin(b * 9)) * 70 * Math.exp(-b * 3); sh = Math.sin(b * 60) * 10 * Math.exp(-b * 4); } }
  ctx.save(); ctx.translate(sh, py);
  ctx.strokeStyle = '#f4f1ec'; ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 150); ctx.bezierCurveTo(0, 360, 140, 420, 120, 800); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = '#f4f1ec'; ctx.strokeStyle = '#bdb6aa'; ctx.lineWidth = 5; rr(-58, 20, 116, 140, 22); ctx.fill(); ctx.stroke(); // housing
  ctx.fillStyle = '#c9ccd4'; if (fit) rr(-30, -4, 60, 26, 6); else rr(-62, -14, 124, 36, 6); ctx.fill(); // connector: wide = wrong
  ctx.restore();
  if (lt > tTouch + .25) { const k = spring(lt - tTouch - .25); ctx.save(); ctx.translate(fit ? 0 : 230, fit ? -120 : 10); ctx.scale(.55 * k, .55 * k);
    ctx.strokeStyle = fit ? '#2fd36b' : '#ff3b3b'; ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.beginPath();
    if (fit) { ctx.moveTo(-130, 0); ctx.lineTo(-30, 100); ctx.lineTo(150, -110); } else { ctx.moveTo(-110, -110); ctx.lineTo(110, 110); ctx.moveTo(110, -110); ctx.lineTo(-110, 110); }
    ctx.stroke(); ctx.lineCap = 'butt'; ctx.restore(); }
};
V.wifi = (e, lt, t) => { // Wi-Fi signal: bars b0 -> b1 (0..3) over dur, colour by level, blinks + red cross at 0; card: false = no backing pill
  const d = e.dur || 1.2, k = clamp(lt / d), b = Math.round(lerp(e.b0 ?? 3, e.b1 ?? (e.b0 ?? 3), easeIO(k)));
  const col = ['#ff3b3b', '#ff8a1f', '#ffc21a', '#2fd36b'][b], blink = b === 0 && (t * 3) % 1 < .5;
  if (e.card !== false) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12; rr(-170, -170, 340, 300, 70); ctx.fill(); noGlow(); ctx.shadowOffsetY = 0; }
  ctx.lineCap = 'round'; ctx.lineWidth = 30;
  for (let i = 1; i <= 3; i++) { // arcs centred at (0,70)
    ctx.strokeStyle = i <= b ? col : 'rgba(40,40,50,0.16)'; if (i <= b && b === 3) glow(alphaCol(col, .7), 26);
    ctx.beginPath(); ctx.arc(0, 75, 50 + i * 42, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke(); noGlow();
  }
  ctx.fillStyle = b > 0 ? col : (blink ? '#ff3b3b' : 'rgba(40,40,50,0.3)'); ctx.beginPath(); ctx.arc(0, 75, 20, 0, 7); ctx.fill();
  if (b === 0) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 22; ctx.globalAlpha *= blink ? 1 : .55; ctx.beginPath(); ctx.moveTo(60, -10); ctx.lineTo(130, 60); ctx.moveTo(130, -10); ctx.lineTo(60, 60); ctx.stroke(); }
  ctx.lineCap = 'butt';
};
V.loader = (e, lt, t) => { // buffering spinner; stuck: true = it freezes and jerks (bad internet), done_at: sec -> green check
  if (e.done_at !== undefined && lt > e.done_at) { const q = spring(lt - e.done_at, 12, 7); ctx.scale(.4 + .6 * q, .4 + .6 * q); ctx.fillStyle = '#2fd36b'; ctx.beginPath(); ctx.arc(0, 0, 120, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-55, 0); ctx.lineTo(-12, 45); ctx.lineTo(60, -40); ctx.stroke(); ctx.lineCap = 'butt'; return; }
  const sp = e.stuck ? (Math.floor(t * 2) % 3 === 0 ? 0 : 2.5) : 6, a0 = e.stuck ? Math.floor(t * 1.5) * 1.1 : t * sp;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(0, 0, 150, 0, 7); ctx.fill();
  for (let i = 0; i < 10; i++) { const a = a0 + i * Math.PI / 5; ctx.fillStyle = `rgba(255,255,255,${.15 + .85 * i / 9})`; ctx.beginPath(); ctx.arc(Math.cos(a) * 90, Math.sin(a) * 90, 6 + i * 1.6, 0, 7); ctx.fill(); }
};
V.oldphone = (e, lt, t) => { // 2000s push-button phone: full battery bars + snake game running on the LCD
  ctx.fillStyle = '#2b3448'; rr(-150, -360, 300, 720, 70); ctx.fill(); ctx.fillStyle = '#3a465f'; rr(-132, -342, 264, 684, 58); ctx.fill();
  ctx.fillStyle = '#2b3448'; rr(70, -440, 34, 110, 14); ctx.fill(); // antenna
  ctx.fillStyle = '#9fc46a'; rr(-104, -290, 208, 190, 14); ctx.fill(); ctx.fillStyle = '#2d3a1c';
  for (let b = 0; b < 4; b++) ctx.fillRect(-92 + b * 0, -276 + b * 14, 10 + b * 6, 9); // signal bars (left)
  for (let b = 0; b < 4; b++) ctx.fillRect(88 - 16, -276 + b * 14, 16, 9); // battery bars (right, full)
  const cell = 11, cols = 14, rows = 9, ox = -77, oy = -232, step = Math.floor(t * 8);
  const path = []; for (let x = 0; x < cols; x++) path.push([x, 1]); for (let y = 2; y < rows; y++) path.push([cols - 1, y]); for (let x = cols - 2; x >= 0; x--) path.push([x, rows - 1]); for (let y = rows - 2; y > 1; y--) path.push([0, y]);
  for (let i = 0; i < 7; i++) { const [x, y] = path[((step - i) % path.length + path.length) % path.length]; ctx.fillRect(ox + x * cell, oy + y * cell, cell - 2, cell - 2); }
  const [fx, fy] = path[(Math.floor(step / path.length) * 17 + 9) % path.length]; ctx.fillRect(ox + fx * cell + 2, oy + (fy === 1 ? 4 : fy) * cell + 2, cell - 5, cell - 5);
  ctx.fillStyle = '#566482'; rr(-70, -70, 140, 46, 20); ctx.fill();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { ctx.fillStyle = '#c9d2e4'; rr(-100 + c * 72, 0 + r * 72, 56, 50, 16); ctx.fill(); }
  if (e.shine !== false) { const g = ctx.createLinearGradient(-150, -360, 150, 360); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(.4, 'rgba(255,255,255,0)'); ctx.fillStyle = g; rr(-150, -360, 300, 720, 70); ctx.fill(); }
};
V.jeans = (e, lt, t) => { // front of blue jeans: 5 pockets, copper rivets. hl: watch|rivets (from hlAt / hlAt_on), watch: true = pocket watch rises (watchAt), tear: true = ripped pocket
  const hlOn = e.hl && lt >= (e.hlAt || 0), hk = hlOn ? clamp((lt - (e.hlAt || 0)) / .4) : 0;
  const body = () => { ctx.beginPath(); ctx.moveTo(-360, -430); ctx.lineTo(360, -430); ctx.lineTo(380, -360); ctx.quadraticCurveTo(415, 0, 400, 200); ctx.lineTo(390, 470); ctx.lineTo(30, 470); ctx.lineTo(10, 190); ctx.lineTo(0, 165); ctx.lineTo(-10, 190); ctx.lineTo(-30, 470); ctx.lineTo(-390, 470); ctx.lineTo(-400, 200); ctx.quadraticCurveTo(-415, 0, -380, -360); ctx.closePath(); };
  ctx.save(); ctx.shadowColor = 'rgba(30,40,80,0.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  const g = ctx.createLinearGradient(0, -430, 0, 470); g.addColorStop(0, '#3a6bb8'); g.addColorStop(1, '#22457f'); ctx.fillStyle = g; body(); ctx.fill(); noGlow(); ctx.shadowOffsetY = 0;
  body(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3; ctx.beginPath(); for (let k = -900; k < 900; k += 14) { ctx.moveTo(k, -450); ctx.lineTo(k + 920, 470); } ctx.stroke();
  for (const sx of [-1, 1]) { ctx.save(); ctx.translate(sx * 215, 330); ctx.scale(.55, 1); const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, 230); lg.addColorStop(0, 'rgba(200,222,255,0.22)'); lg.addColorStop(1, 'rgba(200,222,255,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, 0, 230, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(-400, -430, 800, 70); ctx.restore();
  const stitch = (fn) => { ctx.save(); ctx.setLineDash([16, 11]); ctx.strokeStyle = '#e9a93f'; ctx.lineWidth = 5; ctx.beginPath(); fn(); ctx.stroke(); ctx.restore(); };
  stitch(() => { ctx.moveTo(-372, -358); ctx.lineTo(372, -358); ctx.moveTo(-362, -418); ctx.lineTo(362, -418); ctx.moveTo(48, -355); ctx.lineTo(48, 70); ctx.quadraticCurveTo(48, 140, 4, 158); });
  for (const sx of [-1, 1]) { // front pocket openings
    ctx.fillStyle = 'rgba(10,20,50,0.28)'; ctx.beginPath(); ctx.moveTo(sx * 200, -360); ctx.quadraticCurveTo(sx * 205, -150, sx * 398, -128); ctx.lineTo(sx * 392, -150); ctx.quadraticCurveTo(sx * 225, -170, sx * 218, -360); ctx.closePath(); ctx.fill();
    stitch(() => { ctx.moveTo(sx * 190, -358); ctx.quadraticCurveTo(sx * 190, -135, sx * 396, -112); });
  }
  for (const x of [-300, -110, 110, 300]) { ctx.fillStyle = '#2d589d'; rr(x - 20, -446, 40, 96, 8); ctx.fill(); stitch(() => { ctx.moveTo(x - 10, -436); ctx.lineTo(x - 10, -360); ctx.moveTo(x + 10, -436); ctx.lineTo(x + 10, -360); }); }
  ctx.fillStyle = '#b87333'; ctx.beginPath(); ctx.arc(0, -390, 24, 0, 7); ctx.fill(); ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = 5; ctx.stroke(); ctx.fillStyle = '#e3a56a'; ctx.beginPath(); ctx.arc(-6, -396, 8, 0, 7); ctx.fill();
  if (e.watch) { // gold pocket watch rising out of the small pocket (patch is drawn over its lower half)
    const r = easeOut((lt - (e.watchAt || 0)) / .7), wy = lerp(-290, -385, r), wx = -285;
    if (r > 0) { ctx.strokeStyle = '#d9b44a'; ctx.lineWidth = 7; ctx.setLineDash([9, 5]); ctx.beginPath(); ctx.moveTo(wx, wy - 40); ctx.quadraticCurveTo(wx - 20, -470, -300, -440); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e8c04f'; glow('rgba(255,210,80,0.8)', 30 * r); ctx.beginPath(); ctx.arc(wx, wy, 52, 0, 7); ctx.fill(); noGlow(); ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(wx, wy, 38, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2a2433'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.cos(t * 2) * 26, wy + Math.sin(t * 2) * 26); ctx.moveTo(wx, wy); ctx.lineTo(wx, wy - 18); ctx.stroke(); ctx.lineCap = 'butt'; }
  }
  // watch pocket patch (viewer's left = wearer's right)
  ctx.fillStyle = '#4174c2'; rr(-345, -350, 115, 100, 6); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-345, -350, 115, 6);
  stitch(() => { ctx.rect(-337, -342, 99, 84); });
  const rivets = [[-336, -342], [-239, -342], [-198, -352], [-392, -118], [198, -352], [392, -118]];
  rivets.forEach(([x, y], i) => {
    const pop = e.hl === 'rivets' && hlOn ? spring(lt - (e.hlAt || 0) - i * .12) : 0, rs = 13 + pop * 7;
    if (pop > 0) { glow('rgba(255,170,80,0.95)', 34); }
    ctx.fillStyle = '#c47a3a'; ctx.beginPath(); ctx.arc(x, y, rs, 0, 7); ctx.fill(); noGlow(); ctx.fillStyle = '#f2b77a'; ctx.beginPath(); ctx.arc(x - 3, y - 4, rs * .38, 0, 7); ctx.fill();
    if (pop > .2) { ctx.strokeStyle = alphaCol('#ffb35a', .7 * (1 - clamp((lt - (e.hlAt || 0) - i * .12) / 1.2))); ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, rs + 30 * clamp((lt - (e.hlAt || 0) - i * .12) / 1.2) + 8, 0, 7); ctx.stroke(); }
  });
  if (e.tear) { // ripped corner of the other front pocket, frayed threads
    const k = clamp(lt / .5); ctx.save(); ctx.translate(300, -150); ctx.scale(k, k); ctx.fillStyle = '#16233f'; ctx.beginPath();
    const r = rng(77); for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, rad = 70 + r() * 38; i ? ctx.lineTo(Math.cos(a) * rad * 1.3, Math.sin(a) * rad) : ctx.moveTo(Math.cos(a) * rad * 1.3, Math.sin(a) * rad); } ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f3efe6'; ctx.lineWidth = 4; ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, x = Math.cos(a) * 100, y = Math.sin(a) * 78; ctx.moveTo(x, y); ctx.lineTo(x * 1.22 + (r() - .5) * 20, y * 1.22 + (r() - .5) * 20); } ctx.stroke(); ctx.restore();
  }
  if (e.hl === 'watch' && hlOn) { // pulsing ring around the small pocket
    const pu = .5 + .5 * Math.sin((lt - (e.hlAt || 0)) * 6); ctx.strokeStyle = alphaCol(T.acc, .55 + .45 * pu); ctx.lineWidth = 12; glow(alphaCol(T.acc, .8), 30);
    rr(-345 - 26 - 10 * pu, -350 - 26 - 10 * pu, 167 + 20 * pu, 152 + 20 * pu, 30); ctx.globalAlpha *= hk; ctx.stroke(); ctx.globalAlpha /= hk || 1; noGlow();
  }
};
V.pocketwatch = (e, lt, t) => { // big golden pocket watch, open, ticking second hand, chain
  ctx.translate(0, Math.sin(t * 1.6) * 8); ctx.rotate(Math.sin(t * 1.3) * .05);
  ctx.strokeStyle = '#d9b44a'; ctx.lineWidth = 12; ctx.setLineDash([18, 8]); ctx.beginPath(); ctx.moveTo(0, -270); ctx.quadraticCurveTo(160, -420, 320, -330); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#c9982e'; ctx.beginPath(); ctx.arc(0, -262, 34, 0, 7); ctx.fill(); ctx.fillStyle = '#c9982e'; rr(-26, -250, 52, 40, 10); ctx.fill();
  const g = ctx.createRadialGradient(-60, -60, 20, 0, 0, 240); g.addColorStop(0, '#fff1a8'); g.addColorStop(.5, '#e8c04f'); g.addColorStop(1, '#a87a1c');
  glow('rgba(255,200,60,0.6)', 60); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 230, 0, 7); ctx.fill(); noGlow();
  ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(0, 0, 185, 0, 7); ctx.fill(); ctx.strokeStyle = '#8a6418'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = '#2a2433'; for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, big = i % 5 === 0; ctx.lineWidth = big ? 8 : 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (big ? 140 : 158), Math.sin(a) * (big ? 140 : 158)); ctx.lineTo(Math.cos(a) * 170, Math.sin(a) * 170); ctx.stroke(); }
  const sp = e.speed || 1, sec = Math.floor(t * 2) / 2 * sp; ctx.lineCap = 'round';
  const hand = (a, len, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len); ctx.stroke(); };
  hand(1.9 + t * .02 * sp, 90, 16, '#2a2433'); hand(.6 + t * .2 * sp, 135, 10, '#2a2433'); hand(sec / 60 * Math.PI * 2 * 6, 150, 4, '#e0452b'); ctx.lineCap = 'butt';
  ctx.fillStyle = '#2a2433'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-70, -80, 70, 34, -.7, 0, 7); ctx.fill();
};
V.progress = (e, lt) => {
  const w = e.w || 760, p = lerp(e.from || 0, e.to ?? 1, easeOut(lt / (e.dur || 1.5)));
  ctx.fillStyle = alphaCol(T.fg, .12); rr(-w / 2, -22, w, 44, 22); ctx.fill(); ctx.fillStyle = e.color || T.acc; rr(-w / 2, -22, Math.max(44, w * p), 44, 22); ctx.fill();
  font('Mono', 36, 800); ctx.fillStyle = T.fg; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(p * 100)}%`, 0, -50); if (e.label) { font('IDS', 34); ctx.fillText(e.label, 0, 80); }
};

// ---------------------------------------------------------------- sets (scene backdrops with depth)
function drawSet(s, t) {
  const k = s.set; if (!k) return; const light = D.theme === 'light' || D.theme === 'doodle';
  if (k === 'space') {
    const r = rng(hash('stars' + (s.t0 | 0)));
    for (let i = 0; i < 140; i++) { const x = r() * W, y = r() * H * .8, a = .3 + .7 * Math.abs(Math.sin(t * (.5 + r() * 2) + i)); ctx.fillStyle = `rgba(255,255,255,${a * .8})`; ctx.beginPath(); ctx.arc(x, y, r() * 2.4 + .4, 0, 7); ctx.fill(); }
  }
  if (k === 'shelf' || k === 'table') { // surface objects stand on, at y = s.setY (default .56)
    const y = (s.setY || .56) * H, g = ctx.createLinearGradient(0, y, 0, y + 60);
    g.addColorStop(0, light ? '#e8dccb' : '#3a2a1e'); g.addColorStop(1, light ? '#cdbda6' : '#1c130c');
    ctx.fillStyle = g; ctx.fillRect(-20, y, W + 40, k === 'shelf' ? 46 : H - y);
    ctx.fillStyle = light ? 'rgba(255,255,255,0.6)' : 'rgba(255,200,140,0.18)'; ctx.fillRect(-20, y, W + 40, 4);
    if (k === 'shelf') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-20, y + 46, W + 40, 30); }
  }
  if (k === 'room') { // wall + floor with window light
    const y = (s.setY || .6) * H; ctx.fillStyle = light ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'; ctx.fillRect(0, y, W, H - y);
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    const lg = ctx.createLinearGradient(0, 0, W, H); lg.addColorStop(0, alphaCol(s.tint || T.acc2, .18)); lg.addColorStop(.6, 'rgba(0,0,0,0)'); ctx.fillStyle = lg;
    ctx.beginPath(); ctx.moveTo(120, 0); ctx.lineTo(420, 0); ctx.lineTo(820, y); ctx.lineTo(320, y); ctx.closePath(); ctx.fill();
  }
  if (k === 'rays') { // light shafts from above
    for (let i = 0; i < 5; i++) { const x = W * (.15 + i * .18) + Math.sin(t * .3 + i) * 30; const g = ctx.createLinearGradient(x, 0, x + 160, H * .7); g.addColorStop(0, alphaCol(s.tint || '#ffffff', .10)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 70, 0); ctx.lineTo(x + 260, H * .7); ctx.lineTo(x + 120, H * .7); ctx.closePath(); ctx.fill(); }
  }
}
function contactShadow(e, sc) { // soft ellipse under grounded objects
  const gy = e.groundY ?? 0; ctx.save(); ctx.translate(0, gy); ctx.scale(1, .22);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 220); g.addColorStop(0, `rgba(0,0,0,${D.theme === 'light' ? .18 : .45})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 220, 0, 7); ctx.fill(); ctx.restore();
}

// ---------------------------------------------------------------- scene
function drawScene(t, i) {
  const s = SC[i], next = SC[i + 1];
  const outK = next ? clamp((t - (next.t0 - .14)) / .26) : 0; if (outK >= 1) return;
  const sd = s.t1 - s.t0, p = clamp((t - s.t0) / Math.max(1, sd));
  ctx.save();
  // camera: slow push, exit = zoom-through or whip
  const cz = 1 + (s.cam === 'out' ? .06 * (1 - p) : .045 * p) + .25 * easeIO(outK) * (s.exit === 'whip' ? 0 : 1);
  const wx = s.exit === 'whip' ? -W * 1.1 * easeIO(outK) : 0;
  const sway = D.sway === false ? 0 : 1;
  ctx.translate(W / 2 + wx + sway * noise1(t * .25, 'cx') * 10, 900 + sway * noise1(t * .2, 'cy') * 8); ctx.rotate(sway * noise1(t * .15, 'cr') * .004); ctx.scale(cz, cz); ctx.translate(-W / 2, -900);
  ctx.globalAlpha = 1 - (s.exit === 'whip' ? 0 : easeOut(outK));
  drawSet(s, t);
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
    if (e.ground) contactShadow(e);
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
  if (!CH.length || D.captions === false || D.captions === 'none' || D.captions === 'off') return;
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
