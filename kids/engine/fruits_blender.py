# Персонажи-фрукты в Blender (bpy, рендер в облаке Cycles CPU).
# Рендерит циклы танца (2 доли такта) для каждого фрукта как RGBA-спрайты.
# Запуск: python3 kids/engine/fruits_blender.py OUT_DIR [fruit,...] [frames] [res]
import bpy, bmesh, math, sys, os
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sprites'
ONLY = sys.argv[2].split(',') if len(sys.argv) > 2 and sys.argv[2] != 'all' else None
NF = int(sys.argv[3]) if len(sys.argv) > 3 else 30          # кадров на цикл (2 доли)
RES = int(sys.argv[4]) if len(sys.argv) > 4 else 800
SAMPLES = int(os.environ.get('SAMPLES', '24'))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
S.render.engine = 'CYCLES'
S.cycles.device = 'CPU'
S.cycles.samples = SAMPLES
S.cycles.use_denoising = True
S.cycles.max_bounces = 4
S.render.film_transparent = True
S.render.resolution_x = RES
S.render.resolution_y = RES
S.render.image_settings.file_format = 'PNG'
S.render.image_settings.color_mode = 'RGBA'
S.view_settings.view_transform = 'Standard'
S.view_settings.look = 'None'
S.render.fps = 24

# мир: мягкий свет
w = bpy.data.worlds.new('W'); S.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.55, 0.6, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6

cam_data = bpy.data.cameras.new('Cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 3.6
cam = bpy.data.objects.new('Cam', cam_data); S.collection.objects.link(cam)
cam.location = (0, -12, 0.15); cam.rotation_euler = (math.radians(90), 0, 0); S.camera = cam

def light(name, loc, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    o = bpy.data.objects.new(name, ld); S.collection.objects.link(o); o.location = loc
    d = Vector((0, 0, 0)) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
light('Key', (-3, -5, 4), 900, 4)
light('Fill', (4, -4, 1), 350, 5, (0.9, 0.95, 1))
light('Rim', (0, 4, 3), 700, 3)

_mats = {}
def mat(name, rgb, rough=0.45, emis=0.0, coat=0.3):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    try: b.inputs['Coat Weight'].default_value = coat
    except KeyError: pass
    if emis:
        b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = emis
    _mats[name] = m; return m

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def sphere(name, loc, scale, m, parent, seg=48, ring=24):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); S.collection.objects.link(o)
    o.location = loc; o.scale = scale; o.data.materials.append(m); o.parent = parent
    return o

def cyl(name, p1, p2, r, m, parent):
    p1, p2 = Vector(p1), Vector(p2); d = p2 - p1
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r, depth=d.length)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); S.collection.objects.link(o)
    o.location = (p1 + p2) / 2; o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(m); o.parent = parent; return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None); S.collection.objects.link(o); o.location = loc; o.parent = parent
    return o

def deform_mesh(o, fn):
    for v in o.data.vertices: v.co = fn(v.co.copy())

def hit(body, x, z):
    """Точка на передней поверхности тела (в координатах root)."""
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg)
    mw = body.matrix_world; inv = mw.inverted()
    o = inv @ Vector((x, -20, z)); d = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
    ok, loc, nor, _ = ev.ray_cast(o, d)
    if not ok: return Vector((x, -0.9, z))
    return mw @ loc

LIMB = mat('limb', srgb('#3A2A20'), 0.5)
GLOVE = mat('glove', srgb('#FFFFFF'), 0.35)
WHITE = mat('eyewhite', srgb('#FFFFFF'), 0.15, coat=0.8)
PUPIL = mat('pupil', srgb('#1A1420'), 0.1, coat=1.0)
SHINE = mat('shine', (1, 1, 1), 0.2, emis=4)
MOUTH = mat('mouth', srgb('#7A1426'), 0.4)
TONGUE = mat('tongue', srgb('#FF6F8A'), 0.4)
CHEEK = mat('cheek', srgb('#FF8FA8'), 0.6)

