"""2D characters and illustrated environments drawn in code, in several art styles.

Styles: flat (clean vector), doodle (wobbly hand-drawn lines on paper), neon (glowing outlines),
cutout (paper cut-out with drop shadows), pixel (chunky pixel art via downscale).
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

INK = (24, 22, 30)

def jit(p, t, style, seed, amp=4):
    """Boiling-line jitter for doodle style (changes 8 times per second)."""
    if style != "doodle":
        return p
    k = int(t * 8)
    r = random.Random(hash((seed, k, round(p[0]), round(p[1]))) & 0xffffffff)
    return (p[0] + r.uniform(-amp, amp), p[1] + r.uniform(-amp, amp))

def poly(d, pts, fill, style, t, seed, outline=INK, width=6):
    pts = [jit(p, t, style, seed + i) for i, p in enumerate(pts)]
    if style == "neon":
        d.line(pts + [pts[0]], fill=fill, width=width + 2, joint="curve")
    else:
        d.polygon(pts, fill=fill)
        if style in ("doodle", "flat", "cutout"):
            d.line(pts + [pts[0]], fill=outline, width=width if style != "flat" else max(2, width // 2), joint="curve")

def ell(d, box, fill, style, t, seed, outline=INK, width=6, n=28):
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    pts = [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in np.linspace(0, 2 * math.pi, n, endpoint=False)]
    poly(d, pts, fill, style, t, seed, outline, width)

def rrect(d, box, r, fill, style, t, seed, outline=INK, width=6):
    x0, y0, x1, y1 = box
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for a in np.linspace(a0, a0 + 90, 6):
            pts.append((cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))))
    poly(d, pts, fill, style, t, seed, outline, width)

def limb(d, a, b, col, w, style, t, seed):
    a, b = jit(a, t, style, seed), jit(b, t, style, seed + 1)
    if style != "neon":
        d.line([a, b], fill=INK, width=w + (8 if style != "flat" else 4))
    d.line([a, b], fill=col, width=w)
    for p in (b,):
        r = w * 0.55
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=col)

DEFAULT_CHARS = {
    "boy":    {"skin": (255, 205, 160), "hair": (70, 45, 30), "shirt": (60, 140, 255), "pants": (40, 50, 80), "hairstyle": "spiky", "size": 1.0},
    "girl":   {"skin": (250, 210, 175), "hair": (160, 70, 40), "shirt": (255, 90, 140), "pants": (60, 50, 90), "hairstyle": "long", "size": 1.0},
    "man":    {"skin": (225, 175, 135), "hair": (30, 30, 35), "shirt": (90, 180, 120), "pants": (50, 50, 60), "hairstyle": "short", "size": 1.15},
    "mom":    {"skin": (250, 210, 175), "hair": (110, 60, 35), "shirt": (230, 80, 120), "pants": (70, 60, 100), "hairstyle": "long", "size": 1.12},
    "granny": {"skin": (240, 200, 170), "hair": (220, 220, 225), "shirt": (170, 110, 200), "pants": (90, 70, 100), "hairstyle": "bun", "size": 0.95},
    "robot":  {"skin": (180, 195, 210), "hair": (255, 80, 80), "shirt": (120, 135, 150), "pants": (80, 90, 100), "hairstyle": "antenna", "size": 1.0},
    "cat":    {"skin": (255, 170, 70), "hair": (255, 170, 70), "shirt": (255, 170, 70), "pants": (255, 170, 70), "hairstyle": "ears", "size": 0.8},
}

POSES = {  # (left arm angle, right arm angle, brow tilt, mouth)
    "idle":  (100, 80, 0, "smile"),
    "talk":  (110, 60, 0, "talk"),
    "shock": (200, -20, -12, "o"),
    "happy": (220, -40, 6, "grin"),
    "think": (110, -60, 8, "flat"),
    "sad":   (95, 85, 14, "sad"),
    "point": (110, 0, 0, "talk"),
    "scared": (160, 20, -14, "o"),
}

def character(img, spec, x, y, scale, t, pose="idle", amp=0.0, style="flat", seed=0, look=0.0, facing=1):
    """Draw a character with feet at (x, y). amp in 0..1 drives the mouth."""
    d = ImageDraw.Draw(img, "RGBA")
    s = scale * spec.get("size", 1.0)
    la, ra, brow, mouth = POSES.get(pose, POSES["idle"])
    bob = math.sin(t * 3.2 + seed) * 6 * s + (abs(math.sin(t * 9)) * 8 * s if pose == "happy" else 0)
    shake = math.sin(t * 40) * 4 * s if pose in ("shock", "scared") else 0
    x += shake; y_top = y - 420 * s + bob
    col = spec
    w = int(6 * max(0.6, s))
    hx, hy, hr = x, y_top + 70 * s, 95 * s
    # legs
    for i, dx in enumerate((-32, 32)):
        lift = math.sin(t * 6 + i * math.pi) * 6 * s if pose == "happy" else 0
        rrect(d, (x + dx * s - 22 * s, y - 150 * s, x + dx * s + 22 * s, y - lift), 16 * s, col["pants"], style, t, seed + 10 + i, width=w)
        ell(d, (x + dx * s - 34 * s + (10 * s * facing), y - 22 * s - lift, x + dx * s + 30 * s + (10 * s * facing), y + 10 * s - lift), INK if style != "neon" else col["shirt"], style, t, seed + 12 + i, width=w)
    # body
    rrect(d, (x - 75 * s, y_top + 150 * s, x + 75 * s, y - 135 * s), 40 * s, col["shirt"], style, t, seed + 20, width=w)
    # arms
    for side, ang in ((-1, la), (1, ra)):
        sway = math.sin(t * 4 + side) * 6
        if pose == "talk" and side == 1:
            sway += math.sin(t * 7) * 18
        a = math.radians(ang + sway)
        sx, sy = x + side * 70 * s, y_top + 175 * s
        ex, ey = sx + math.cos(a) * 75 * s, sy + math.sin(a) * 75 * s
        a2 = a - side * 0.35
        hx2, hy2 = ex + math.cos(a2) * 65 * s, ey + math.sin(a2) * 65 * s
        limb(d, (sx, sy), (ex, ey), col["shirt"], int(30 * s), style, t, seed + 30 + side)
        limb(d, (ex, ey), (hx2, hy2), col["skin"], int(26 * s), style, t, seed + 40 + side)
    # head
    hs = spec.get("hairstyle", "short")
    if hs == "long":
        rrect(d, (hx - 108 * s, hy - 90 * s, hx + 108 * s, hy + 120 * s), 60 * s, col["hair"], style, t, seed + 50, width=w)
    ell(d, (hx - hr, hy - hr, hx + hr, hy + hr * 1.05), col["skin"], style, t, seed + 51, width=w)
    if hs == "spiky":
        pts = [(hx - hr, hy - 20 * s)]
        for k in range(7):
            px = hx - hr + (k + 0.5) * 2 * hr / 7
            pts += [(px, hy - hr - (40 if k % 2 == 0 else 15) * s), (px + hr / 7, hy - hr * 0.7)]
        pts += [(hx + hr, hy - 20 * s), (hx + hr * 0.7, hy - hr * 0.5), (hx - hr * 0.7, hy - hr * 0.5)]
        poly(d, pts, col["hair"], style, t, seed + 52, width=w)
    elif hs in ("short", "long"):
        ell(d, (hx - hr * 1.02, hy - hr * 1.12, hx + hr * 1.02, hy - hr * 0.05), col["hair"], style, t, seed + 53, width=w)
    elif hs == "bun":
        ell(d, (hx - hr, hy - hr * 1.05, hx + hr, hy - hr * 0.2), col["hair"], style, t, seed + 54, width=w)
        ell(d, (hx - 40 * s, hy - hr - 70 * s, hx + 40 * s, hy - hr + 5 * s), col["hair"], style, t, seed + 55, width=w)
    elif hs == "antenna":
        limb(d, (hx, hy - hr), (hx, hy - hr - 60 * s), (120, 130, 140), int(8 * s), style, t, seed + 56)
        blink_on = int(t * 2) % 2
        ell(d, (hx - 16 * s, hy - hr - 80 * s, hx + 16 * s, hy - hr - 48 * s), col["hair"] if blink_on else (120, 40, 40), style, t, seed + 57, width=w)
    elif hs == "ears":
        for side in (-1, 1):
            poly(d, [(hx + side * 30 * s, hy - hr * 0.8), (hx + side * 85 * s, hy - hr * 1.5), (hx + side * 90 * s, hy - hr * 0.4)], col["hair"], style, t, seed + 58 + side, width=w)
    # face
    blink = (t * 1.0 + seed * 0.37) % 3.4 < 0.12
    eye_dx = 36 * s
    for side in (-1, 1):
        ex, ey = hx + side * eye_dx + look * 8 * s * facing, hy - 5 * s
        eh = 4 * s if blink else (34 if pose in ("shock", "scared") else 26) * s
        ew = 22 * s
        if style == "neon":
            d.ellipse((ex - ew, ey - eh, ex + ew, ey + eh), outline=(255, 255, 255), width=w)
        else:
            d.ellipse((ex - ew, ey - eh, ex + ew, ey + eh), fill=(255, 255, 255), outline=INK, width=max(2, w // 2))
            if not blink:
                pr = 11 * s
                d.ellipse((ex - pr + look * 6 * s, ey - pr, ex + pr + look * 6 * s, ey + pr), fill=INK)
                d.ellipse((ex - pr * 0.3 + look * 6 * s, ey - pr * 0.6, ex + pr * 0.2 + look * 6 * s, ey - pr * 0.1), fill=(255, 255, 255))
        by = ey - 42 * s
        d.line([(ex - 22 * s, by + side * brow * s * 0.0 + (brow * s if side == -1 else -brow * s) * 0.6), (ex + 22 * s, by - (brow * s if side == -1 else -brow * s) * 0.6)], fill=INK if style != "neon" else (255, 255, 255), width=int(8 * s))
    mx, my = hx, hy + 52 * s
    mc = INK if style != "neon" else (255, 255, 255)
    if mouth == "talk" or amp > 0.05:
        oh = 6 * s + 34 * s * min(1, amp * 1.6)
        d.ellipse((mx - 26 * s, my - oh / 2, mx + 26 * s, my + oh / 2), fill=(120, 30, 40), outline=mc, width=max(2, w // 2))
    elif mouth == "o":
        d.ellipse((mx - 20 * s, my - 24 * s, mx + 20 * s, my + 24 * s), fill=(120, 30, 40), outline=mc, width=max(2, w // 2))
    elif mouth == "grin":
        d.chord((mx - 40 * s, my - 30 * s, mx + 40 * s, my + 30 * s), 0, 180, fill=(120, 30, 40), outline=mc, width=max(2, w // 2))
    elif mouth == "sad":
        d.arc((mx - 30 * s, my, mx + 30 * s, my + 40 * s), 200, 340, fill=mc, width=int(7 * s))
    elif mouth == "flat":
        d.line([(mx - 22 * s, my), (mx + 22 * s, my + 4 * s)], fill=mc, width=int(7 * s))
    else:
        d.arc((mx - 32 * s, my - 30 * s, mx + 32 * s, my + 18 * s), 20, 160, fill=mc, width=int(7 * s))
    if style == "neon":
        pass

# ------------------------------------------------------------ environments
def env_layer(name, W, H, t, pal, style, seed=0):
    img = Image.new("RGBA", (W, H), pal["bg0"] + (255,))
    d = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(seed)
    if style == "doodle" or name == "paper":
        img.paste((246, 238, 220, 255), (0, 0, W, H))
        for i in range(0, H, 60):
            d.line([(0, i), (W, i)], fill=(200, 215, 235, 120), width=2)
        d.line([(90, 0), (90, H)], fill=(240, 150, 150, 160), width=3)
        if name == "paper":
            return img
    grad = np.linspace(0, 1, H)[:, None]
    c0, c1 = np.array(pal["bg0"]), np.array(pal["bg1"])
    if style != "doodle":
        arr = (c0 * (1 - grad) + c1 * grad).astype(np.uint8)
        img = Image.fromarray(np.repeat(arr[:, None, :], W, axis=1)).convert("RGBA")
        d = ImageDraw.Draw(img, "RGBA")
    ground = int(H * 0.72)
    if name == "city":
        for i in range(9):
            bw = rng.randint(90, 180); bh = rng.randint(250, 700); bx = rng.randint(-40, W)
            d.rectangle((bx, ground - bh, bx + bw, ground), fill=(20, 24, 40, 255))
            for wy in range(ground - bh + 30, ground - 20, 50):
                for wx in range(bx + 15, bx + bw - 20, 36):
                    if rng.random() < 0.45:
                        flick = 200 if (int(t * 2 + wx) % 17) else 120
                        d.rectangle((wx, wy, wx + 18, wy + 26), fill=(255, 220, 120, flick))
        d.rectangle((0, ground, W, H), fill=(28, 28, 36, 255))
    elif name == "underwater":
        rays = Image.new("RGBA", (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(rays)
        for i in range(6):
            x0 = (i * W / 5 + math.sin(t * 0.5 + i) * 60)
            rd.polygon([(x0, 0), (x0 + 90, 0), (x0 + 260, H), (x0 + 120, H)], fill=(160, 230, 255, 30))
        img = Image.alpha_composite(img, rays); d = ImageDraw.Draw(img, "RGBA")
        for i in range(30):
            bx = (rng.random() * W + math.sin(t * 2 + i) * 15)
            by = (rng.random() * H - t * rng.uniform(40, 120)) % H
            r = rng.uniform(4, 14)
            d.ellipse((bx - r, by - r, bx + r, by + r), outline=(220, 250, 255, 170), width=3)
        d.rectangle((0, ground + 60, W, H), fill=(214, 190, 130, 255))
        for i in range(7):
            sx = rng.randint(0, W); sh = rng.randint(120, 300)
            sway = math.sin(t * 1.5 + i) * 25
            d.line([(sx, ground + 70), (sx + sway, ground + 70 - sh)], fill=(40, 160, 90, 255), width=16)
    elif name == "space":
        for i in range(140):
            sx, sy = rng.random() * W, rng.random() * H
            a = int(120 + 120 * (0.5 + 0.5 * math.sin(t * 3 + i)))
            d.ellipse((sx - 2, sy - 2, sx + 2, sy + 2), fill=(255, 255, 255, a))
        pr = 260; px, py = W * 0.75, H * 0.2
        d.ellipse((px - pr, py - pr, px + pr, py + pr), fill=pal["acc2"] + (255,))
        d.ellipse((px - pr * 1.6, py - 30, px + pr * 1.6, py + 30), outline=pal["acc"] + (200,), width=10)
    elif name == "room":
        d.rectangle((0, 0, W, ground), fill=(232, 214, 190, 255))
        for i in range(0, W, 120):
            d.rectangle((i, 0, i + 60, ground), fill=(222, 202, 176, 255))
        d.rectangle((0, ground, W, H), fill=(150, 105, 75, 255))
        for i in range(0, W, 90):
            d.line([(i, ground), (i - 200, H)], fill=(120, 80, 55, 255), width=4)
        wx, wy = W * 0.62, H * 0.22
        d.rectangle((wx, wy, wx + 300, wy + 360), fill=(140, 200, 255, 255), outline=(250, 250, 250, 255), width=18)
        d.line([(wx + 150, wy), (wx + 150, wy + 360)], fill=(250, 250, 250, 255), width=12)
        d.rectangle((W * 0.08, ground - 260, W * 0.36, ground), fill=(110, 70, 160, 255))
    elif name == "forest":
        d.rectangle((0, ground, W, H), fill=(60, 120, 60, 255))
        for i in range(10):
            tx = rng.randint(-50, W); th = rng.randint(400, 800)
            d.rectangle((tx - 18, ground - 120, tx + 18, ground + 10), fill=(90, 60, 40, 255))
            for k in range(3):
                d.polygon([(tx, ground - th + k * 140), (tx - 140 + k * 10, ground - 100 - (2 - k) * 120), (tx + 140 - k * 10, ground - 100 - (2 - k) * 120)], fill=(30 + k * 15, 100 + k * 20, 60, 255))
    elif name == "desert":
        sun = (W * 0.3, H * 0.2)
        d.ellipse((sun[0] - 120, sun[1] - 120, sun[0] + 120, sun[1] + 120), fill=(255, 220, 120, 255))
        d.polygon([(0, ground), (W * 0.4, ground - 160), (W, ground - 40), (W, H), (0, H)], fill=(230, 180, 110, 255))
    elif name == "lab":
        d.rectangle((0, ground, W, H), fill=(60, 70, 85, 255))
        for i in range(4):
            x = 120 + i * 230
            d.rectangle((x, ground - 300, x + 160, ground - 290), fill=(200, 210, 220, 255))
            fl = 0.5 + 0.5 * math.sin(t * 3 + i)
            d.ellipse((x + 40, ground - 400, x + 120, ground - 300), fill=(pal["acc"][0], pal["acc"][1], pal["acc"][2], int(120 + 120 * fl)))
    elif name == "island":
        d.rectangle((0, ground, W, H), fill=(30, 120, 170, 255))
        for i in range(12):
            wy = ground + 30 + i * 40
            d.arc((-100 + (t * 40 + i * 70) % 200, wy, W + 100, wy + 40), 180, 360, fill=(220, 240, 255, 120), width=4)
        d.ellipse((W * 0.15, ground - 80, W * 0.85, ground + 80), fill=(235, 205, 140, 255))
        px = W * 0.55
        d.line([(px, ground - 20), (px + 40, ground - 420)], fill=(110, 75, 40, 255), width=30)
        for a in range(0, 360, 60):
            r = math.radians(a + math.sin(t) * 8)
            d.polygon([(px + 40, ground - 420), (px + 40 + math.cos(r) * 220, ground - 420 + math.sin(r) * 110 + 30), (px + 40 + math.cos(r + 0.3) * 160, ground - 420 + math.sin(r + 0.3) * 80)], fill=(40, 150, 70, 255))
    return img

def stylize(img, style, pal):
    if style == "neon":
        glow = img.filter(ImageFilter.GaussianBlur(14))
        return Image.alpha_composite(glow, img)
    if style == "pixel":
        w, h = img.size
        return img.resize((w // 8, h // 8), Image.NEAREST).resize((w, h), Image.NEAREST)
    return img
