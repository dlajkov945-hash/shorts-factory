#!/usr/bin/env python3
"""Shorts/long video renderer v2: plan JSON -> mp4.

Usage: python3 engine/render.py plans/<id>.json out/<id>.mp4

Plan fields (all optional except scenes):
  aspect: "9:16" (Shorts, default) | "16:9" (long video)
  style: flat | doodle | neon | cutout | pixel   (2D art style for env/character scenes)
  palette: night | toxic | ocean | fire | mystic | clean | sunny | candy
  music: tense | epic | mystery | funny | chill | happy | sad | action
  voice: dmitri | ruslan | denis | none   ("none" = music-only visual video, use scene.dur + scene.text)
  rate: piper length scale (default 0.88)
  characters: {"boy": {...overrides of chars.DEFAULT_CHARS...}}
Scene fields:
  say (voice text with stress marks), dur (seconds, for voiceless), text (on-screen line for voiceless)
  big, chip, photo, env (city|underwater|space|room|forest|desert|lab|island|paper),
  chars: [{"id":"boy","x":0.5,"pose":"talk","speak":true,"scale":1.0,"look":0,"facing":1}]
  sfx: ["boom","ding",...] played at scene start
  audio: path to a pre-made voice wav/mp3 for this scene (e.g. ElevenLabs), overrides TTS
"""
import json, math, os, random, re, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio as AU
import chars as CH

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
SR = AU.SR
FONT_DIR = "/usr/share/fonts/opentype/inter"
F_BLACK = os.path.join(FONT_DIR, "InterDisplay-Black.otf")
F_BOLD = os.path.join(FONT_DIR, "InterDisplay-ExtraBold.otf")

PALETTES = {
    "night":  {"bg0": (8, 10, 30), "bg1": (40, 16, 70), "acc": (255, 210, 63), "acc2": (90, 220, 255)},
    "toxic":  {"bg0": (10, 6, 20), "bg1": (30, 12, 40), "acc": (124, 255, 79), "acc2": (255, 61, 165)},
    "ocean":  {"bg0": (2, 40, 80), "bg1": (0, 110, 150), "acc": (80, 230, 255), "acc2": (255, 200, 80)},
    "fire":   {"bg0": (24, 6, 4), "bg1": (90, 20, 10), "acc": (255, 170, 40), "acc2": (255, 255, 255)},
    "mystic": {"bg0": (12, 4, 24), "bg1": (60, 20, 90), "acc": (200, 140, 255), "acc2": (255, 230, 120)},
    "clean":  {"bg0": (14, 18, 26), "bg1": (40, 52, 70), "acc": (255, 90, 80), "acc2": (120, 220, 160)},
    "sunny":  {"bg0": (120, 200, 255), "bg1": (255, 230, 170), "acc": (255, 90, 60), "acc2": (255, 255, 255)},
    "candy":  {"bg0": (255, 170, 210), "bg1": (170, 140, 255), "acc": (255, 255, 90), "acc2": (90, 240, 220)},
}

_fc = {}
def font(path, size):
    k = (path, size)
    if k not in _fc: _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]

def ease_out(x):
    x = max(0.0, min(1.0, x)); return 1 - (1 - x) ** 3

def pop(t, t0, d=0.35):
    x = (t - t0) / d
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2

# ---------------------------------------------------------------- voice
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")
def stress_lint(text):
    bad = []
    for w in re.findall(r"[А-Яа-яЁё́]+", text):
        if "́" in w or "ё" in w.lower(): continue
        if sum(c in VOWELS for c in w) >= 2: bad.append(w)
    return bad

def tts(text, voice, out_wav, rate):
    model = os.path.join(ROOT, "assets/voices", f"ru_RU-{voice}-medium.onnx")
    p = subprocess.run([sys.executable, "-m", "piper", "-m", model, "-f", out_wav, "--length-scale", str(rate), "--sentence-silence", "0.12"],
                       input=text.encode(), capture_output=True)
    if p.returncode != 0: raise RuntimeError(p.stderr.decode()[-500:])