def face(root, body, cz, s, shoe, fx=0.0):
    parts = {}
    for side in (-1, 1):
        x = fx + 0.27 * s * side
        p = hit(body, x, cz + 0.16 * s)
        ew = sphere(f'eyeW{side}', p + Vector((0, -0.03, 0)), (0.16 * s, 0.07, 0.2 * s), WHITE, root)
        pu = sphere(f'pupil{side}', p + Vector((0.02 * s, -0.09, -0.03 * s)), (0.095 * s, 0.05, 0.12 * s), PUPIL, root)
        sh = sphere(f'shine{side}', p + Vector((0.055 * s, -0.135, 0.03 * s)), (0.035 * s, 0.02, 0.04 * s), SHINE, root, 16, 8)
        pc = hit(body, fx + 0.42 * s * side, cz - 0.1 * s)
        ck = sphere(f'cheek{side}', pc + Vector((0, -0.01, 0)), (0.11 * s, 0.03, 0.07 * s), CHEEK, root, 24, 12)
        parts[side] = (ew, pu, sh)
    pm = hit(body, fx, cz - 0.12 * s)
    # рот: полукруг (улыбка открытая)
    me = bpy.data.meshes.new('mouth'); bm = bmesh.new()
    n = 24; verts = [bm.verts.new((0, 0, 0))]
    for i in range(n + 1):
        a = math.pi + math.pi * i / n
        verts.append(bm.verts.new((0.2 * s * math.cos(a), 0, 0.16 * s * math.sin(a) + 0.02 * s)))
    for i in range(1, n + 1): bm.faces.new((verts[0], verts[i], verts[i + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    bm.to_mesh(me); bm.free()
    mo = bpy.data.objects.new('mouth', me); S.collection.objects.link(mo); mo.data.materials.append(MOUTH)
    mo.location = pm + Vector((0, -0.035, 0)); mo.parent = root
    tg = sphere('tongue', pm + Vector((0, -0.05, -0.09 * s)), (0.1 * s, 0.02, 0.05 * s), TONGUE, mo, 24, 12)
    tg.location = Vector((0, -0.015, -0.09 * s)); tg.parent = mo
    return parts, mo

def limbs(root, half_w, bottom_z, shoe_m, arm_z=0.0, cx=0.0):
    rig = {}
    for side in (-1, 1):
        piv = empty(f'armpiv{side}', (cx + side * half_w, -0.05, arm_z), root)
        cyl(f'arm{side}', (0, 0, 0), (side * 0.55, 0, 0), 0.065, LIMB, piv)
        sphere(f'hand{side}', (side * 0.62, 0, 0), (0.12, 0.12, 0.12), GLOVE, piv, 24, 12)
        rig[f'arm{side}'] = piv
        lp = empty(f'legpiv{side}', (cx + side * 0.25, 0, bottom_z + 0.08), root)
        cyl(f'leg{side}', (0, 0, 0), (0, 0, -0.42), 0.065, LIMB, lp)
        sphere(f'shoe{side}', (side * 0.06, -0.08, -0.47), (0.17, 0.22, 0.1), shoe_m, lp, 24, 12)
        rig[f'leg{side}'] = lp
    return rig

FRUITS = {}

def make_banana():
    root = empty('banana', (0, 0, 0))
    yel = mat('banana', srgb('#FFD93B'), 0.4)
    tip = mat('bananatip', srgb('#5B3A1E'), 0.6)
    # тело: трубка по дуге
    me = bpy.data.meshes.new('banana_body'); bm = bmesh.new()
    NS, NR = 48, 28; R_arc = 2.4; ang = math.radians(62)
    rings = []
    for i in range(NS + 1):
        t = i / NS; a = -ang / 2 + ang * t
        c = Vector((R_arc * math.cos(a) - R_arc + 0.15, 0, R_arc * math.sin(a)))
        tang = Vector((-math.sin(a), 0, math.cos(a)))
        nrm = Vector((math.cos(a), 0, math.sin(a)))
        r = 0.62 * (math.sin(math.pi * t) ** 0.5) + 0.03
        ring = []
        for j in range(NR):
            b = 2 * math.pi * j / NR
            off = nrm * (math.cos(b) * r) + Vector((0, 1, 0)) * (math.sin(b) * r * 1.05)
            ring.append(bm.verts.new(c + off))
        rings.append(ring)
    for i in range(NS):
        for j in range(NR):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % NR], rings[i + 1][(j + 1) % NR], rings[i + 1][j]))
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    body = bpy.data.objects.new('banana_body', me); S.collection.objects.link(body)
    body.data.materials.append(yel); body.parent = root
    # кончики
    for a in (-ang / 2, ang / 2):
        c = Vector((R_arc * math.cos(a) - R_arc + 0.15, 0, R_arc * math.sin(a)))
        sphere('btip', c + Vector((0, 0, 0.06 if a > 0 else -0.06)), (0.07, 0.07, 0.09), tip, root, 16, 8)
    bpy.context.view_layer.update()
    rig = limbs(root, 0.55, -1.0, mat('shoeB', srgb('#3D7BFF'), 0.4), cx=0.15)
    eyes, mouth = face(root, body, 0.18, 0.85, None, fx=0.17)
    return dict(root=root, rig=rig, eyes=eyes, mouth=mouth)

