"""街のこまごまとしたオブジェクト（street.glb）。Googleストリートビューで松山市内を見て拾った街具。
単位m、原点=接地点。看板・機器の「正面」は +X。線状の部材（柵・ガードレール等）は +X 方向へ伸び、車道側が -Y。
実行: Blender -b --factory-startup -P street_props.py
"""
import bpy, bmesh, math, os, sys, random, glob
from mathutils import Vector, Matrix, noise
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

R = random.Random(7)
GOTHIC = None


def fonts():
    global GOTHIC
    g = glob.glob('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc')
    GOTHIC = bpy.data.fonts.load(g[0]) if g else None


def text3d(name, s, size, loc, facing, m, depth=0.004, rot_extra=0.0):
    """facing: 文字の正面が向く方向 '+X','-X','-Y','+Y'"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = s
    cu.font = GOTHIC
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    rz = {'-Y': 0, '+X': math.pi / 2, '+Y': math.pi, '-X': -math.pi / 2}[facing]
    o.rotation_euler = (math.pi / 2, rot_extra, rz)
    o.location = loc
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    t = bpy.data.objects.new(name + '_m', me)
    bpy.context.scene.collection.objects.link(t)
    t.matrix_world = o.matrix_world
    me.materials.append(m)
    bpy.data.objects.remove(o, do_unlink=True)
    return t


def disc(name, r, x, loc, m, verts=32, depth=0.012):
    """+X を向いた円板（標識板）。"""
    return cyl(name, r, depth, (loc[0] + x, loc[1], loc[2]), m, verts=verts, axis='X')


def ring(name, r0, r1, loc, m, verts=40, depth=0.014):
    bm = bmesh.new()
    a0 = [bm.verts.new((0, math.cos(t) * r0, math.sin(t) * r0)) for t in [k / verts * math.tau for k in range(verts)]]
    a1 = [bm.verts.new((0, math.cos(t) * r1, math.sin(t) * r1)) for t in [k / verts * math.tau for k in range(verts)]]
    for i in range(verts):
        j = (i + 1) % verts
        bm.faces.new((a0[i], a0[j], a1[j], a1[i]))
    o = mesh_from_bm(name, bm, [m])
    sol = add_mod(o, 'SOLIDIFY', thickness=depth, offset=0)
    o.location = loc
    return o


def poly_plate(name, pts, x0, x1, loc, m):
    """YZ平面の多角形を X方向[x0,x1]へ押し出した板。pts=[(y,z)...]"""
    o = prism(name, pts, x0, x1, m, axis='X')
    o.location = loc
    return o


def M():
    return dict(
        white=mat('SP_White', '#eeeeea', rough=0.45),
        galv=mat('SP_Galv', '#a9afb4', metal=0.7, rough=0.45),
        steel=mat('SP_Steel', '#7e858b', metal=0.8, rough=0.35),
        stain=mat('SP_Stainless', '#c8ccd0', metal=1.0, rough=0.22),
        grey=mat('SP_Grey', '#8c8f92', rough=0.6),
        dark=mat('SP_Dark', '#2a2c2f', rough=0.6),
        red=mat('SP_SignRed', '#c8201e', rough=0.35),
        blue=mat('SP_SignBlue', '#1452a8', rough=0.35),
        signw=mat('SP_SignWhite', '#f6f6f2', rough=0.35),
        black=mat('SP_Black', '#141516', rough=0.5),
        yellow=mat('SP_Yellow', '#f0c020', rough=0.45),
        orange=mat('SP_Orange', '#e8701c', rough=0.45),
        granite=mat('SP_Granite', '#b8b4ac', rough=0.85),
        soil=mat('SP_Soil', '#4a3a2a', rough=0.95),
        conc=mat('SP_Conc', '#b4b1a8', rough=0.9),
        refl=mat('SP_Reflector', '#d82020', rough=0.2, emit='#ff3020', estr=0.0),
    )


# ======================================================================
# 第1段: 道路端・標識
# ======================================================================
def guard_pipe():
    """横断防止柵（白いガードパイプ）。2m区間、x=0 に支柱。"""
    m = M()
    p = [cyl('post', 0.03, 0.9, (0, 0, 0.45), m['white'], verts=10),
         sphere('cap', 0.034, (0, 0, 0.9), m['white'], seg=10, rings=6)]
    for z in (0.8, 0.45):
        p.append(cyl('rail', 0.024, 2.0, (1.0, 0, z), m['white'], verts=8, axis='X'))
    p.append(box('band', (0.07, 0.07, 0.05), (0, 0, 0.62), m['refl']))
    return join(p, 'guard_pipe', smooth_angle=50)


def guardrail():
    """白いガードレール（W型ビーム）。4m区間。車道側 -Y。"""
    m = M()
    p = [cyl('post', 0.07, 1.0, (0, 0.04, 0.5), m['white'], verts=12),
         box('spacer', (0.1, 0.12, 0.18), (0, -0.05, 0.78), m['white'])]
    # W断面（YZ）を X方向に押し出す
    prof = []
    for i in range(13):
        z = 0.6 + i * 0.35 / 12
        y = -0.12 - 0.045 * (0.5 - 0.5 * math.cos(i / 12 * math.tau * 2))
        prof.append((y, z))
    back = [(y - 0.006, z) for y, z in reversed(prof)]
    beam = prism('beam', prof + back, 0.0, 4.0, m['white'], axis='X')
    p.append(beam)
    p.append(box('refl', (0.02, 0.06, 0.06), (0.0, -0.2, 0.78), m['refl']))
    return join(p, 'guardrail', smooth_angle=60)


def bollard():
    m = M()
    p = [cyl('b', 0.055, 0.85, (0, 0, 0.425), m['stain'], verts=14),
         sphere('cap', 0.056, (0, 0, 0.85), m['stain'], seg=14, rings=6, scale=(1, 1, 0.5))]
    for z in (0.62, 0.72):
        p.append(cyl('band', 0.057, 0.04, (0, 0, z), m['refl'], verts=14))
    p.append(cyl('base', 0.09, 0.02, (0, 0, 0.01), m['steel'], verts=14))
    return join(p, 'bollard', smooth_angle=50)


def end_marker():
    """黄黒の視線誘導標（島の端・分離帯の先端）。"""
    m = M()
    p = [cyl('pole', 0.05, 1.0, (0, 0, 0.5), m['yellow'], verts=12)]
    for z in (0.15, 0.45, 0.75):
        p.append(cyl('blk', 0.052, 0.14, (0, 0, z), m['black'], verts=12))
    p.append(cyl('refl', 0.06, 0.05, (0, 0, 0.95), m['refl'], verts=12))
    return join(p, 'end_marker', smooth_angle=50)


def hedge_mesh(name, sx, sy, sz, loc, m, seed=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
    bmesh.ops.scale(bm, vec=Vector((sx, sy, sz)), verts=bm.verts)
    for v in bm.verts:
        c = v.co
        # 角を丸める
        k = Vector((c.x / (sx / 2), c.y / (sy / 2), max(0, c.z) / (sz / 2)))
        rnd = 1.0 - 0.18 * max(0.0, (abs(k.x) * abs(k.y) + abs(k.y) * abs(k.z) + abs(k.x) * abs(k.z)) - 1.2)
        c.x *= rnd if abs(k.x) < 0.95 else 1.0
        c.y *= rnd
        n = noise.noise(c * 3.1 + Vector((seed * 7.1, 0, 0)))
        if c.z > -sz / 2 + 0.01:
            c += Vector((c.x / sx, c.y / sy, c.z / sz)).normalized() * n * 0.06
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    o = mesh_from_bm(name, bm, [m])
    o.data.shade_smooth()
    return o


def bush(name, x, y, z, r, m, seed):
    o = ico(name, r, (0, 0, 0), m, sub=3, scale=(1.15, 1.0, 0.85))
    for v in o.data.vertices:
        n = noise.noise(v.co * 7.0 + Vector((seed * 3.3, seed, 0)))
        n2 = noise.noise(v.co * 19.0 + Vector((0, seed * 1.7, 0)))
        v.co += v.co.normalized() * (n * 0.07 + n2 * 0.025)
        if v.co.z < -0.25:
            v.co.z = -0.25
    o.data.transform(Matrix.Translation((x, y, z)))
    return o


def hedge_planter():
    """植樹帯（縁石で囲った低木の植え込み）。3m区間。"""
    m = M()
    leaf = mat('SP_Hedge', '#2f5a26', rough=0.85)
    leaf2 = mat('SP_Hedge2', '#3d6c2e', rough=0.85)
    p = []
    for s in (-1, 1):
        p.append(box('curb', (3.0, 0.12, 0.28), (1.5, s * 0.46, 0.14), m['granite'], bevel=0.01))
    p.append(box('end', (0.12, 1.04, 0.28), (0.06, 0, 0.14), m['granite']))
    p.append(box('soil', (2.9, 0.82, 0.05), (1.5, 0, 0.24), m['soil']))
    rr = random.Random(11)
    for i in range(7):
        x = 0.3 + i * 0.4 + rr.uniform(-0.05, 0.05)
        p.append(bush('b%d' % i, x, rr.uniform(-0.08, 0.08), 0.5 + rr.uniform(0, 0.12), 0.36 + rr.uniform(0, 0.08),
                      leaf if i % 3 else leaf2, i))
    return join(p, 'hedge_planter', smooth_angle=55)


def sign_pole(h, m):
    return [cyl('pole', 0.03, h, (0, 0, h / 2), m['galv'], verts=10),
            cyl('pcap', 0.032, 0.02, (0, 0, h + 0.01), m['galv'], verts=10)]


def bracket(z, m):
    return box('brk', (0.05, 0.08, 0.06), (0.03, 0, z), m['galv'])


def sign_stop():
    """一時停止（止まれ・逆三角形）。"""
    m = M()
    p = sign_pole(2.3, m)
    s = 0.8  # 一辺
    h = s * math.sqrt(3) / 2
    zc = 2.05
    tri = [(-s / 2, zc + h / 3), (0, zc - 2 * h / 3), (s / 2, zc + h / 3)]
    tri = [(y, z) for y, z in tri]
    p.append(poly_plate('back', tri, 0.035, 0.05, (0, 0, 0), m['grey']))
    p.append(poly_plate('white', tri, 0.05, 0.056, (0, 0, 0), m['signw']))
    inner = [(y * 0.86, zc + (z - zc) * 0.86) for y, z in tri]
    p.append(poly_plate('red', inner, 0.056, 0.062, (0, 0, 0), m['red']))
    p.append(text3d('t', '止まれ', 0.17, (0.064, 0, zc + 0.05), '+X', m['signw']))
    p += [bracket(1.95, m), bracket(2.2, m)]
    # 補助標識（白板）
    p.append(box('aux', (0.012, 0.45, 0.14), (0.05, 0, 1.55), m['signw']))
    p.append(text3d('ta', '止まれ', 0.08, (0.058, 0, 1.55), '+X', m['black']))
    return join(p, 'sign_stop', smooth_angle=40)


def sign_round(name, kind):
    m = M()
    p = sign_pole(2.45, m)
    zc = 2.15
    r = 0.3
    p.append(disc('back', r, 0.04, (0, 0, zc), m['grey'], depth=0.01))
    if kind == 'speed':
        p.append(disc('w', r, 0.047, (0, 0, zc), m['signw'], depth=0.004))
        p.append(ring('rr', r * 0.72, r * 0.97, (0.05, 0, zc), m['red']))
        p.append(text3d('n', '40', 0.24, (0.052, 0, zc - 0.005), '+X', m['blue']))
    elif kind == 'noparking':
        p.append(disc('b', r, 0.047, (0, 0, zc), m['blue'], depth=0.004))
        p.append(ring('rr', r * 0.8, r * 0.98, (0.05, 0, zc), m['red']))
        bar = box('slash', (0.012, r * 1.62, 0.07), (0.052, 0, zc), m['red'], rot=('X', -math.pi / 4))
        p.append(bar)
    elif kind == 'pedonly':
        p.append(disc('b', r, 0.047, (0, 0, zc), m['blue'], depth=0.004))
        p.append(ring('rw', r * 0.88, r * 0.97, (0.05, 0, zc), m['signw']))
        # 歩行者と自転車（簡略化した人形）
        for dy, sc in ((-0.08, 1.0), (0.09, 0.82)):
            p.append(sphere('hd', 0.03 * sc, (0.054, dy, zc + 0.11 * sc), m['signw'], seg=10, rings=6, scale=(0.3, 1, 1)))
            p.append(box('bd', (0.008, 0.05 * sc, 0.13 * sc), (0.054, dy, zc + 0.01), m['signw']))
            p.append(box('lg', (0.008, 0.03 * sc, 0.1 * sc), (0.054, dy - 0.02, zc - 0.09 * sc), m['signw'], rot=('X', 0.4)))
            p.append(box('lg2', (0.008, 0.03 * sc, 0.1 * sc), (0.054, dy + 0.02, zc - 0.09 * sc), m['signw'], rot=('X', -0.4)))
    p += [bracket(zc - 0.18, m), bracket(zc + 0.18, m)]
    return join(p, name, smooth_angle=40)


def sign_crosswalk():
    """横断歩道（青い正方形・白い三角に人）。両面。"""
    m = M()
    p = sign_pole(2.75, m)
    zc = 2.45
    a = 0.6
    for sx, face in ((1, '+X'), (-1, '-X')):
        p.append(box('blue', (0.006, a, a), (sx * 0.045, 0, zc), m['blue']))
        tri = [(-a * 0.38, zc - a * 0.32), (a * 0.38, zc - a * 0.32), (0, zc + a * 0.36)]
        x0 = sx * 0.049
        p.append(poly_plate('tri', tri if sx > 0 else list(reversed(tri)), min(x0, x0 + sx * 0.004), max(x0, x0 + sx * 0.004), (0, 0, 0), m['signw']))
        xb = sx * 0.055
        p.append(sphere('hd', 0.032, (xb, 0.02, zc + 0.09), m['black'], seg=10, rings=6, scale=(0.3, 1, 1)))
        p.append(box('bd', (0.006, 0.05, 0.14), (xb, 0.02, zc - 0.01), m['black'], rot=('X', 0.15)))
        p.append(box('lg', (0.006, 0.035, 0.12), (xb, -0.02, zc - 0.13), m['black'], rot=('X', 0.55)))
        p.append(box('lg2', (0.006, 0.035, 0.12), (xb, 0.05, zc - 0.13), m['black'], rot=('X', -0.35)))
        # 横断歩道の縞
        for k in range(4):
            p.append(box('st', (0.006, 0.05, 0.03), (xb, -0.12 + k * 0.08, zc - 0.215), m['black']))
    p.append(box('frame', (0.08, 0.06, 0.06), (0, 0, zc), m['galv']))
    return join(p, 'sign_crosswalk', smooth_angle=40)


def curve_mirror():
    """カーブミラー（オレンジの支柱に丸鏡）。正面+X。"""
    m = M()
    mirror = mat('SP_Mirror', '#dfe6ea', metal=1.0, rough=0.04)
    p = [cyl('pole', 0.038, 3.1, (0, 0, 1.55), m['orange'], verts=12),
         cyl('cap', 0.042, 0.03, (0, 0, 3.11), m['orange'], verts=12),
         branch_box(m)]
    zc = 2.75
    p.append(cyl('rim', 0.42, 0.06, (0.16, 0, zc), m['orange'], verts=32, axis='X'))
    mir = sphere('mir', 0.4, (0.2, 0, zc), mirror, seg=28, rings=12, scale=(0.12, 1, 1))
    p.append(mir)
    p.append(box('visor', (0.1, 0.86, 0.04), (0.2, 0, zc + 0.44), m['orange']))
    p.append(box('tag', (0.01, 0.16, 0.24), (0.04, 0, 1.6), m['signw']))
    return join(p, 'curve_mirror', smooth_angle=40)


def branch_box(m):
    return box('arm', (0.16, 0.06, 0.06), (0.08, 0, 2.75), m['orange'])


def guide_gantry():
    """青い方面案内標識（片持ち式）。アームは +X（車道上へ）、案内面の法線は -Y。
    'GuideFace' マテリアルの面は UV 0..1 で、ゲーム側でキャンバスの案内図に差し替える。"""
    m = M()
    p = [cyl('pole', 0.2, 7.6, (0, 0, 3.8), m['galv'], verts=16, r2=0.16),
         cyl('base', 0.32, 0.4, (0, 0, 0.2), m['conc'], verts=16),
         cyl('arm', 0.11, 7.3, (3.65, 0, 7.15), m['galv'], verts=12, axis='X', r2=None),
         cyl('arm2', 0.07, 6.6, (3.6, 0, 6.15), m['galv'], verts=10, axis='X')]
    # 斜材
    for x in (0.8, 2.2):
        p.append(box('brace', (0.06, 0.06, 1.3), (x + 0.3, 0, 6.65), m['galv'], rot=('Y', 0.6)))
    x0, x1, z0, z1 = 2.4, 7.0, 5.0, 7.3
    p.append(box('back', (x1 - x0, 0.08, z1 - z0), ((x0 + x1) / 2, -0.12, (z0 + z1) / 2), m['grey']))
    # 案内面（UV付き）
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((x0, -0.165, z0), (x1, -0.165, z0), (x1, -0.165, z1), (x0, -0.165, z1))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uvl].uv = uv
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    face = mesh_from_bm('guide_face', bm, [mat('GuideFace', '#1452a8', rough=0.4)])
    # 縁（アルミ枠）
    for (cx, cz, sx, sz) in (((x0 + x1) / 2, z0, x1 - x0 + 0.06, 0.06), ((x0 + x1) / 2, z1, x1 - x0 + 0.06, 0.06),
                             (x0, (z0 + z1) / 2, 0.06, z1 - z0), (x1, (z0 + z1) / 2, 0.06, z1 - z0)):
        p.append(box('fr', (sx, 0.1, sz), (cx, -0.13, cz), m['galv']))
    for x in (3.4, 6.0):
        p.append(box('hang', (0.1, 0.1, 0.5), (x, -0.06, 7.25), m['galv']))
    o = join(p, 'guide_gantry', smooth_angle=40)
    face.parent = o
    return o


def tram_stop():
    """路面電車の電停（安全地帯）。12m×1.6m、+Y側が軌道、-Y側に柵、屋根付き。"""
    m = M()
    L, Wd = 12.0, 1.6
    paver = mat('SP_Paver', '#a29a8e', rough=0.85)
    tactile = mat('SP_Tactile', '#e8c22a', rough=0.6)
    roof = mat('SP_Roof', '#d9dcdc', metal=0.3, rough=0.4)
    glass = mat('SP_Glass', '#a6c0cc', rough=0.05, alpha=0.35)
    green = mat('SP_TramGreen', '#2e6b4a', rough=0.45)
    p = [box('deck', (L, Wd, 0.22), (0, 0, 0.11), paver),
         box('tact', (L - 0.4, 0.3, 0.012), (0, Wd / 2 - 0.25, 0.226), tactile)]
    # 端のスロープ（黄黒）
    for sx in (-1, 1):
        nose = prism('nose', [(-Wd / 2, 0), (Wd / 2, 0), (Wd / 2, 0.22), (-Wd / 2, 0.22)], 0, 1.2, m['conc'], axis='X')
        bpy.context.view_layer.update()
        nose = bake(nose)
        for v in nose.data.vertices:
            if v.co.x > 0.6:
                v.co.z = min(v.co.z, 0.02)
            v.co.x = v.co.x * sx + sx * L / 2
        if sx < 0:
            nose.data.flip_normals()
        p.append(nose)
        # 端の黄黒ポール
        for k, z in enumerate((0.35, 0.65, 0.95)):
            p.append(cyl('ep', 0.06, 0.3, (sx * (L / 2 - 0.2), -0.45, z), m['yellow'] if k % 2 == 0 else m['black'], verts=12))
    # 柵（車道側）
    for i in range(13):
        x = -L / 2 + 0.4 + i * (L - 0.8) / 12
        p.append(cyl('fp', 0.025, 1.0, (x, -Wd / 2 + 0.08, 0.72), green, verts=8))
    for z in (1.2, 0.55):
        p.append(cyl('fr', 0.025, L - 0.8, (0, -Wd / 2 + 0.08, z), green, verts=8, axis='X'))
    p.append(box('panel', (L - 0.8, 0.02, 0.5), (0, -Wd / 2 + 0.08, 0.9), glass))
    # 屋根（中央5m）
    for x in (-2.2, 2.2):
        p.append(cyl('rp', 0.05, 2.4, (x, -0.5, 1.42), green, verts=10))
    rf = box('roof', (5.4, 1.5, 0.06), (0, 0, 2.62), roof, bevel=0.02)
    rf.rotation_euler = (math.radians(-6), 0, 0)
    p.append(rf)
    p.append(box('beam', (5.0, 0.08, 0.1), (0, -0.5, 2.56), green))
    # ベンチ・電停名標
    p.append(box('bench', (1.6, 0.36, 0.05), (0, -0.45, 0.66), mat('SP_BenchWood', '#8a6038', rough=0.7)))
    for x in (-0.6, 0.6):
        p.append(box('bl', (0.05, 0.3, 0.42), (x, -0.45, 0.43), m['steel']))
    p.append(box('namepole', (0.06, 0.06, 2.2), (3.2, -0.4, 1.32), green))
    p.append(box('name', (0.9, 0.04, 0.28), (3.2, -0.4, 2.25), mat('NightGlow_Sign', '#f4f4ee', rough=0.3, emit='#fff4dc', estr=0.0)))
    p.append(box('namebar', (0.9, 0.045, 0.06), (3.2, -0.4, 2.36), green))
    return join(p, 'tram_stop', smooth_angle=40)


def build_stage1():
    return [guard_pipe(), guardrail(), bollard(), end_marker(), hedge_planter(), sign_stop(),
            sign_round('sign_speed', 'speed'), sign_round('sign_noparking', 'noparking'),
            sign_round('sign_pedonly', 'pedonly'), sign_crosswalk(), curve_mirror(), guide_gantry(), tram_stop()]


def layout_preview(roots, path, cols=7, gap=2.2, big=()):
    small = [o for o in roots if o.name not in big]
    for i, o in enumerate(small):
        o.location = ((i % cols) * gap - (cols - 1) * gap / 2 - (o.dimensions.x / 2 if o.name in LINEAR else 0), (i // cols) * 2.6, 0)
    for o in roots:
        if o.name in big:
            o.location = (0, 40, 0)
    preview(path, target=(0, 1.3, 1.0), dist=13, elev=16, azim=-70, lens=50, res=(1600, 800), samples=48)


LINEAR = ('guard_pipe', 'guardrail', 'hedge_planter', 'tram_stop')

if __name__ == '__main__':
    reset()
    fonts()
    roots = build_stage1()
    export_glb(os.path.join(ASSETS, 'glb', 'street.glb'), roots)
    layout_preview(roots, os.path.join(PREV, 'street1.png'), big=('guide_gantry', 'tram_stop'))
    for o in roots:
        o.location = (0, 40, 0)
    g = bpy.data.objects['guide_gantry']; g.location = (-6, 0, 0)
    t = bpy.data.objects['tram_stop']; t.location = (2, -4, 0)
    preview(os.path.join(PREV, 'street1b.png'), target=(0, -2, 3), dist=20, elev=14, azim=-110, lens=40, res=(1400, 800), samples=48)