def load_audio(path):
    tmp = path + ".conv.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-ac", "1", "-ar", str(SR), tmp], check=True)
    with wave.open(tmp) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768

# ---------------------------------------------------------------- drawing helpers
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

def load_photo(path, W, H):
    im = Image.open(path).convert("RGB")
    s = max(W * 1.18 / im.width, H * 1.18 / im.height)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)

def photo_frame(im, p, seed, W, H):
    rng = random.Random(seed)
    z0, z1 = (1.0, 1.12) if rng.random() < 0.6 else (1.12, 1.0)
    z = z0 + (z1 - z0) * p
    cw, ch = im.width / 1.18 / z, im.height / 1.18 / z
    dx, dy = rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)
    cx = im.width / 2 + dx * (im.width - cw) * (p - 0.5); cy = im.height / 2 + dy * (im.height - ch) * (p - 0.5)
    return im.transform((W, H), Image.EXTENT, (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2), Image.BILINEAR)

class Frame:
    def __init__(self, plan):
        self.vertical = plan.get("aspect", "9:16") == "9:16"
        self.W, self.H = (1080, 1920) if self.vertical else (1920, 1080)
        if self.vertical:  # Shorts UI safe zone
            self.L, self.R, self.T, self.B = 70, 880, 260, 1420
            self.big_y, self.cap_y, self.chip_y = 520, 1180, 300
        else:
            self.L, self.R, self.T, self.B = 120, 1800, 80, 1000
            self.big_y, self.cap_y, self.chip_y = 200, 860, 90
        self.cx = (self.L + self.R) // 2
        y = np.linspace(0, 1, self.H)[:, None]
        a = np.clip(0.30 + 0.45 * (np.abs(y - 0.45) * 2) ** 1.6, 0, 0.82)
        self.shade = Image.fromarray((np.broadcast_to(a, (self.H, self.W)) * 255).astype(np.uint8), "L")

