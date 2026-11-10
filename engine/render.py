#!/usr/bin/env python3
"""Shorts renderer: plan JSON -> 1080x1920 mp4 with voice, captions, photos, music.

Usage: python3 engine/render.py plans/<id>.json out/<id>.mp4
"""
import json, math, os, random, re, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, FPS, SR = 1080, 1920, 30, 22050
FONT_DIR = "/usr/share/fonts/opentype/inter"
F_BLACK = os.path.join(FONT_DIR, "InterDisplay-Black.otf")
F_BOLD = os.path.join(FONT_DIR, "InterDisplay-ExtraBold.otf")

# Shorts safe area: keep clear of top bar, right action rail and bottom title/caption block
SAFE_L, SAFE_R, SAFE_T, SAFE_B = 70, 880, 260, 1420
CAP_Y = 1180

PALETTES = {
    "night":  {"bg0": (8, 10, 30), "bg1": (40, 16, 70), "acc": (255, 210, 63), "acc2": (90, 220, 255)},
    "toxic":  {"bg0": (10, 6, 20), "bg1": (30, 12, 40), "acc": (124, 255, 79), "acc2": (255, 61, 165)},
    "ocean":  {"bg0": (2, 16, 36), "bg1": (0, 70, 110), "acc": (80, 230, 255), "acc2": (255, 200, 80)},
    "fire":   {"bg0": (24, 6, 4), "bg1": (90, 20, 10), "acc": (255, 170, 40), "acc2": (255, 255, 255)},
    "mystic": {"bg0": (12, 4, 24), "bg1": (60, 20, 90), "acc": (200, 140, 255), "acc2": (255, 230, 120)},
    "clean":  {"bg0": (14, 18, 26), "bg1": (40, 52, 70), "acc": (255, 90, 80), "acc2": (120, 220, 160)},
}

_fc = {}
def font(path, size):
    k = (path, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]

def ease_out(x):
    x = max(0.0, min(1.0, x)); return 1 - (1 - x) ** 3

def pop(t, t0, d=0.35):
    x = (t - t0) / d
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2  # back-out

# ---------------------------------------------------------------- audio
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")

def stress_lint(text):
    """Return words with 2+ vowels and no stress mark (and no ё)."""
    bad = []
    for w in re.findall(r"[А-Яа-яЁё\u0301]+", text):
        if "\u0301" in w or "ё" in w.lower(): continue
        if sum(c in VOWELS for c in w) >= 2: bad.append(w)
    return bad

def tts(text, voice, out_wav, rate):
    model = os.path.join(ROOT, "assets/voices", f"ru_RU-{voice}-medium.onnx")
    p = subprocess.run([sys.executable, "-m", "piper", "-m", model, "-f", out_wav,
                        "--length-scale", str(rate), "--sentence-silence", "0.12"],
                       input=text.encode(), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[-500:])

def read_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    if sr != SR:
        idx = np.linspace(0, len(a) - 1, int(len(a) * SR / sr)); a = np.interp(idx, np.arange(len(a)), a)
    return a

def music(dur, seed, mood):
    rng = np.random.default_rng(seed)
    t = np.arange(int(dur * SR)) / SR
    roots = {"tense": [110, 116.5], "epic": [98, 130.8], "calm": [130.8, 164.8], "mystery": [103.8, 123.5]}
    base = roots.get(mood, roots["tense"])
    out = np.zeros_like(t)
    chord_len = 4.0
    for i in range(int(dur / chord_len) + 1):
        f = base[i % len(base)]
        s, e = int(i * chord_len * SR), int(min(dur, (i + 1) * chord_len + 1) * SR)
        if s >= len(t): break
        seg = t[s:e] - t[s]
        env = np.minimum(1, seg / 1.2) * np.minimum(1, (seg[-1] - seg + 1e-3) / 1.0)
        tone = sum(np.sin(2 * np.pi * f * m * seg + rng.random() * 6) / (k + 1) for k, m in enumerate([1, 1.5, 2, 3]))
        out[s:e] += 0.08 * env * tone
    beat = 60 / 92
    for bt in np.arange(0, dur, beat):
        s = int(bt * SR); n = int(0.25 * SR); seg = np.arange(min(n, len(t) - s)) / SR
        out[s:s + len(seg)] += 0.22 * np.sin(2 * np.pi * (55 + 60 * np.exp(-seg * 30)) * seg) * np.exp(-seg * 12)
    return out

def whoosh(n):
    noise = np.random.default_rng(1).standard_normal(n)
    env = np.sin(np.linspace(0, np.pi, n)) ** 2
    k = np.ones(40) / 40
    return 0.25 * np.convolve(noise, k, "same") * env

# ---------------------------------------------------------------- visuals
def load_photo(path):
    im = Image.open(path).convert("RGB")
    s = max(W * 1.18 / im.width, H * 1.18 / im.height)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)

