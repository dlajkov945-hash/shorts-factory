# Сборка ролика «Танцующие фрукты» из спрайтов Blender + звук. 1080x1920, 24 fps.
import os, math, random, subprocess, glob
from PIL import Image, ImageDraw, ImageFont, ImageFilter

D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '..', '..'))
P = os.path.join(ROOT, 'kids', 'fruits1'); SP = os.path.join(P, 'sprites'); AU = os.path.join(P, 'audio')
OUT = os.path.join(P, 'fruits1.mp4')
W, H, FPS, DUR = 1080, 1920, 24, 60.0
NF = 30
IBI, B0 = 0.6232522586586287, 0.7621209050996324

FR = ['banana', 'strawberry', 'orange', 'apple']
NAMES = {'banana': 'БАНАН', 'strawberry': 'КЛУБНИЧКА', 'orange': 'АПЕЛЬСИН', 'apple': 'ЯБЛОКО'}
COL = {'banana': (255, 217, 59), 'strawberry': (255, 60, 90), 'orange': (255, 140, 30), 'apple': (110, 212, 58)}

# ---- таймлайн ----
VOICE = [('v0', 2.0)] + [(f'v{i+1}', 6 + 10 * i + 0.6) for i in range(4)] + [('v5', 46.3), ('v6', 55.3)]
COUNTS = [46.3 + x for x in (1.68, 2.30, 3.14, 3.90)]
SFX = [('pop', 0.3), ('pop', 0.7), ('pop', 1.1), ('pop', 1.5)]
for i in range(4):
    s = 6 + 10 * i
    SFX += [('swish', s - 0.05), ('ding', s + 0.7)]
SFX += [('swish', 45.95)] + [('boing', c) for c in COUNTS] + [('ding', 55.3), ('pop', 55.35)]

def ease_out_back(x):
    c1 = 1.70158; c3 = c1 + 1; x = min(max(x, 0), 1)
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2

def ease_io(x):
    x = min(max(x, 0), 1); return x * x * (3 - 2 * x)

def beat_phase(t):
    return (t - B0) / IBI

_raw = {}
def sprite(fr, dance, t, size, offset=0.0):
    ph = (beat_phase(t) + offset) % 2.0
    idx = int(ph / 2.0 * NF) % NF
    key = (fr, dance, idx, size)
    if key not in _raw:
        im = Image.open(os.path.join(SP, f'{fr}_{dance}_{idx:03d}.png')).convert('RGBA')
        _raw[key] = im.resize((size, size), Image.LANCZOS)
        if len(_raw) > 900: _raw.pop(next(iter(_raw)))
    return _raw[key]

# ---- фон ----
def make_bg():
    bg = Image.new('RGB', (W, H))
    top, bot = (14, 10, 40), (40, 14, 60)
    px = bg.load()
    for y in range(H):
        k = y / H; c = tuple(int(top[i] + (bot[i] - top[i]) * k) for i in range(3))
        for x in range(W): px[x, y] = c
    return bg.convert('RGBA')
BG = make_bg()
rnd = random.Random(7)
STARS = [dict(x=rnd.uniform(0, W), y=rnd.uniform(0, H), r=rnd.uniform(6, 16), c=rnd.choice(
    [(255, 90, 120), (90, 200, 255), (255, 220, 70), (140, 255, 120), (200, 120, 255), (255, 160, 60)]),
    v=rnd.uniform(10, 35), ph=rnd.uniform(0, 6.28)) for _ in range(46)]
CONF = [dict(x=rnd.uniform(0, W), y=rnd.uniform(-400, -20), vy=rnd.uniform(350, 650), vx=rnd.uniform(-80, 80),
             rot=rnd.uniform(0, 6.28), w=rnd.uniform(14, 26), c=rnd.choice(
    [(255, 90, 120), (90, 200, 255), (255, 220, 70), (140, 255, 120), (200, 120, 255)])) for _ in range(140)]

