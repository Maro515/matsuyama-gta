"""樹木（trees.glb）・街具（props.glb）・船/飛行機/みかん（misc.glb）。
実行: Blender -b --factory-startup -P nature_props.py -- [trees|props|misc|all]
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix, noise
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

R = random.Random(42)


# ======================================================================
# 樹木（幹・枝＋内側の樹冠ボリューム＋アルファ付き「葉カード」）
# ======================================================================
import numpy as np


def leaf_texture(name, kind='broad', n=512, seed=5):
    """葉の束を描いたRGBAテクスチャ（numpyで生成）。"""
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    cnt = {'broad': 260, 'pine': 70, 'mikan': 300, 'sakura': 900}[kind]
    base = {'broad': (0.20, 0.36, 0.13), 'pine': (0.13, 0.25, 0.11), 'mikan': (0.12, 0.27, 0.09), 'sakura': (0.98, 0.58, 0.70)}[kind]
    for _ in range(cnt):
        r = np.sqrt(rng.random()) * n * 0.42
        a = rng.random() * 2 * np.pi
        cx, cy = n / 2 + np.cos(a) * r, n / 2 + np.sin(a) * r
        th = rng.random() * np.pi
        shade = rng.uniform(0.65, 1.35)
        c = np.array(base) * shade
        if kind == 'sakura':   # 花びら: 淡いピンク〜白、ところどころ若葉
            k = rng.random()
            c = np.array((1.0, 0.84, 0.89)) * rng.uniform(0.92, 1.04) if k < 0.3 else np.array(base) * rng.uniform(0.85, 1.08)
            if k > 0.95:
                c = np.array((0.42, 0.55, 0.25))
            c = np.clip(c, 0, 1)
        if kind == 'pine':
            for k in range(14):
                t = th + (k / 14 - 0.5) * 1.6
                L = rng.uniform(26, 40)
                for s in np.linspace(0, 1, 40):
                    px, py = int(cx + np.cos(t) * L * s), int(cy + np.sin(t) * L * s)
                    if 0 <= px < n and 0 <= py < n:
                        img[max(0, py - 1):py + 1, max(0, px - 1):px + 1, :3] = c * (0.8 + 0.4 * s)
                        img[max(0, py - 1):py + 1, max(0, px - 1):px + 1, 3] = 1
            continue
        L, Wd = (rng.uniform(16, 26), rng.uniform(7, 11)) if kind == 'broad' else (rng.uniform(6, 10), rng.uniform(5, 8)) if kind == 'sakura' else (rng.uniform(13, 19), rng.uniform(6, 9))
        x0, x1 = int(max(0, cx - L)), int(min(n, cx + L + 1))
        y0, y1 = int(max(0, cy - L)), int(min(n, cy + L + 1))
        if x1 <= x0 or y1 <= y0:
            continue
        X = xx[y0:y1, x0:x1] - cx
        Y = yy[y0:y1, x0:x1] - cy
        u = X * np.cos(th) + Y * np.sin(th)
        v = -X * np.sin(th) + Y * np.cos(th)
        m = (u / L) ** 2 + (v / Wd) ** 2 < 1
        light = 0.85 + 0.3 * (v / Wd) * -1  # 片側を明るく
        rib = np.abs(v) < 0.8
        col = c[None, None, :] * light[..., None]
        col[rib] *= 1.25
        img[y0:y1, x0:x1, :3] = np.where(m[..., None], col, img[y0:y1, x0:x1, :3])
        img[y0:y1, x0:x1, 3] = np.where(m, 1.0, img[y0:y1, x0:x1, 3])
    if kind == 'mikan':
        for _ in range(16):
            r = np.sqrt(rng.random()) * n * 0.38
            a = rng.random() * 2 * np.pi
            cx, cy = n / 2 + np.cos(a) * r, n / 2 + np.sin(a) * r
            d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            m = d < 11
            sh = np.clip(1.1 - d / 14, 0.6, 1.1)
            img[m, 0] = 1.0 * sh[m]; img[m, 1] = 0.5 * sh[m]; img[m, 2] = 0.05; img[m, 3] = 1
    im = bpy.data.images.new(name, n, n, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    path = os.path.join(TEX, name + '.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return path


def card_mat(name, tex_path):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = bpy.data.images.load(tex_path, check_existing=True)
    nt.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.5
    nt.links.new(tn.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.8
    b.inputs['Specular IOR Level'].default_value = 0.3
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    return m


def bark():
    return mat('Bark', '#5a4636', rough=0.95)


def leaves(name, col):
    return mat(name, col, rough=0.85, spec=0.3)


def blob(name, r, loc, m, sub=2, amp=0.28, freq=1.6, seed=0, squash=1.0):
    o = ico(name, r, loc, m, sub=sub, scale=(1, 1, squash))
    off = Vector((seed * 7.3, seed * 3.1, seed * 5.7))
    for v in o.data.vertices:
        p = v.co - Vector(loc)
        nn = noise.noise(p * freq / max(r, 0.1) + off)
        n2 = noise.noise(p * freq * 2.7 / max(r, 0.1) + off * 2)
        v.co = Vector(loc) + p + p.normalized() * (nn * amp + n2 * amp * 0.45) * r
    o.data.shade_smooth()
    return o


def trunk(name, h, r0, r1, m, bend=(0, 0), segs=6):
    bm = bmesh.new()
    rings = []
    for i in range(segs + 1):
        t = i / segs
        r = r0 + (r1 - r0) * t
        cx = bend[0] * math.sin(t * math.pi * 0.8) * t
        cy = bend[1] * math.sin(t * math.pi * 0.8) * t
        ring = [bm.verts.new((cx + math.cos(a) * r, cy + math.sin(a) * r, t * h)) for a in [k / 8 * math.tau for k in range(8)]]
        rings.append(ring)
    for i in range(segs):
        for k in range(8):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 8], rings[i + 1][(k + 1) % 8], rings[i + 1][k]))
    o = mesh_from_bm(name, bm, [m])
    o.data.shade_smooth()
    return o


def branch(name, a, b, r, m):
    d = Vector(b) - Vector(a)
    o = cyl(name, r, d.length, (0, 0, 0), m, verts=6, r2=r * 0.55)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.location = (Vector(a) + Vector(b)) / 2
    return o


def cards(name, centers, m, count, size, rr, squash=0.85, outward=0.65):
    """樹冠（楕円体の集合）の表層付近に葉カードを散らす。"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    for k in range(count):
        c, rad = centers[rr.randrange(len(centers))]
        d = Vector((rr.gauss(0, 1), rr.gauss(0, 1), rr.gauss(0, 1) * squash)).normalized()
        p = Vector(c) + d * rad * rr.uniform(0.62, 1.05)
        s = size * rr.uniform(0.75, 1.25)
        # カードの向き: 外向き法線とランダムを混ぜる
        nrm = (d * outward + Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-.3, 1)))).normalized()
        t1 = nrm.cross(Vector((0, 0, 1)))
        if t1.length < 0.1:
            t1 = Vector((1, 0, 0))
        t1.normalize()
        t2 = nrm.cross(t1).normalized()
        rot = rr.uniform(0, math.tau)
        t1, t2 = t1 * math.cos(rot) + t2 * math.sin(rot), -t1 * math.sin(rot) + t2 * math.cos(rot)
        q = [p - t1 * s - t2 * s, p + t1 * s - t2 * s, p + t1 * s + t2 * s, p - t1 * s + t2 * s]
        vs = [bm.verts.new(x) for x in q]
        f = bm.faces.new(vs)
        for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[uvl].uv = uv
    o = mesh_from_bm(name, bm, [m])
    # 法線を樹冠の外向きにそろえて陰影を柔らかく（擬似ボリューム）
    o.data.shade_smooth()
    return o


