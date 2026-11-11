"""Procedural music and sound effects (no third-party audio, no copyright issues)."""
import numpy as np

SR = 44100

def _note(f, t):
    return np.sin(2 * np.pi * f * t)

def _env(n, a=0.005, d=0.2, s=0.0, sr=SR):
    t = np.arange(n) / sr
    e = np.minimum(1, t / max(a, 1e-4)) * (s + (1 - s) * np.exp(-t / max(d, 1e-4)))
    return e

def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)

# mood: (bpm, scale root midi, progression as scale-degree chords, minor?, swing, instruments)
MOODS = {
    "tense":   dict(bpm=96,  root=45, prog=[0, 5, 3, 6], minor=True,  drums="heavy", lead="pluck"),
    "epic":    dict(bpm=88,  root=43, prog=[0, 5, 2, 6], minor=True,  drums="epic",  lead="brass"),
    "mystery": dict(bpm=78,  root=46, prog=[0, 1, 5, 4], minor=True,  drums="soft",  lead="bell"),
    "funny":   dict(bpm=124, root=48, prog=[0, 3, 4, 0], minor=False, drums="bouncy", lead="pluck"),
    "chill":   dict(bpm=84,  root=50, prog=[0, 5, 3, 4], minor=False, drums="lofi",  lead="keys"),
    "happy":   dict(bpm=116, root=52, prog=[0, 4, 5, 3], minor=False, drums="pop",   lead="bell"),
    "sad":     dict(bpm=70,  root=47, prog=[0, 5, 3, 4], minor=True,  drums="none",  lead="keys"),
    "action":  dict(bpm=140, root=40, prog=[0, 0, 5, 6], minor=True,  drums="heavy", lead="saw"),
}
MAJ = [0, 2, 4, 5, 7, 9, 11]
MIN = [0, 2, 3, 5, 7, 8, 10]

def chord(root, deg, minor):
    sc = MIN if minor else MAJ
    return [root + sc[(deg + k) % 7] + 12 * ((deg + k) // 7) for k in (0, 2, 4)]

def _kick(n):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (45 + 110 * np.exp(-t * 35)) * t) * np.exp(-t * 9)

def _snare(n, rng):
    t = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.7 + 0.3 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 18)

def _hat(n, rng):
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # crude highpass
    return x * np.exp(-np.arange(n) / SR * 60) * 0.4

def _inst(kind, f, n):
    t = np.arange(n) / SR
    if kind == "pluck":
        return (_note(f, t) + 0.5 * _note(2 * f, t) + 0.25 * _note(3 * f, t)) * _env(n, 0.002, 0.18)
    if kind == "bell":
        return (_note(f, t) + 0.4 * _note(2.76 * f, t) + 0.2 * _note(5.4 * f, t)) * _env(n, 0.002, 0.6)
    if kind == "keys":
        return (_note(f, t) + 0.3 * _note(2 * f, t)) * _env(n, 0.01, 0.5, 0.2)
    if kind == "brass":
        x = sum(_note(f * h, t) / h for h in range(1, 7))
        return x * _env(n, 0.04, 0.6, 0.5) * 0.6
    if kind == "saw":
        x = sum(_note(f * h, t) / h for h in range(1, 9))
        return x * _env(n, 0.005, 0.15, 0.1) * 0.5
    return _note(f, t) * _env(n)

import os, subprocess
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
# plan "music" names -> library files (assets/music/<name>.mp3, ElevenLabs Sound Effects, 30s loops)
MUSIC_ALIAS = {"chill": "lofi", "sad": "emotional", "action": "epic", "neon": "synthwave", "calm": "lofi"}
SFX_ALIAS = {"whoosh": ["swish"], "money": ["cash"], "phone": ["notify"], "impact": ["boom"]}

def _load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def lib_music(name):
    name = MUSIC_ALIAS.get(name, name)
    p = os.path.join(LIB, "music", name + ".mp3")
    return p if os.path.exists(p) else None