def make_strawberry():
    root = empty('strawberry', (0, 0, 0))
    red = mat('straw', srgb('#FF2E4D'), 0.35)
    body = sphere('straw_body', (0, 0, -0.05), (1, 1, 1), red, root, 64, 32)
    def f(co):
        h = (co.z + 1) / 2  # 0 низ .. 1 верх
        k = 0.42 + 0.58 * (h ** 0.6)
        if h > 0.85: k *= 1 - (h - 0.85) * 1.2
        return Vector((co.x * k * 0.92, co.y * k * 0.85, co.z * 1.05))
    deform_mesh(body, f)
    bpy.context.view_layer.update()
    seed = mat('seed', srgb('#FFE45C'), 0.3)
    import random; rnd = random.Random(3)
    for v in list(body.data.vertices)[::37]:
        co = body.matrix_world @ v.co
        if co.z > 0.85 or co.z < -0.9: continue
        if co.y < -0.3 and abs(co.x) < 0.65 and -0.45 < co.z < 0.6: continue  # не на лице
        n = (co - Vector((0, 0, co.z))).normalized()
        sphere('seed', co + n * 0.01, (0.035, 0.035, 0.055), seed, root, 10, 6)
    leaf = mat('leaf', srgb('#3CC453'), 0.45)
    for i in range(6):
        a = 2 * math.pi * i / 6
        lf = sphere('leaf', (0.32 * math.cos(a), 0.32 * math.sin(a), 0.98), (0.36, 0.13, 0.05), leaf, root, 24, 12)
        lf.rotation_euler = (0, math.radians(-18), a)
    cyl('stem', (0, 0, 0.95), (0.05, 0, 1.28), 0.05, leaf, root)
    rig = limbs(root, 0.78, -1.0, mat('shoeS', srgb('#FFB020'), 0.4), 0.1)
    eyes, mouth = face(root, body, 0.12, 1.0, None)
    return dict(root=root, rig=rig, eyes=eyes, mouth=mouth)

def make_orange():
    root = empty('orange', (0, 0, 0))
    m = bpy.data.materials.new('orange'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb('#FF8A1F'), 1); b.inputs['Roughness'].default_value = 0.5
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 60
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.25
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    body = sphere('orange_body', (0, 0, 0), (1.0, 0.95, 0.95), m, root, 64, 32)
    bpy.context.view_layer.update()
    leaf = mat('leaf', srgb('#3CC453'), 0.45)
    cyl('ostem', (0, 0, 0.88), (0, 0, 1.05), 0.06, mat('stem', srgb('#6B4423'), 0.6), root)
    lf = sphere('oleaf', (0.25, 0, 1.08), (0.32, 0.12, 0.05), leaf, root, 24, 12); lf.rotation_euler = (0, math.radians(-25), 0)
    rig = limbs(root, 0.93, -0.95, mat('shoeO', srgb('#7B4DFF'), 0.4))
    eyes, mouth = face(root, body, 0.1, 1.05, None)
    return dict(root=root, rig=rig, eyes=eyes, mouth=mouth)