def tree_broad(name, h=8.0, spread=3.4, n=7, seed=1, leaf='leaf_broad', inner='#24391c', count=230, csize=1.15):
    rr = random.Random(seed)
    lm = card_mat('Leaf_' + name, os.path.join(TEX, leaf + '.png'))
    im = leaves('Crown_' + name, inner)
    parts = [trunk('t', h * 0.58, 0.26, 0.13, bark(), bend=(0.3, 0.12))]
    centers = []
    for i in range(4):
        a = i / 4 * math.tau + rr.random()
        tip = (math.cos(a) * spread * 0.6, math.sin(a) * spread * 0.6, h * rr.uniform(0.66, 0.74))
        parts.append(branch('br', (0, 0, h * rr.uniform(0.4, 0.5)), tip, 0.1, bark()))
        for k in range(2):
            b2 = (tip[0] + rr.uniform(-1, 1), tip[1] + rr.uniform(-1, 1), tip[2] + rr.uniform(0.4, 1.0))
            parts.append(branch('tw', tip, b2, 0.045, bark()))
    for i in range(n):
        a = rr.random() * math.tau
        d = rr.uniform(0.15, 0.7) * spread
        z = h * rr.uniform(0.62, 0.84)
        r = rr.uniform(0.42, 0.56) * spread
        c = (math.cos(a) * d, math.sin(a) * d, z)
        centers.append((c, r))
        parts.append(blob('c', r * 0.5, c, im, sub=2, amp=0.2, seed=seed * 10 + i, squash=0.8))
    centers.append(((0, 0, h * 0.86), spread * 0.6))
    parts.append(blob('ctop', spread * 0.32, (0, 0, h * 0.86), im, sub=2, amp=0.2, seed=seed * 10 + 99, squash=0.8))
    wood = join(parts, name, smooth_angle=80)
    cd = cards(name + '_cards', centers, lm, count, csize, rr)
    return join([wood, cd], name, smooth_angle=80)


