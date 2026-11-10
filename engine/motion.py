#!/usr/bin/env python3
"""Motion-graphics Shorts (canvas engine, styles like «ЧТО ЕСЛИ», heist HUD, light UI + mascot, doodle, neon).
Usage: python3 engine/motion.py plans/x.json out/x.mp4 [--stills]
Plan: {"engine": "motion", "theme": "dark|heist|light|doodle|neon", "label": "ЧТО ЕСЛИ · 01", "music": "...",
       "stats": [{"key": "time", "label": "ВРЕМЯ"}], "scenes": [{"say": "...", "audio": "...", "hl": ["слово"],
       "tint": "#hex", "sfx": [...], "stats": {...}, "exit": "whip", "els": [{"v": "drop", "y": 0.42, "on": "слово"}]}]}
See engine/MOTION.md for every element."""
import json, os, re, subprocess, sys, wave
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio as AU
import render as R

ROOT = R.ROOT
FPS = 30
SR = AU.SR
norm = lambda x: re.sub(r"[^а-яёa-z0-9]", "", x.lower().replace("́", "").replace("ё", "е"))


def main(plan_path, out_path, stills=False):
    plan = json.load(open(plan_path))
    scenes = plan["scenes"]
    voice = plan.get("voice", "eleven")
    work = os.path.join(ROOT, "out", plan["id"] + "_motion"); os.makedirs(work, exist_ok=True)
    if voice != "none":
        missing = [w for sc in scenes if not sc.get("audio") for w in R.stress_lint(sc.get("say", ""))]
        if missing and not os.environ.get("ALLOW_NO_STRESS"):
            print("STRESS MISSING:", ", ".join(sorted(set(missing))), file=sys.stderr); sys.exit(2)
        if re.search(r"\d", " ".join(sc.get("say", "") for sc in scenes)):
            print("DIGITS IN VOICE TEXT: write numbers as words", file=sys.stderr); sys.exit(2)

    # 1) timing + voice + word alignment
    parts, words, t = [], [], 0.12
    for i, sc in enumerate(scenes):
        if voice != "none" and (sc.get("audio") or sc.get("say")):
            if sc.get("audio"):
                a = R.load_audio(os.path.join(ROOT, sc["audio"]))
            else:
                wp = os.path.join(work, f"v{i}.wav"); R.tts(sc["say"], plan.get("piper", "dmitri"), wp, plan.get("rate", 0.88)); a = R.load_audio(wp)
            dur = len(a) / SR
            toks = sc.get("say", "").replace("́", "").split()
            al = R.align_words(toks, a, SR)
            if not al:
                wts = [len(re.sub(r"\W", "", x)) + 2 for x in toks]; tot = max(1, sum(wts)); acc = 0; al = []
                for wg in wts: d = dur * .94 * wg / tot; al.append((acc, acc + d)); acc += d
            hl = [norm(h) for h in sc.get("hl", [])]
            for tok, (a0, b0) in zip(toks, al):
                words.append({"w": tok, "t0": round(t + a0, 3), "t1": round(t + b0, 3), "si": i, "hl": any(norm(tok).startswith(h) for h in hl if h)})
            parts.append((t, a)); sc["t0"], sc["t1"] = round(t, 3), round(t + dur, 3)
            t += dur + sc.get("pause", 0.22)
        else:
            dur = float(sc.get("dur", 3.0)); sc["t0"], sc["t1"] = round(t, 3), round(t + dur, 3); t += dur
        # element triggers on a spoken word: "on": "слово" -> seconds from scene start
        sw = [w for w in words if w["si"] == i]
        for e in sc.get("els", []):
            if e.get("on"):
                hit = next((w for w in sw if norm(w["w"]).startswith(norm(e["on"]))), None)
                e["_at"] = round((hit["t0"] - sc["t0"]) - 0.05, 3) if hit else e.get("at", 0)
            for k in [k for k in list(e) if k.endswith("_on") and k != "until_on"]:
                hit = next((w for w in sw if norm(w["w"]).startswith(norm(e[k]))), None)
                if hit: e[k[:-3]] = round(hit["t0"] - sc["t0"] - e.get("_at", e.get("at", 0)), 3)
            if e.get("until_on"):
                hit = next((w for w in sw if norm(w["w"]).startswith(norm(e["until_on"]))), None)
                if hit: e["until"] = round(hit["t0"] - sc["t0"] - 0.05, 3)
    total = round(t + plan.get("tail", 0.9), 2)

    # 2) audio: voice + music (ducked) + sfx
    n = int(total * SR); vo = np.zeros(n)
    for t0, a in parts:
        s = int(t0 * SR); vo[s:s + len(a)] += a[:max(0, n - s)]
    mus = AU.music(total, plan.get("music", "mystery"), seed=abs(hash(plan["id"])) % 1000)[:n]
    if len(mus) < n: mus = np.pad(mus, (0, n - len(mus)))
    env = np.convolve((np.abs(vo) > 0.02).astype(float), np.ones(int(0.3 * SR)) / (0.3 * SR), "same")
    mlevel = 0.55 if voice == "none" else 0.30 - 0.16 * np.clip(env * 3, 0, 1)
    mix = vo + mus * mlevel

    def add(sig, at, gain=1.0):
        s = int(at * SR)
        if 0 <= s < n: mix[s:s + len(sig)] += gain * sig[:n - s]
    for i, sc in enumerate(scenes):
        if i > 0: add(AU.sfx("whoosh", i), sc["t0"] - 0.25, 0.5)
        for k, name in enumerate(sc.get("sfx", [])): add(AU.sfx(name, i * 10 + k), sc["t0"] + 0.1 * k, 0.8)
        for e in sc.get("els", []):
            if e.get("sfx"): add(AU.sfx(e["sfx"], i * 7 + 3), sc["t0"] + e.get("_at", e.get("at", 0)), 0.7)
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.92
    apath = os.path.join(work, "mix.wav")
    with wave.open(apath, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    hop = SR // FPS; nfr = int(total * FPS)
    amp = np.array([np.abs(vo[i * hop:(i + 1) * hop]).mean() if i * hop < n else 0 for i in range(nfr)])
    if (amp > 0).any(): amp = np.clip(amp / np.percentile(amp[amp > 0], 90), 0, 1)

    # 3) film data for the canvas player
    for sc in scenes:
        for e in sc.get("els", []):
            if e.get("src") and not e["src"].startswith("/"): e["src"] = "/" + e["src"]
    film = {k: plan[k] for k in ("theme", "label", "brand", "stats", "colors", "captions", "dimInactive") if k in plan}
    film.update({"fps": FPS, "duration": total, "words": words, "amp": [round(float(x), 3) for x in amp],
                 "scenes": [{k: v for k, v in sc.items() if k not in ("say", "audio", "sfx", "hl")} for sc in scenes]})
    fj = os.path.join(work, "film.json"); json.dump(film, open(fj, "w"), ensure_ascii=False)
    rel = os.path.relpath(fj, ROOT)
    mjs = os.path.join(ROOT, "engine/motion/render.mjs")
    if stills:
        ts = ",".join(str(round(sc["t0"] + min(1.2, (sc["t1"] - sc["t0"]) * .6), 2)) for sc in scenes)
        subprocess.run(["node", mjs, rel, "-", "--at", ts, "--dir", os.path.join(work, "stills")], check=True, cwd=ROOT)
        print(json.dumps({"stills": os.path.join(work, "stills")})); return
    vid = os.path.join(work, "video.mp4")
    subprocess.run(["node", mjs, rel, vid], check=True, cwd=ROOT)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", vid, "-i", apath, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out_path], check=True)
    print(json.dumps({"out": out_path, "duration": total}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--stills" in sys.argv)