def big_text(F, base, s, t, t0, pal):
    s = noemoji(s); k = pop(t, t0)
    if k <= 0 or not s: return
    layer = Image.new("RGBA", (F.W, F.H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    size = 96 if len(s) <= 8 else 80 if len(s) <= 14 else 66
    f = font(F_BLACK, size)
    lines = wrap(d, s.upper(), f, F.R - F.L)
    lh = int(size * 1.05); y = F.big_y - len(lines) * lh // 2
    for ln in lines:
        tw, _ = text_size(d, ln, f)
        d.text((F.cx - tw // 2, y), ln, font=f, fill=pal["acc"], stroke_width=9, stroke_fill=(10, 10, 16)); y += lh
    if k != 1:
        sc = max(0.01, k)
        lay2 = layer.resize((max(1, int(F.W * sc)), max(1, int(F.H * sc))), Image.BILINEAR)
        out = Image.new("RGBA", (F.W, F.H), (0, 0, 0, 0)); out.paste(lay2, (int(F.cx - F.cx * sc), int(F.big_y - F.big_y * sc))); layer = out
    base.alpha_composite(layer)

def chip(F, d, s, t, t0, pal):
    k = ease_out((t - t0) / 0.3)
    if k <= 0 or not s: return
    f = font(F_BOLD, 40); tw, th = text_size(d, s, f)
    x = F.cx - tw // 2; yy = F.chip_y - (1 - k) * 40
    d.rounded_rectangle((x - 30, yy - 18, x + tw + 30, yy + th + 30), 26, fill=(10, 10, 16, int(220 * k)), outline=pal["acc"] + (int(255 * k),), width=4)
    d.text((x, yy), s, font=f, fill=(255, 255, 255, int(255 * k)))

def captions(F, d, words, t, pal):
    cur = None
    for i, (w_, a, b) in enumerate(words):
        if a <= t < b + 0.15: cur = i
    if cur is None: return
    g0 = cur - cur % 3; group = words[g0:g0 + 3]
    f = font(F_BLACK, 60)
    lines = wrap(d, " ".join(w for w, _, _ in group), f, F.R - F.L)
    y = F.cap_y; k = 0
    for ln in lines:
        tw, _ = text_size(d, ln, f); x = F.cx - tw // 2
        for tok in ln.split(" "):
            col = pal["acc"] if g0 + k == cur else (255, 255, 255)
            d.text((x, y), tok, font=f, fill=col, stroke_width=8, stroke_fill=(0, 0, 0))
            x += text_size(d, tok + " ", f)[0]; k += 1
        y += 74

EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]")
def noemoji(s): return EMOJI.sub("", s or "").strip()

def caption_block(F, d, s, t, t0, pal):
    s = noemoji(s)
    k = ease_out((t - t0) / 0.4)
    if k <= 0 or not s: return
    f = font(F_BLACK, 58)
    lines = wrap(d, s, f, F.R - F.L - 40)
    y = F.cap_y - (1 - k) * 30
    for ln in lines:
        tw, _ = text_size(d, ln, f)
        d.text((F.cx - tw // 2, y), ln, font=f, fill=(255, 255, 255, int(255 * k)), stroke_width=8, stroke_fill=(0, 0, 0, int(255 * k))); y += 72

def particles(F, d, t, pal, seed):
    rng = random.Random(seed)
    for i in range(36):
        x = (rng.random() * F.W + t * rng.uniform(-15, 15)) % F.W
        y = (rng.random() * F.H - t * rng.uniform(10, 60)) % F.H
        r = rng.uniform(1.5, 4); a = int(80 + 120 * (0.5 + 0.5 * math.sin(t * 2 + i)))
        d.ellipse((x - r, y - r, x + r, y + r), fill=pal["acc2"] + (a,))

# ---------------------------------------------------------------- main
def main(plan_path, out_path):
    plan = json.load(open(plan_path))
    F = Frame(plan)
    pal = PALETTES.get(plan.get("palette", "night"), PALETTES["night"])
    style = plan.get("style", "flat")
    voice = plan.get("voice", "dmitri"); rate = plan.get("rate", 0.88)
    cast = {k: dict(v) for k, v in CH.DEFAULT_CHARS.items()}
    for k, v in plan.get("characters", {}).items():
        base = dict(cast.get(v.get("base", k), CH.DEFAULT_CHARS["boy"]))
        base.update({kk: tuple(vv) if isinstance(vv, list) else vv for kk, vv in v.items()}); cast[k] = base
    work = os.path.splitext(out_path)[0] + "_work"; os.makedirs(work, exist_ok=True)
    scenes = plan["scenes"]
    if voice != "none":
        missing = [w for sc in scenes if not sc.get("audio") for w in stress_lint(sc.get("say", ""))]
        if missing:
            print("STRESS MISSING:", ", ".join(sorted(set(missing))), file=sys.stderr)
            if not os.environ.get("ALLOW_NO_STRESS"): sys.exit(2)
        if re.search(r"\d", " ".join(sc.get("say", "") for sc in scenes)):
            print("DIGITS IN VOICE TEXT: write numbers as words", file=sys.stderr); sys.exit(2)

    # 1) timing + voice
    parts, t = [], 0.4
    for i, sc in enumerate(scenes):
        if voice != "none" and (sc.get("say") or sc.get("audio")):
            if sc.get("audio"):
                a = load_audio(os.path.join(ROOT, sc["audio"]))
            else:
                wp = os.path.join(work, f"v{i}.wav"); tts(sc["say"], voice, wp, rate); a = load_audio(wp)
            dur = len(a) / SR
            toks = sc.get("say", "").replace("́", "").split(); wts = [len(re.sub(r"\W", "", x)) + 2 for x in toks]
            tot = max(1, sum(wts)); acc = t; sc["_words"] = []
            for tok, wg in zip(toks, wts):
                dd = dur * 0.94 * wg / tot; sc["_words"].append((tok, acc, acc + dd)); acc += dd
            parts.append((t, a)); sc["_t0"], sc["_t1"] = t, t + dur; t += dur + 0.18
        else:
            dur = float(sc.get("dur", 3.0)); sc["_words"] = []
            sc["_t0"], sc["_t1"] = t, t + dur; t += dur
    total = t + 0.8

    # 2) audio mix
    n = int(total * SR); vo = np.zeros(n)
    for t0, a in parts:
        s = int(t0 * SR); vo[s:s + len(a)] += a[:max(0, n - s)]
    mus = AU.music(total, plan.get("music", "tense"), seed=abs(hash(plan["id"])) % 1000)[:n]
    env = np.convolve((np.abs(vo) > 0.02).astype(float), np.ones(int(0.3 * SR)) / (0.3 * SR), "same")
    mlevel = 0.55 if voice == "none" else 0.30 - 0.16 * np.clip(env * 3, 0, 1)
    mix = vo + mus * mlevel
    def add(sig, at, gain=1.0):
        s = int(at * SR)
        if 0 <= s < n: mix[s:s + len(sig)] += gain * sig[:n - s]
    for i, sc in enumerate(scenes):
        if i > 0: add(AU.sfx("whoosh", i), sc["_t0"] - 0.3, 0.6)
        if sc.get("big"): add(AU.sfx("pop", i), sc["_t0"] + 0.05, 0.5)
        if sc.get("chip"): add(AU.sfx("tick", i), sc["_t0"] - 0.1, 0.5)
        for k, name in enumerate(sc.get("sfx", [])): add(AU.sfx(name, i * 10 + k), sc["_t0"] + 0.1 * k, 0.8)
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.92
    apath = os.path.join(work, "mix.wav")
    with wave.open(apath, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    # mouth amplitude per frame
    hop = SR // FPS; nfr = int(total * FPS)
    amp = np.array([np.abs(vo[i * hop:(i + 1) * hop]).mean() if i * hop < n else 0 for i in range(nfr)])
    amp = np.clip(amp / max(1e-6, np.percentile(amp[amp > 0], 90) if (amp > 0).any() else 1), 0, 1)

    # 3) frames
    photos = {i: load_photo(os.path.join(ROOT, sc["photo"]), F.W, F.H) for i, sc in enumerate(scenes) if sc.get("photo")}
    all_words = [w for sc in scenes for w in sc["_words"]]
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{F.W}x{F.H}", "-r", str(FPS),
                           "-i", "-", "-i", apath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out_path], stdin=subprocess.PIPE)
    env_cache = {}
    for fi in range(nfr):
        tt = fi / FPS
        si = max([i for i, sc in enumerate(scenes) if sc["_t0"] - 0.2 <= tt] or [0])
        sc = scenes[si]
        p = max(0, min(1, (tt - sc["_t0"] + 0.2) / max(0.5, sc["_t1"] - sc["_t0"] + 0.4)))
        if si in photos:
            bg = photo_frame(photos[si], p, si + 7, F.W, F.H).convert("RGBA")
            dark = Image.new("RGBA", (F.W, F.H), (0, 0, 0, 255)); dark.putalpha(F.shade); bg.alpha_composite(dark)
        elif sc.get("env") or sc.get("chars"):
            bg = CH.env_layer(sc.get("env", "paper" if style == "doodle" else "room"), F.W, F.H, tt, pal, style, seed=si)
            for pr in sc.get("props", []):
                px = F.L + (F.R - F.L) * pr.get("x", 0.5); py = F.T + (F.B - F.T) * pr.get("y", 0.5)
                CH.prop(bg, pr["kind"], px, py, pr.get("s", 1.0), tt, style, seed=si, pal=pal)
            for c in sc.get("chars", []):
                spec = cast.get(c["id"], CH.DEFAULT_CHARS["boy"])
                sc_scale = c.get("scale", 1.0) * (1.35 if F.vertical else 1.0)
                cx = F.L + (F.R - F.L) * c.get("x", 0.5); cy = (1440 if F.vertical else 1010) + c.get("y", 0)
                ent = c.get("enter")
                if ent:
                    k = 1 - ease_out((tt - sc["_t0"] + 0.1) / 0.5)
                    if ent == "left": cx -= k * 900
                    elif ent == "right": cx += k * 900
                    elif ent == "bottom": cy += k * 900
                a = amp[fi] if c.get("speak") else 0.0
                CH.character(bg, spec, cx, cy, sc_scale, tt, c.get("pose", "idle"), a, style, seed=hash(c["id"]) % 97, look=c.get("look", 0), facing=c.get("facing", 1))
            for pr in sc.get("props_front", []):
                px = F.L + (F.R - F.L) * pr.get("x", 0.5); py = F.T + (F.B - F.T) * pr.get("y", 0.5)
                CH.prop(bg, pr["kind"], px, py, pr.get("s", 1.0), tt, style, seed=si + 5, pal=pal)
            bg = CH.stylize(bg, style, pal)
            cam = sc.get("cam")
            if cam:
                z = 1 + 0.10 * p if cam == "in" else 1.10 - 0.10 * p if cam == "out" else 1.06
                pan = (p - 0.5) * 0.08 * F.W if cam == "pan" else 0
                cw, chh = F.W / z, F.H / z
                cxm = min(max(F.W / 2 + pan, cw / 2), F.W - cw / 2); cym = min(max(F.H * 0.55, chh / 2), F.H - chh / 2)
                bg = bg.transform((F.W, F.H), Image.EXTENT, (cxm - cw / 2, cym - chh / 2, cxm + cw / 2, cym + chh / 2), Image.BILINEAR)
            if sc.get("shake"):
                ox = int(math.sin(tt * 50) * 10 * max(0, 1 - (tt - sc["_t0"]) / 0.6)); bg = bg.transform((F.W, F.H), Image.AFFINE, (1, 0, ox, 0, 1, 0))
        else:
            y = np.linspace(0, 1, F.H)[:, None]; x = np.linspace(0, 1, F.W)[None, :]
            mixv = np.clip(y * 0.8 + (0.5 + 0.5 * np.sin(x * 3 + y * 2 + tt * 0.6)) * 0.25, 0, 1)[..., None]
            bg = Image.fromarray((np.array(pal["bg0"]) * (1 - mixv) + np.array(pal["bg1"]) * mixv).astype(np.uint8)).convert("RGBA")
            particles(F, ImageDraw.Draw(bg, "RGBA"), tt, pal, si)
        has_chars = bool(sc.get("chars")) and si not in photos
        if F.vertical:
            F.big_y, F.cap_y = (440, 580) if has_chars else (520, 1180)
        d = ImageDraw.Draw(bg, "RGBA")
        flash = 1 - (tt - sc["_t0"] + 0.2) / 0.18
        if si > 0 and 0 < flash <= 1:
            bg = Image.blend(bg, Image.new("RGBA", (F.W, F.H), (255, 255, 255, 255)), 0.28 * flash); d = ImageDraw.Draw(bg, "RGBA")
        chip(F, d, sc.get("chip", ""), tt, sc["_t0"] - 0.1, pal)
        big_text(F, bg, sc.get("big", ""), tt, sc["_t0"] + 0.05, pal)
        d = ImageDraw.Draw(bg, "RGBA")
        if voice == "none":
            caption_block(F, d, sc.get("text", ""), tt, sc["_t0"] + 0.2, pal)
        else:
            captions(F, d, all_words, tt, pal)
        ff.stdin.write(bg.convert("RGB").tobytes())
    ff.stdin.close(); ff.wait()
    print(json.dumps({"out": out_path, "duration": round(total, 1)}))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