def tree_pine(name='tree_pine', h=7.0, seed=3):
    rr = random.Random(seed)
    lm = card_mat('Leaf_pine', os.path.join(TEX, 'leaf_pine.png'))
    im = leaves('Crown_pine', '#1f3420')
    pb = mat('PineBark', '#6a4a36', rough=0.95)
    parts = [trunk('t', h * 0.9, 0.22, 0.08, pb, bend=(1.2, 0.4), segs=8)]
    centers = []
    for i in range(6):
        t = 0.45 + i * 0.09
        cx = 1.2 * math.sin(t * math.pi * 0.8) * t
        a = rr.random() * math.tau
        L = (1.0 - t) * 3.2 + 0.6
        tip = (cx + math.cos(a) * L, 0.4 * t + math.sin(a) * L, h * t + 0.2)
        parts.append(branch('br', (cx, 0.4 * t, h * t * 0.9), tip, 0.06, pb))
        rad = 0.9 + (1 - t) * 0.9
        parts.append(blob('pad', rad * 0.55, tip, im, sub=2, amp=0.15, seed=seed * 20 + i, squash=0.3))
        centers.append((tip, rad))
    wood = join(parts, name, smooth_angle=80)
    cd = cards(name + '_cards', centers, lm, 130, 0.85, rr, squash=0.3, outward=0.9)
    return join([wood, cd], name, smooth_angle=80)


def tree_street(name='tree_street'):
    return tree_broad(name, 7.0, 2.4, 6, seed=11, leaf='leaf_broad', inner='#2a4420', count=170, csize=1.0)


def tree_mikan(name='tree_mikan'):
    rr = random.Random(9)
    lm = card_mat('Leaf_mikan', os.path.join(TEX, 'leaf_mikan.png'))
    im = leaves('Crown_mikan', '#233f1d')
    fr = mat('MikanFruit', '#ff8a12', rough=0.45, emit='#ff6a00', estr=0.05)
    parts = [trunk('t', 0.8, 0.09, 0.07, bark()), blob('c', 0.85, (0, 0, 1.45), im, sub=3, amp=0.14, seed=7, squash=0.82)]
    for i in range(22):
        a = rr.random() * math.tau
        z = rr.uniform(-0.6, 0.65)
        rad = math.sqrt(max(0.05, 1 - (z / 0.95) ** 2)) * 1.2
        parts.append(sphere('f', 0.075, (math.cos(a) * rad, math.sin(a) * rad, 1.45 + z * 0.95), fr, seg=8, rings=5))
    wood = join(parts, name, smooth_angle=80)
    cd = cards(name + '_cards', [((0, 0, 1.45), 1.25)], lm, 90, 0.6, rr, squash=0.82)
    return join([wood, cd], name, smooth_angle=80)


def tree_sakura(name='tree_sakura'):
    """ソメイヨシノ（満開。枝が横に広がる傘形）。"""
    return tree_broad(name, 6.2, 4.2, 9, seed=21, leaf='leaf_sakura', inner='#e8a2b8', count=260, csize=1.1)