def music(dur, mood="tense", seed=0, energy=1.0):
    """Library loop if assets/music/<mood>.mp3 exists (looped with crossfade), else procedural.
    Prefix "synth:" forces the procedural generator."""
    if not str(mood).startswith("synth:"):
        p = lib_music(mood)
        if p:
            a = _load(p); n = int(dur * SR); xf = int(1.5 * SR)
            if len(a) > 2 * xf:
                out = np.zeros(n + len(a)); pos = 0; first = True
                while pos < n:
                    seg = a.copy()
                    if not first: seg[:xf] *= np.linspace(0, 1, xf)
                    seg[-xf:] *= np.linspace(1, 0, xf)
                    out[pos:pos + len(seg)] += seg; pos += len(a) - xf; first = False
                out = out[:n]
                fade = int(1.5 * SR); out[-fade:] *= np.linspace(1, 0, fade)
                out[:int(0.2 * SR)] *= np.linspace(0, 1, int(0.2 * SR))
                rms = np.sqrt((out ** 2).mean()) or 1
                out = out / rms * 0.09  # match loudness of the procedural score
                return np.clip(out, -0.95, 0.95)
    mood = str(mood).replace("synth:", "")
    return _music_proc(dur, mood, seed, energy)

def _music_proc(dur, mood="tense", seed=0, energy=1.0):
    cfg = MOODS.get(mood, MOODS["tense"])
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    beat = 60 / cfg["bpm"]; bar = beat * 4
    root = cfg["root"] + int(rng.integers(-2, 3))
    nbars = int(dur / bar) + 2
    out = np.zeros(int((nbars + 2) * bar * SR) + SR * 2)
    for b in range(nbars):
        deg = cfg["prog"][b % len(cfg["prog"])]
        notes = chord(root, deg, cfg["minor"])
        s0 = int(b * bar * SR)
        # pad
        L = int(bar * SR)
        t = np.arange(L) / SR
        pad = sum(_note(midi(m + 12), t) * 0.5 + _note(midi(m + 12) * 1.003, t) * 0.5 for m in notes)
        pad *= np.minimum(1, t / 0.4) * np.minimum(1, (bar - t) / 0.3)
        out[s0:s0 + L] += 0.05 * pad
        # bass
        for k in range(4 if cfg["bpm"] < 100 else 8):
            step = bar / (4 if cfg["bpm"] < 100 else 8)
            s = s0 + int(k * step * SR); Ln = int(step * 0.9 * SR)
            f = midi(notes[0] - 12 + (7 if k % 4 == 3 else 0))
            out[s:s + Ln] += 0.16 * _inst("pluck", f, Ln) * (0.6 + 0.4 * (k % 2 == 0))
        # arp / lead
        if b >= 1:
            for k in range(8):
                s = s0 + int(k * bar / 8 * SR); Ln = int(bar / 8 * 1.6 * SR)
                m = notes[[0, 1, 2, 1, 0, 2, 1, 2][k]] + 24
                if rng.random() < 0.85:
                    out[s:s + Ln] += 0.06 * energy * _inst(cfg["lead"], midi(m), Ln)
        # drums
        d = cfg["drums"]
        if d != "none" and b >= 1:
            for k in range(16):
                s = s0 + int(k * bar / 16 * SR)
                if d in ("heavy", "pop", "bouncy", "action") and k % 4 == 0:
                    out[s:s + 9000] += 0.42 * _kick(9000)
                if d == "epic" and k in (0, 6, 10):
                    out[s:s + 14000] += 0.55 * _kick(14000)
                if d in ("lofi", "soft") and k in (0, 10):
                    out[s:s + 9000] += 0.3 * _kick(9000)
                if k in (4, 12) and d != "soft":
                    out[s:s + 7000] += 0.18 * _snare(7000, rng)
                if d != "epic" and k % 2 == 0:
                    out[s:s + 3000] += 0.10 * _hat(3000, rng) * (1.3 if k % 4 == 2 else 0.7)
    out = out[:n]
    if cfg["drums"] == "lofi":
        out += 0.004 * rng.standard_normal(n)  # vinyl hiss
    fade = int(1.2 * SR); out[-fade:] *= np.linspace(1, 0, fade)
    out[:int(0.3 * SR)] *= np.linspace(0, 1, int(0.3 * SR))
    return out / max(1e-6, np.abs(out).max()) * 0.8