def photo_frame(im, p, seed):
    rng = random.Random(seed)
    z0, z1 = (1.0, 1.12) if rng.random() < 0.6 else (1.12, 1.0)
    z = z0 + (z1 - z0) * p
    cw, ch = W / z * (im.width / (W * 1.18)), H / z * (im.height / (H * 1.18))
    dx, dy = rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)
    cx = im.width / 2 + dx * (im.width - cw) * (p - 0.5)
    cy = im.height / 2 + dy * (im.height - ch) * (p - 0.5)
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return im.transform((W, H), Image.EXTENT, box, Image.BILINEAR)

def gradient_bg(pal, t):
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    wave_ = 0.5 + 0.5 * np.sin(x * 3 + y * 2 + t * 0.6)
    mix = np.clip(y * 0.8 + wave_ * 0.25, 0, 1)[..., None]
    c0, c1 = np.array(pal["bg0"]), np.array(pal["bg1"])
    return Image.fromarray((c0 * (1 - mix) + c1 * mix).astype(np.uint8))

_shade = None
def shade():
    global _shade
    if _shade is None:
        y = np.linspace(0, 1, H)[:, None]
        a = 0.35 + 0.45 * (np.abs(y - 0.45) * 2) ** 1.6
        a = np.clip(a, 0, 0.85)
        _shade = Image.fromarray((np.broadcast_to(a, (H, W)) * 255).astype(np.uint8), "L")
    return _shade

def particles(d, t, pal, seed):
    rng = random.Random(seed)
    for i in range(40):
        x = (rng.random() * W + t * rng.uniform(-15, 15)) % W
        y = (rng.random() * H - t * rng.uniform(10, 60)) % H
        r = rng.uniform(1.5, 4)
        a = int(80 + 120 * (0.5 + 0.5 * math.sin(t * 2 + i)))
        d.ellipse((x - r, y - r, x + r, y + r), fill=pal["acc2"] + (a,))

def text_size(d, s, f):
    b = d.textbbox((0, 0), s, font=f); return b[2] - b[0], b[3] - b[1]

def wrap(d, s, f, maxw):
    words, lines, cur = s.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if text_size(d, t, f)[0] <= maxw: cur = t
        else:
            if cur: lines.append(cur)
            cur = w_
    if cur: lines.append(cur)
    return lines

def big_text(base, s, t, t0, pal):
    k = pop(t, t0)
    if k <= 0 or not s: return
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    size = 96 if len(s) <= 8 else 80 if len(s) <= 14 else 66
    f = font(F_BLACK, size)
    lines = wrap(d, s.upper(), f, SAFE_R - SAFE_L)
    lh = int(size * 1.05); y = 620 - len(lines) * lh // 2
    for ln in lines:
        tw, _ = text_size(d, ln, f); x = (SAFE_L + SAFE_R) // 2 - tw // 2
        d.text((x, y), ln, font=f, fill=pal["acc"], stroke_width=9, stroke_fill=(10, 10, 16))
        y += lh
    if k != 1:
        sc = max(0.01, k)
        lw, lhh = int(W * sc), int(H * sc)
        layer = layer.resize((lw, lhh), Image.BILINEAR)
        cx, cy = (SAFE_L + SAFE_R) // 2, 620
        big = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        big.paste(layer, (int(cx - cx * sc), int(cy - cy * sc)))
        layer = big
    base.alpha_composite(layer)

def chip(d, s, t, t0, pal, y=300):
    k = ease_out((t - t0) / 0.3)
    if k <= 0 or not s: return
    f = font(F_BOLD, 40)
    tw, th = text_size(d, s, f)
    x = (SAFE_L + SAFE_R) // 2 - tw // 2
    yy = y - (1 - k) * 40
    d.rounded_rectangle((x - 30, yy - 18, x + tw + 30, yy + th + 30), 26, fill=(10, 10, 16, int(220 * k)), outline=pal["acc"] + (int(255 * k),), width=4)
    d.text((x, yy), s, font=f, fill=(255, 255, 255, int(255 * k)))

def captions(d, words, t, pal):
    cur = None
    for i, (w_, a, b) in enumerate(words):
        if a <= t < b + 0.15: cur = i
    if cur is None: return
    g0 = cur - cur % 3; group = words[g0:g0 + 3]
    f = font(F_BLACK, 60)
    s = " ".join(w for w, _, _ in group)
    lines = wrap(d, s, f, SAFE_R - SAFE_L)
    y = CAP_Y
    for ln in lines:
        tw, _ = text_size(d, ln, f); x = (SAFE_L + SAFE_R) // 2 - tw // 2
        for tok in ln.split(" "):
            idx = next((j for j, (w, _, _) in enumerate(group) if w == tok), None)
            col = pal["acc"] if idx is not None and g0 + idx == cur else (255, 255, 255)
            d.text((x, y), tok, font=f, fill=col, stroke_width=8, stroke_fill=(0, 0, 0))
            x += text_size(d, tok + " ", f)[0]
        y += 74