def tree_far(name='tree_far'):
    lm = leaves('Far', '#34532c')
    parts = [cyl('t', 0.15, 2.0, (0, 0, 1.0), bark(), verts=5),
             blob('c', 2.0, (0, 0, 3.8), lm, sub=1, amp=0.25, seed=4, squash=1.15)]
    return join(parts, name, smooth_angle=None)


def build_trees():
    reset()
    leaf_texture('leaf_broad', 'broad', seed=5)
    leaf_texture('leaf_pine', 'pine', seed=6)
    leaf_texture('leaf_mikan', 'mikan', seed=7)
    leaf_texture('leaf_sakura', 'sakura', seed=8)
    roots = []
    for (n, fn) in (('tree_broad_a', lambda: tree_broad('tree_broad_a', 8.5, 3.6, 8, 1)),
                    ('tree_broad_b', lambda: tree_broad('tree_broad_b', 6.5, 2.8, 6, 2, inner='#2c4622', count=180, csize=1.0)),
                    ('tree_pine', tree_pine), ('tree_street', tree_street), ('tree_mikan', tree_mikan),
                    ('tree_far', tree_far), ('tree_sakura', tree_sakura)):
        o = fn()
        o.name = n
        roots.append(o)
    export_glb(os.path.join(ASSETS, 'glb', 'trees.glb'), roots)
    for i, o in enumerate(roots):
        o.location = (i * 9 - 22, 0, 0)
    preview(os.path.join(PREV, 'trees.png'), target=(0, 0, 3.5), dist=40, elev=12, azim=-75, lens=50, res=(1400, 520), samples=64)


# ======================================================================
# 街具
# ======================================================================
def M_props():
    return dict(
        steel=mat('Steel', '#8f959b', metal=0.8, rough=0.4),
        galv=mat('Galv', '#a7adb2', metal=0.7, rough=0.5),
        conc=mat('PoleConc', '#a9a69e', rough=0.85),
        black=mat('PBlack', '#151617', rough=0.6),
        white=mat('PWhite', '#efefea', rough=0.5),
        yellow=mat('PYellow', '#e8b81c', rough=0.5),
        lamp=mat('LampLight', '#fff8e8', rough=0.3, emit='#fff1d0', estr=4.0),
    )


def street_lamp():
    M = M_props()
    p = [cyl('pole', 0.09, 6.0, (0, 0, 3.0), M['steel'], verts=12, r2=0.065),
         cyl('base', 0.16, 0.5, (0, 0, 0.25), M['steel'], verts=12)]
    # 曲がったアーム（3分割）
    pts = [(0, 0, 6.0), (0.35, 0, 6.35), (1.1, 0, 6.5), (2.0, 0, 6.5)]
    for a, b in zip(pts, pts[1:]):
        p.append(branch('arm', a, b, 0.055, M['steel']))
    p.append(box('head', (0.7, 0.3, 0.14), (2.15, 0, 6.48), M['steel'], bevel=0.04))
    p.append(box('led', (0.6, 0.22, 0.02), (2.15, 0, 6.4), M['lamp']))
    o = join(p, 'lamp', smooth_angle=50)
    return o


def utility_pole():
    M = M_props()
    p = [cyl('pole', 0.17, 10.0, (0, 0, 5.0), M['conc'], verts=12, r2=0.11)]
    p.append(cyl('guard', 0.19, 1.8, (0, 0, 0.9), M['yellow'], verts=12))
    for z in (0.4, 0.95, 1.5):
        p.append(cyl('gb', 0.195, 0.18, (0, 0, z), M['black'], verts=12))
    p.append(box('xarm', (0.08, 2.2, 0.1), (0, 0, 8.6), M['galv']))
    for y in (-0.9, 0, 0.9):
        p.append(cyl('ins', 0.05, 0.16, (0, y, 8.72), M['white'], verts=8))
    p.append(box('xarm2', (0.08, 1.4, 0.1), (0, 0, 7.7), M['galv']))
    p.append(cyl('trans', 0.24, 0.8, (0.32, 0, 6.6), mat('Trans', '#8d9296', metal=0.4, rough=0.5), verts=14))
    p.append(box('tbr', (0.3, 0.1, 0.1), (0.15, 0, 6.6), M['galv']))
    for z in range(2, 9):
        p.append(box('step', (0.25, 0.03, 0.03), (0.12, (z % 2 - 0.5) * 0.3, z * 0.9), M['galv']))
    p.append(box('plate', (0.02, 0.18, 0.5), (0.18, 0, 2.6), M['white']))
    o = join(p, 'pole', smooth_angle=45)
    return o