# ---------------- SFX
def sfx(kind, seed=0):
    """Library sound from assets/sfx/<kind>.mp3 (ElevenLabs) if present, else synthesized."""
    names = SFX_ALIAS.get(kind, [kind])
    files = [os.path.join(LIB, "sfx", nm + ".mp3") for nm in names if os.path.exists(os.path.join(LIB, "sfx", nm + ".mp3"))]
    if files and not str(kind).startswith("synth:"):
        a = _load(files[seed % len(files)])
        if len(a):
            a = a / max(1e-6, np.abs(a).max()) * 0.45
            tail = min(len(a), int(0.15 * SR)); a[-tail:] *= np.linspace(1, 0, tail)
            return a
    kind = str(kind).replace("synth:", "")
    return _sfx_proc(kind, seed)

def _sfx_proc(kind, seed=0):
    rng = np.random.default_rng(seed)
    if kind == "whoosh":
        n = int(0.5 * SR); x = rng.standard_normal(n)
        k = np.ones(30) / 30; x = np.convolve(x, k, "same")
        return 0.5 * x * np.sin(np.linspace(0, np.pi, n)) ** 2
    if kind == "pop":
        n = int(0.12 * SR); t = np.arange(n) / SR
        return 0.6 * np.sin(2 * np.pi * (300 + 900 * t / 0.12) * t) * np.exp(-t * 40)
    if kind == "ding":
        n = int(0.6 * SR); t = np.arange(n) / SR
        return 0.35 * (np.sin(2 * np.pi * 1320 * t) + 0.5 * np.sin(2 * np.pi * 2640 * t)) * np.exp(-t * 6)
    if kind == "boom":
        n = int(1.2 * SR); t = np.arange(n) / SR
        return 0.9 * (np.sin(2 * np.pi * (40 + 60 * np.exp(-t * 8)) * t) + 0.3 * rng.standard_normal(n) * np.exp(-t * 10)) * np.exp(-t * 3)
    if kind == "riser":
        n = int(1.0 * SR); t = np.arange(n) / SR
        x = rng.standard_normal(n); x = np.convolve(x, np.ones(8) / 8, "same")
        return 0.35 * x * (t / t[-1]) ** 2 + 0.15 * np.sin(2 * np.pi * (200 + 800 * t) * t) * (t / t[-1])
    if kind == "tick":
        n = int(0.05 * SR); t = np.arange(n) / SR
        return 0.4 * np.sin(2 * np.pi * 2000 * t) * np.exp(-t * 120)
    if kind == "heart":
        n = int(0.8 * SR); out = np.zeros(n)
        for o in (0, int(0.22 * SR)):
            L = int(0.15 * SR); t = np.arange(L) / SR
            out[o:o + L] += 0.8 * np.sin(2 * np.pi * 55 * t) * np.exp(-t * 25)
        return out
    if kind == "boing":
        n = int(0.5 * SR); t = np.arange(n) / SR
        return 0.5 * np.sin(2 * np.pi * (180 + 120 * np.sin(2 * np.pi * 12 * t)) * t) * np.exp(-t * 5)
    if kind == "glitch":
        n = int(0.25 * SR); x = np.sign(np.sin(2 * np.pi * rng.uniform(80, 400) * np.arange(n) / SR))
        return 0.25 * x * (rng.random(n) > 0.3)
    return np.zeros(1)