def progress(d, t, dur, pal):
    d.rounded_rectangle((SAFE_L, 230, SAFE_R, 238), 4, fill=(255, 255, 255, 60))
    d.rounded_rectangle((SAFE_L, 230, SAFE_L + (SAFE_R - SAFE_L) * min(1, t / dur), 238), 4, fill=pal["acc"] + (255,))

# ---------------------------------------------------------------- main
def main(plan_path, out_path):
    plan = json.load(open(plan_path))
    pal = PALETTES.get(plan.get("palette", "night"), PALETTES["night"])
    voice = plan.get("voice", "dmitri"); rate = plan.get("rate", 0.88)
    work = os.path.splitext(out_path)[0] + "_work"; os.makedirs(work, exist_ok=True)
    scenes = plan["scenes"]
    missing = [w for sc in scenes for w in stress_lint(sc["say"])]
    if missing:
        print("STRESS MISSING:", ", ".join(sorted(set(missing))), file=sys.stderr)
        if not os.environ.get("ALLOW_NO_STRESS"): sys.exit(2)
    if re.search(r"\d", " ".join(sc["say"] for sc in scenes)):
        print("DIGITS IN VOICE TEXT: write numbers as words", file=sys.stderr); sys.exit(2)

    # 1) voice per scene, timings
    voice_parts, t = [], 0.4
    for i, sc in enumerate(scenes):
        wp = os.path.join(work, f"v{i}.wav"); tts(sc["say"], voice, wp, rate)
        a = read_wav(wp); dur = len(a) / SR
        sc["_t0"], sc["_t1"] = t, t + dur
        toks = sc["say"].replace("\u0301", "").split(); weights = [len(re.sub(r"\W", "", x)) + 2 for x in toks]
        tot = sum(weights); acc = t; sc["_words"] = []
        for tok, wgt in zip(toks, weights):
            d_ = dur * 0.94 * wgt / tot; sc["_words"].append((tok, acc, acc + d_)); acc += d_
        voice_parts.append((t, a)); t += dur + 0.18
    total = t + 0.8

    # 2) audio mix
    n = int(total * SR); vo = np.zeros(n)
    for t0, a in voice_parts: s = int(t0 * SR); vo[s:s + len(a)] += a[:n - s]
    mus = music(total, hash(plan["id"]) % 1000, plan.get("music", "tense"))[:n]
    env = np.convolve((np.abs(vo) > 0.02).astype(float), np.ones(int(0.3 * SR)) / (0.3 * SR), "same")
    mix = vo * 1.0 + mus * (0.55 - 0.35 * np.clip(env * 3, 0, 1))
    for sc in scenes[1:]:
        s = int((sc["_t0"] - 0.25) * SR); wl = int(0.45 * SR)
        if 0 <= s < n - wl: mix[s:s + wl] += whoosh(wl)
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.92
    apath = os.path.join(work, "mix.wav")
    with wave.open(apath, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())

    # 3) frames
    photos = {i: load_photo(os.path.join(ROOT, sc["photo"])) for i, sc in enumerate(scenes) if sc.get("photo")}
    all_words = [w for sc in scenes for w in sc["_words"]]
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-i", apath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out_path], stdin=subprocess.PIPE)
    nf = int(total * FPS)
    for fi in range(nf):
        tt = fi / FPS
        si = max(0, max(i for i, sc in enumerate(scenes) if sc["_t0"] - 0.2 <= tt or i == 0))
        sc = scenes[si]
        p = (tt - sc["_t0"] + 0.2) / max(0.5, sc["_t1"] - sc["_t0"] + 0.4)
        if si in photos:
            bg = photo_frame(photos[si], max(0, min(1, p)), si + 7).convert("RGBA")
            dark = Image.new("RGBA", (W, H), (0, 0, 0, 255)); dark.putalpha(shade()); bg.alpha_composite(dark)
        else:
            bg = gradient_bg(pal, tt).convert("RGBA")
        d = ImageDraw.Draw(bg, "RGBA")
        if si not in photos: particles(d, tt, pal, si)
        flash = 1 - (tt - sc["_t0"] + 0.2) / 0.18
        if si > 0 and 0 < flash <= 1: d.rectangle((0, 0, W, H), fill=(255, 255, 255, int(110 * flash)))
        chip(d, sc.get("chip", ""), tt, sc["_t0"] - 0.1, pal)
        big_text(bg, sc.get("big", ""), tt, sc["_t0"] + 0.05, pal)
        d = ImageDraw.Draw(bg, "RGBA")
        captions(d, all_words, tt, pal)
        ff.stdin.write(bg.convert("RGB").tobytes())
    ff.stdin.close(); ff.wait()
    print(json.dumps({"out": out_path, "duration": round(total, 1)}))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