def signal():
    M = M_props()
    body = mat('SigBody', '#3a3f45', metal=0.4, rough=0.45)
    sg = mat('SigG', '#103a26', rough=0.2, emit='#30ff9a', estr=0.04)
    sy = mat('SigY', '#3a2a08', rough=0.2, emit='#ffc020', estr=0.04)
    sr = mat('SigR', '#3a0a0a', rough=0.2, emit='#ff3020', estr=0.04)
    parts = [cyl('pole', 0.11, 6.0, (0, 0, 3.0), M['galv'], verts=12, r2=0.09),
             branch('arm', (0, 0, 5.6), (4.4, 0, 5.75), 0.07, M['galv'])]
    head = box('head', (1.25, 0.3, 0.42), (4.2, 0, 5.75), body, bevel=0.04)
    parts.append(head)
    lamps = []
    for i, (m, x) in enumerate(((sg, 3.8), (sy, 4.2), (sr, 4.6))):
        for s in (1, -1):
            l = cyl('L' + m.name, 0.13, 0.02, (x, s * 0.16, 5.75), m, verts=18, axis='Y')
            lamps.append(l)
            hood = cyl('hood', 0.16, 0.18, (x, s * 0.25, 5.79), body, verts=14, axis='Y')
            parts.append(hood)
    # 歩行者用信号（縦）
    parts.append(box('ped', (0.3, 0.25, 0.75), (0.25, 0, 3.2), body, bevel=0.03))
    o = join(parts + lamps, 'signal', smooth_angle=45)
    return o


def vending(col, name):
    M = M_props()
    bodym = mat('VM_' + name, col, rough=0.35, coat=0.5)
    panel = mat('VendLight', '#f4f6f8', rough=0.3, emit='#ffffff', estr=0.6)
    glass = mat('VendGlass', '#c8d4dc', rough=0.05, spec=0.8)
    parts = [box('body', (0.8, 1.05, 1.83), (0, 0, 0.915), bodym, bevel=0.02)]
    parts.append(box('win', (0.02, 0.9, 0.9), (0.41, 0, 1.25), panel))
    rr = random.Random(hash(name) % 1000)
    cols = ['#d42020', '#2050c8', '#f0f0f0', '#30a040', '#e8c020', '#202020', '#f08020', '#80c8e8']
    for row, z in enumerate((0.95, 1.25, 1.55)):
        for k in range(7):
            y = -0.39 + k * 0.13
            c = mat('can' + cols[(k + row * 3) % len(cols)], cols[(k + row * 3) % len(cols)], rough=0.3, metal=0.4)
            parts.append(cyl('can', 0.032, 0.12, (0.4, y, z), c, verts=8))
            parts.append(box('btn', (0.02, 0.05, 0.025), (0.42, y, z - 0.1), M['white']))
    parts.append(box('glass', (0.01, 0.92, 0.92), (0.425, 0, 1.25), glass))
    parts.append(box('bay', (0.02, 0.6, 0.18), (0.41, 0, 0.25), M['black']))
    parts.append(box('coin', (0.02, 0.12, 0.3), (0.41, 0.36, 0.75), mat('Coin', '#b0b4b8', metal=0.8, rough=0.3)))
    parts.append(box('topsign', (0.02, 0.92, 0.14), (0.41, 0, 1.76), panel))
    return join(parts, name, smooth_angle=40)


def busstop():
    M = M_props()
    orange = mat('BusSign', '#e8862c', rough=0.4)
    parts = [cyl('pole', 0.04, 2.6, (0, 0, 1.3), M['steel'], verts=10),
             cyl('base', 0.28, 0.12, (0, 0, 0.06), mat('StopBase', '#5a5c5e', rough=0.7), verts=16),
             cyl('sign', 0.3, 0.03, (0, 0, 2.55), orange, verts=24, axis='X'),
             cyl('signw', 0.2, 0.034, (0, 0, 2.55), M['white'], verts=24, axis='X'),
             box('table', (0.04, 0.36, 0.5), (0, 0, 1.55), M['white'], bevel=0.01)]
    # ベンチ
    parts.append(box('seat', (0.4, 1.4, 0.05), (-0.6, 0, 0.44), mat('Bench', '#7a5a3a', rough=0.7)))
    for y in (-0.6, 0.6):
        parts.append(box('leg', (0.05, 0.05, 0.42), (-0.6, y, 0.21), M['steel']))
    return join(parts, 'busstop', smooth_angle=45)