def make_apple():
    root = empty('apple', (0, 0, 0))
    grn = mat('apple', srgb('#6FD43A'), 0.3, coat=0.6)
    body = sphere('apple_body', (0, 0, 0), (1, 1, 1), grn, root, 64, 32)
    def f(co):
        rxy = math.hypot(co.x, co.y)
        z = co.z * 0.92
        if co.z > 0: z -= 0.2 * math.exp(-(rxy / 0.42) ** 2)
        else: z += 0.12 * math.exp(-(rxy / 0.3) ** 2)
        k = 1.04 + 0.06 * co.z
        return Vector((co.x * k, co.y * k * 0.95, z))
    deform_mesh(body, f); bpy.context.view_layer.update()
    cyl('astem', (0, 0, 0.5), (0.08, 0, 1.05), 0.055, mat('stem', srgb('#6B4423'), 0.6), root)
    lf = sphere('aleaf', (0.32, 0, 0.98), (0.34, 0.12, 0.05), mat('leaf', srgb('#3CC453'), 0.45), root, 24, 12)
    lf.rotation_euler = (0, math.radians(-30), 0)
    rig = limbs(root, 0.98, -0.92, mat('shoeA', srgb('#FF4FA0'), 0.4))
    eyes, mouth = face(root, body, 0.12, 1.05, None)
    return dict(root=root, rig=rig, eyes=eyes, mouth=mouth)

MAKERS = dict(banana=make_banana, strawberry=make_strawberry, orange=make_orange, apple=make_apple)

def all_objs(root):
    out = [root]
    for c in root.children: out += all_objs(c)
    return out

def pose(F, dance, f):
    """f: 0..NF-1, доли на кадрах 0 и NF/2."""
    half = NF / 2
    ph = (f % half) / half              # 0..1 внутри доли
    bounce = math.sin(math.pi * ph)     # 0 на долях, 1 между
    beat_i = int(f // half)
    r = F['root']; rig = F['rig']
    land = max(0.0, 1 - ph * 5) + max(0.0, (ph - 0.85) * 6.6)   # сжатие у земли
    if dance == 'bounce':
        r.location = (0, 0, 0.32 * bounce)
        sq = 1 - 0.13 * min(1, land); r.scale = (1 + (1 - sq) * 0.8, 1, sq)
        r.rotation_euler = (0, math.radians(6 * math.sin(2 * math.pi * f / NF)), 0)
        up = 1 if beat_i == 0 else -1
        rig['arm-1'].rotation_euler = (0, math.radians(-55 * up - 10 * bounce), 0)   # левая рука
        rig['arm1'].rotation_euler = (0, math.radians(-55 * up + 10 * bounce), 0)
        for s in (-1, 1): rig[f'leg{s}'].rotation_euler = (0, math.radians(s * 10 * bounce), 0)
    else:  # sway
        sw = math.sin(2 * math.pi * f / NF)
        r.location = (0.18 * sw, 0, 0.1 * bounce)
        r.scale = (1, 1, 1 - 0.05 * min(1, land))
        r.rotation_euler = (0, math.radians(-14 * sw), 0)
        wave = math.sin(4 * math.pi * f / NF)
        rig['arm-1'].rotation_euler = (0, math.radians(70 + 25 * wave), 0)
        rig['arm1'].rotation_euler = (0, math.radians(-70 + 25 * wave), 0)
        for s in (-1, 1): rig[f'leg{s}'].rotation_euler = (0, math.radians(-8 * sw + s * 4), 0)
    # рот поёт на долях
    F['mouth'].scale = (1, 1, 0.55 + 0.45 * (1 - ph) if ph < 0.6 else 0.55)
    # моргание в sway на кадрах 20-23
    blink = 0.12 if (dance == 'sway' and int(NF * 0.66) <= f <= int(NF * 0.66) + 2) else 1
    for s in (-1, 1):
        for o in F['eyes'][s]:
            if 'bz' not in o: o['bz'] = o.scale.z
            o.scale.z = o['bz'] * blink
        sh = F['eyes'][s][2]
        sh.hide_render = blink < 1

names = ONLY or list(MAKERS)
built = {}
for n in MAKERS:
    if n in names: built[n] = MAKERS[n]()

for n, F in built.items():
    for m, G in built.items():
        for o in all_objs(G['root']): o.hide_render = (m != n)
    for dance in ('bounce', 'sway'):
        frames = [int(x) for x in os.environ['TESTF'].split(',')] if os.environ.get('TESTF') else range(NF)
        if os.environ.get('TESTF') and dance == 'sway': frames = [20]
        for f in frames:
            pose(F, dance, f)
            # глаза-блики скрыты только при моргании
            S.render.filepath = os.path.join(OUT, f'{n}_{dance}_{f:03d}.png')
            bpy.ops.render.render(write_still=True)
        print('done', n, dance, flush=True)