FONT_PATH = sorted(glob.glob('/usr/share/fonts/truetype/google-fonts/ofl/montserrat/Montserrat[[]wght[]].ttf'))[0]
_fonts = {}
def font(sz):
    if sz not in _fonts:
        f = ImageFont.truetype(FONT_PATH, sz)
        try: f.set_variation_by_name('Black')
        except Exception: pass
        _fonts[sz] = f
    return _fonts[sz]

def draw_word(img, text, cx, cy, sz, col, t_in, t):
    """Слово с белой обводкой, буквы выпрыгивают по очереди и качаются в такт."""
    d = ImageDraw.Draw(img); f = font(sz)
    widths = [d.textlength(ch, font=f) for ch in text]; total = sum(widths) + 6 * (len(text) - 1)
    if total > W - 80:
        return draw_word(img, text, cx, cy, int(sz * (W - 80) / total), col, t_in, t)
    x = cx - total / 2
    for i, ch in enumerate(text):
        k = ease_out_back((t - t_in - i * 0.06) / 0.35)
        if k <= 0: x += widths[i] + 6; continue
        bob = 14 * math.sin(math.pi * 2 * (beat_phase(t) / 2) + i * 0.7)
        s = max(0.05, k); fs = max(8, int(sz * s))
        f2 = font(fs)
        y = cy + bob - fs / 2
        d.text((x + widths[i] / 2, y + fs / 2), ch, font=f2, fill=col, anchor='mm',
               stroke_width=max(2, int(fs * 0.09)), stroke_fill=(255, 255, 255))
        x += widths[i] + 6

def glow_ring(img, cx, cy, r, col, a):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*col, int(a)))
    ov = ov.filter(ImageFilter.GaussianBlur(40))
    img.alpha_composite(ov)

def paste(img, sp, cx, cy):
    img.alpha_composite(sp, (int(cx - sp.width / 2), int(cy - sp.height / 2)))

GRID = [(290, 760), (790, 760), (290, 1330), (790, 1330)]