def build_props():
    reset()
    roots = [street_lamp(), utility_pole(), signal(), vending('#d43c3c', 'vending_red'), vending('#2456a8', 'vending_blue'),
             vending('#f0f0f2', 'vending_white'), busstop()]
    export_glb(os.path.join(ASSETS, 'glb', 'props.glb'), roots, uv=False)
    for i, o in enumerate(roots):
        o.location = (i * 3.2 - 9, 0, 0)
    preview(os.path.join(PREV, 'props.png'), target=(0, 0, 3.5), dist=26, elev=10, azim=-60, lens=50, res=(1400, 640), samples=48)


# ======================================================================
# その他（みかん・フェリー・旅客機）
# ======================================================================
def mikan_pickup():
    m = mat('MikanBody', '#ff8812', rough=0.45)
    o = sphere('mk', 0.16, (0, 0, 0), m, seg=24, rings=14, scale=(1, 1, 0.86))
    for v in o.data.vertices:
        v.co += v.co.normalized() * noise.noise(v.co * 60) * 0.004
    st = cyl('stem', 0.015, 0.04, (0, 0, 0.15), mat('Stem', '#4a6a2a'), verts=8)
    lf = box('leaf', (0.12, 0.05, 0.008), (0.05, 0, 0.16), mat('MikanLeaf2', '#3f8a3a', rough=0.6), rot=('Y', -0.35))
    return join([o, st, lf], 'mikan', smooth_angle=70)


def ferry():
    """松山〜広島航路風のフェリー（全長約70m）。"""
    white = mat('HullWhite', '#f2f3f1', rough=0.4)
    navy = mat('HullNavy', '#1d2c4a', rough=0.5)
    stripe = mat('HullStripe', '#e86a1a', rough=0.4)
    win = mat('ShipWin', '#1a2633', rough=0.1, emit='#ffd9a0', estr=0.0)
    deck = mat('Deck', '#7a8a6a', rough=0.8)
    secs = [(-35, 7.0, 0, 5.5), (-28, 7.6, 0, 6.0), (20, 7.6, 0, 6.2), (30, 5.5, 0.5, 6.6), (36, 1.2, 1.5, 7.0)]
    hull = loft_rect('hull', secs, white)
    split_z = 2.2
    me = hull.data
    me.materials.append(navy)
    me.materials.append(stripe)
    bm = bmesh.new(); bm.from_mesh(me)
    for z in (split_z, split_z + 0.6):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if c.z < split_z else (2 if c.z < split_z + 0.6 else 0)
    bm.to_mesh(me); bm.free()
    parts = [hull]
    parts.append(box('deck', (60, 13.8, 0.1), (-3, 0, 6.05), deck))
    for i, (x0, x1, z0, h, w) in enumerate(((-28, 18, 6.1, 3.0, 13), (-24, 12, 9.1, 2.8, 12), (-18, 6, 11.9, 2.6, 10))):
        parts.append(box('sup', (x1 - x0, w, h), ((x0 + x1) / 2, 0, z0 + h / 2), white, bevel=0.15))
        for s in (1, -1):
            parts.append(box('win', (x1 - x0 - 1.5, 0.05, 1.0), ((x0 + x1) / 2, s * (w / 2 + 0.02), z0 + h * 0.55), win))
    parts.append(box('bridge', (4, 12, 2.6), (8, 0, 13.8), white, bevel=0.2))
    parts.append(box('bwin', (0.05, 11, 1.0), (10.02, 0, 14.0), win))
    funnel = cyl('funnel', 1.6, 5, (-12, 0, 16.5), stripe, verts=18, r2=1.3)
    parts.append(funnel)
    parts.append(cyl('ftop', 1.32, 0.6, (-12, 0, 19.2), navy, verts=18))
    parts.append(box('mast', (0.3, 0.3, 6), (10, 0, 18), white))
    return join(parts, 'ferry', smooth_angle=35)