def frame(t):
    img = BG.copy(); d = ImageDraw.Draw(img)
    bp = beat_phase(t); pulse = max(0, 1 - (bp % 1) * 3)
    for s in STARS:
        y = (s['y'] - s['v'] * t) % H
        r = s['r'] * (1 + 0.5 * pulse) * (0.7 + 0.3 * math.sin(t * 2 + s['ph']))
        d.ellipse((s['x'] - r, y - r, s['x'] + r, y + r), fill=s['c'])
    if t < 6.0:  # интро: все выпрыгивают
        for i, fr in enumerate(FR):
            k = ease_out_back((t - (0.3 + 0.4 * i)) / 0.45)
            if k <= 0: continue
            size = max(8, int(560 * k)); cx, cy = GRID[i]
            if t > 5.6: cx += (t - 5.6) / 0.4 * -1400 if i % 2 == 0 else (t - 5.6) / 0.4 * 1400
            paste(img, sprite(fr, 'bounce', t, size, i * 0.5), cx, cy)
        if t > 2.0: draw_word(img, 'ФРУКТЫ!', W / 2, 330, 190, (255, 220, 70), 2.0, t)
    elif t < 46.0:
        i = int((t - 6) // 10); fr = FR[i]; s = 6 + 10 * i; lt = t - s
        cx = W / 2
        if lt < 0.45: cx = W / 2 + (1 - ease_io(lt / 0.45)) * 1300
        if lt > 9.55: cx = W / 2 - ease_io((lt - 9.55) / 0.45) * 1300
        cy = 1150
        glow_ring(img, cx, cy - 40, 360 + 60 * pulse, COL[fr], 120 + 80 * pulse)
        dance = 'bounce' if (lt < 5 or lt > 8.5) else 'sway'
        paste(img, sprite(fr, dance, t, 1000), cx, cy)
        if 0.7 < lt < 9.6: draw_word(img, NAMES[fr], W / 2, 400, 170, COL[fr], s + 0.7, t)
    else:  # все вместе + счёт + финал
        lt = t - 46
        for i, fr in enumerate(FR):
            k = ease_out_back((lt - 0.08 * i) / 0.4)
            if k <= 0: continue
            jump = 0; big = 1.0
            if t < 55:
                c = COUNTS[i]
                if c <= t < c + 0.8:
                    q = (t - c) / 0.8; jump = -140 * math.sin(math.pi * q); big = 1 + 0.18 * math.sin(math.pi * q)
                if t >= c:
                    cx, cy = GRID[i]
                    draw_word(img, str(i + 1), cx, cy - 330 if i < 2 else cy + 330, 140, COL[fr], c, t)
            size = max(8, int(560 * k * big)); cx, cy = GRID[i]
            dance = 'sway' if t >= 55 else 'bounce'
            paste(img, sprite(fr, dance, t, size, i * 0.5), cx, cy + jump)
        if t < 48.5: draw_word(img, 'ВСЕ ВМЕСТЕ!', W / 2, 330, 150, (255, 220, 70), 46.4, t)
        if t >= 55.3:
            draw_word(img, 'ПОКА-ПОКА!', W / 2, 330, 160, (255, 120, 180), 55.4, t)
            ct = t - 55.3
            for c in CONF:
                y = c['y'] + c['vy'] * ct; x = c['x'] + c['vx'] * ct + 30 * math.sin(ct * 3 + c['rot'])
                if y > H + 40: continue
                a = c['rot'] + ct * 5; w2 = c['w'] * abs(math.cos(a)) + 4
                d.rectangle((x - w2 / 2, y - c['w'] / 2, x + w2 / 2, y + c['w'] / 2), fill=c['c'])
    if t > DUR - 0.6:
        k = (t - (DUR - 0.6)) / 0.6
        img = Image.blend(img, Image.new('RGBA', (W, H), (0, 0, 0, 255)), min(1, k))
    return img.convert('RGB')

def render_video(path, t0=0, t1=DUR):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                          '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                          '-pix_fmt', 'yuv420p', path], stdin=subprocess.PIPE)
    n0, n1 = int(t0 * FPS), int(t1 * FPS)
    for n in range(n0, n1):
        p.stdin.write(frame(n / FPS).tobytes())
    p.stdin.close(); p.wait()

def mix_audio(path):
    inputs = ['-stream_loop', '1', '-i', os.path.join(AU, 'music.mp3')]
    filt = ['[0]volume=0.42,atrim=0:%.2f[m]' % DUR]
    labels = ['[m]']; n = 1
    for v, at in VOICE:
        inputs += ['-i', os.path.join(AU, v + '.mp3')]
        filt.append(f'[{n}]volume=1.6,adelay={int(at*1000)}|{int(at*1000)}[a{n}]'); labels.append(f'[a{n}]'); n += 1
    for s, at in SFX:
        inputs += ['-i', os.path.join(ROOT, 'assets', 'sfx', s + '.mp3')]
        filt.append(f'[{n}]volume=0.45,adelay={int(at*1000)}|{int(at*1000)}[a{n}]'); labels.append(f'[a{n}]'); n += 1
    filt.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0,afade=t=out:st={DUR-0.8}:d=0.8,alimiter=limit=0.89[out]')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filt), '-map', '[out]',
                    '-t', str(DUR), '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', path], check=True)

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'still':
        for t in map(float, sys.argv[2].split(',')): frame(t).save(f'/tmp/claude-0/kt/still_{t:05.1f}.jpg', quality=85)
    else:
        v = os.path.join(P, '_v.mp4'); a = os.path.join(P, '_a.m4a')
        mix_audio(a); render_video(v)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', v, '-i', a, '-c', 'copy', '-shortest', OUT], check=True)
        os.remove(v); os.remove(a); print('OK', OUT)