def airliner():
    """双発ナローボディ（全長約37m）。"""
    white = mat('Fuselage', '#f4f5f6', metal=0.15, rough=0.35, coat=0.5)
    blue = mat('Livery', '#1c4aa8', rough=0.35)
    grey = mat('Wing', '#c9cdd1', metal=0.4, rough=0.4)
    win = mat('PlaneWin', '#1a2128', rough=0.1)
    eng = mat('Engine', '#d8dbde', metal=0.5, rough=0.3)
    # 胴体（断面円のロフト）
    bm = bmesh.new()
    rings = []
    prof = [(-18.5, 0.15, 2.6), (-16, 0.9, 2.5), (-12, 1.8, 2.15), (-6, 1.95, 2.0), (10, 1.95, 2.0), (14, 1.75, 1.9),
            (16.5, 1.1, 1.65), (18.3, 0.2, 1.55)]
    for (x, r, zc) in prof:
        rings.append([bm.verts.new((x, math.cos(a) * r, zc + 2.0 + math.sin(a) * r * 1.05)) for a in [k / 16 * math.tau for k in range(16)]])
    for i in range(len(rings) - 1):
        for k in range(16):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 16], rings[i + 1][(k + 1) % 16], rings[i + 1][k]))
    fus = mesh_from_bm('fus', bm, [white])
    fus.data.shade_smooth()
    parts = [fus]
    for s in (1, -1):
        parts.append(box('wins', (24, 0.02, 0.28), (-0.5, s * 1.96, 4.45), win))
        # 主翼（後退角）
        w = prism('wing', [(x, s * y) for x, y in [(2.5, 0), (-1.5, 0), (-6.0, 16.5), (-4.6, 16.5)]], -0.18, 0.18, grey, axis='Z')
        w.location = (0, 0, 2.6)
        parts.append(w)
        parts.append(cyl('eng', 0.85, 3.4, (1.2, s * 5.6, 2.1), eng, verts=18, axis='X'))
        parts.append(cyl('engi', 0.62, 0.05, (2.92, s * 5.6, 2.1), mat('EngIn', '#2a2c2e'), verts=18, axis='X'))
        hs = prism('hstab', [(x, s * y) for x, y in [(-14.5, 0), (-17.5, 0), (-19.5, 6.0), (-18.3, 6.0)]], -0.1, 0.1, white, axis='Z')
        hs.location = (0, 0, 4.4)
        parts.append(hs)
    fin = prism('fin', [(-13.5, 0), (-18.6, 0), (-20.4, 7.0), (-17.6, 7.0)], -0.14, 0.14, blue, axis='Y')
    fin.location = (0, 0, 4.6)
    parts.append(fin)
    parts.append(box('cockpit', (0.8, 1.6, 0.35), (17.0, 0, 4.25), win))
    parts.append(box('stripe', (30, 3.96, 0.2), (-1, 0, 3.55), blue))
    for (x, y) in ((12, 0), (-1.5, 2.6), (-1.5, -2.6)):
        parts.append(cyl('gear', 0.5, 0.35, (x, y, 0.5), mat('Tire', '#161718', rough=0.9), verts=14, axis='Y'))
        parts.append(cyl('strut', 0.08, 1.6, (x, y, 1.3), grey, verts=8))
    return join(parts, 'plane', smooth_angle=35)


def build_misc():
    reset()
    roots = [mikan_pickup(), ferry(), airliner()]
    export_glb(os.path.join(ASSETS, 'glb', 'misc.glb'), roots, uv=False)
    roots[0].location = (0, -14, 1)
    roots[0].scale = (8, 8, 8)
    roots[1].location = (-30, 20, 0)
    roots[2].location = (30, -10, 0)
    preview(os.path.join(PREV, 'misc.png'), target=(0, 0, 4), dist=110, elev=22, azim=-60, lens=50, res=(1400, 700), samples=48)


if __name__ == '__main__':
    what = (argv_after() or ['all'])[0]
    if what in ('trees', 'all'):
        build_trees()
    if what in ('props', 'all'):
        build_props()
    if what in ('misc', 'all'):
        build_misc()
