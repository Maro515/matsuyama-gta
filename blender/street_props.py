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
    cu.extrude = 0.0          # 平面文字（側面を作らず三角形を節約）
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 1
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    rz = {'-Y': 0, '+X': math.pi / 2, '+Y': math.pi, '-X': -math.pi / 2}[facing]
    o.rotation_euler = (math.pi / 2, rot_extra, rz)
    fv = {'-Y': (0, -1, 0), '+X': (1, 0, 0), '+Y': (0, 1, 0), '-X': (-1, 0, 0)}[facing]
    o.location = (loc[0] + fv[0] * depth, loc[1] + fv[1] * depth, loc[2])
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
    p = [cyl('post', 0.03, 0.9, (0, 0, 0.45), m['white'], verts=6),
         cyl('cap', 0.034, 0.03, (0, 0, 0.9), m['white'], verts=6)]
    for z in (0.8, 0.45):
        p.append(cyl('rail', 0.024, 2.0, (1.0, 0, z), m['white'], verts=6, axis='X', cap=False))
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
    o = ico(name, r, (0, 0, 0), m, sub=2, scale=(1.15, 1.0, 0.85))
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
    for i in range(5):
        x = 0.35 + i * 0.57 + rr.uniform(-0.05, 0.05)
        p.append(bush('b%d' % i, x, rr.uniform(-0.08, 0.08), 0.5 + rr.uniform(0, 0.12), 0.42 + rr.uniform(0, 0.08),
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


# ======================================================================
# 第2段: 歩道の街具
# ======================================================================
def post_round():
    """丸ポスト（郵便差出箱1号丸形）。正面+X。"""
    m = M()
    red = mat('SP_PostRed', '#d0281e', rough=0.4, coat=0.3)
    p = [cyl('base', 0.24, 0.12, (0, 0, 0.06), m['dark'], verts=24),
         cyl('body', 0.2, 1.05, (0, 0, 0.64), red, verts=28),
         cyl('brim', 0.25, 0.05, (0, 0, 1.18), red, verts=28),
         sphere('dome', 0.22, (0, 0, 1.2), red, seg=28, rings=10, scale=(1, 1, 0.55))]
    for z in (1.0,):
        p.append(box('slot', (0.03, 0.2, 0.035), (0.195, 0, z), m['black']))
        p.append(box('lip', (0.04, 0.24, 0.02), (0.205, 0, z + 0.035), red))
    p.append(box('plate', (0.012, 0.16, 0.22), (0.2, 0, 0.6), m['signw']))
    p.append(box('door', (0.012, 0.22, 0.3), (0.196, 0, 0.3), red))
    p.append(text3d('t', '〒', 0.12, (0.2, 0, 0.82), '+X', m['signw'], depth=0.004))
    return join(p, 'post_round', smooth_angle=50)


def post_square():
    """角型ポスト（郵便差出箱13号）。正面+X。"""
    m = M()
    red = mat('SP_PostRed', '#d0281e', rough=0.4, coat=0.3)
    p = [box('leg', (0.18, 0.18, 0.5), (0, 0, 0.25), red),
         box('body', (0.42, 0.56, 0.78), (0, 0, 0.9), red, bevel=0.03),
         box('cap', (0.48, 0.62, 0.04), (0, 0, 1.31), red, bevel=0.015)]
    for y in (-0.14, 0.14):
        p.append(box('slot', (0.02, 0.2, 0.03), (0.215, y, 1.14), m['black']))
        p.append(box('hood', (0.06, 0.24, 0.015), (0.22, y, 1.17), red))
        p.append(box('lab', (0.01, 0.2, 0.06), (0.214, y, 1.04), m['signw']))
    p.append(box('plate', (0.01, 0.4, 0.18), (0.214, 0, 0.78), m['signw']))
    p.append(text3d('t', '〒', 0.1, (0.218, 0, 0.92), '+X', m['signw'], depth=0.004))
    return join(p, 'post_square', smooth_angle=40)


def phone_booth():
    """電話ボックス（グレー枠＋ガラス、緑の公衆電話）。扉は+X。"""
    m = M()
    frame = mat('SP_BoothFrame', '#c9ccce', metal=0.4, rough=0.4)
    glass = mat('SP_Glass', '#a6c0cc', rough=0.05, alpha=0.35)
    green = mat('SP_PhoneGreen', '#2f8a4c', rough=0.4)
    w, h = 0.9, 2.25
    p = [box('floor', (w, w, 0.08), (0, 0, 0.04), m['grey']),
         box('roof', (w + 0.06, w + 0.06, 0.16), (0, 0, h), frame, bevel=0.02),
         box('sign', (w + 0.07, w + 0.07, 0.12), (0, 0, h - 0.14), mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0))]
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(box('col', (0.05, 0.05, h), (sx * w / 2, sy * w / 2, h / 2), frame))
    for (cx, cy, sx, sy) in ((0, w / 2, w, 0.012), (0, -w / 2, w, 0.012), (-w / 2, 0, 0.012, w), (w / 2, 0, 0.012, w)):
        p.append(box('gl', (sx, sy, h - 0.35), (cx, cy, 0.12 + (h - 0.35) / 2), glass))
        p.append(box('kick', (sx + 0.01, sy + 0.01, 0.12), (cx, cy, 0.14), frame))
    for f in ('+X', '-X'):
        x = 0.47 if f == '+X' else -0.47
        p.append(text3d('t', '公衆電話', 0.075, (x, 0, h - 0.14), f, m['dark'], depth=0.003))
    p.append(box('phone', (0.18, 0.24, 0.32), (-0.34, 0, 1.2), green, bevel=0.02))
    p.append(box('shelf', (0.3, 0.6, 0.03), (-0.3, 0, 0.98), frame))
    p.append(box('handle', (0.03, 0.03, 0.3), (0.46, -0.3, 1.1), m['steel']))
    return join(p, 'phone_booth', smooth_angle=40)


def wheel(name, x, r, m_tire, m_rim, m_spoke):
    parts = []
    t = bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.02, major_segments=14, minor_segments=3,
                                         location=(x, 0, r + 0.018), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    o.data.materials.append(m_tire)
    parts.append(o)
    parts.append(cyl('rim', r - 0.02, 0.012, (x, 0, r + 0.018), m_rim, verts=12, axis='Y', cap=False))
    for k in range(3):
        a = k / 3 * math.pi
        parts.append(box('sp', (2 * (r - 0.03), 0.003, 0.003), (x, 0, r + 0.018), m_spoke, rot=('Y', a)))
    parts.append(cyl('hub', 0.025, 0.08, (x, 0, r + 0.018), m_spoke, verts=10, axis='Y'))
    return parts


def bicycle(name, col):
    """ママチャリ。前方+X、全長約1.8m。"""
    m = M()
    frame = mat('SP_Bike_' + name, col, metal=0.3, rough=0.35, coat=0.4)
    tire = mat('SP_Tire', '#1a1a1a', rough=0.85)
    chrome = mat('SP_Chrome', '#d5d8dc', metal=1.0, rough=0.15)
    r = 0.33
    fx, rx = 0.56, -0.5
    p = wheel('fw', fx, r, tire, chrome, chrome) + wheel('rw', rx, r, tire, chrome, chrome)
    hz = r + 0.018
    bb = (0.0, 0, 0.3)
    st = (-0.12, 0, 0.82)
    hd = (0.42, 0, 0.88)
    def tube(a, b, rad=0.017, mm=frame):
        a, b = Vector(a), Vector(b)
        d = b - a
        o = cyl('t', rad, d.length, (0, 0, 0), mm, verts=5, cap=False)
        o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        o.location = (a + b) / 2
        return o
    p += [tube(bb, st), tube(bb, (0.45, 0, 0.62)), tube((0.45, 0, 0.62), hd, 0.02),  # 低床フレーム
          tube(bb, (rx, 0.04, hz), 0.012), tube(st, (rx, 0.04, hz), 0.011), tube(bb, (rx, -0.04, hz), 0.012), tube(st, (rx, -0.04, hz), 0.011),
          tube(hd, (fx, 0.04, hz), 0.014, chrome), tube(hd, (fx, -0.04, hz), 0.014, chrome),
          tube(st, (-0.15, 0, 0.95), 0.014, chrome), tube(hd, (0.4, 0, 1.02), 0.014, chrome)]
    p.append(box('saddle', (0.26, 0.15, 0.06), (-0.17, 0, 0.98), m['black'], bevel=0.02))
    p.append(cyl('bar', 0.012, 0.56, (0.38, 0, 1.03), chrome, verts=8, axis='Y'))
    for s in (-1, 1):
        p.append(cyl('grip', 0.017, 0.1, (0.38, s * 0.27, 1.03), m['black'], verts=8, axis='Y'))
    # 前かご
    basket = box('basket', (0.3, 0.36, 0.24), (0.64, 0, 0.92), chrome)
    add_mod(basket, 'WIREFRAME', thickness=0.006, use_replace=True)
    p.append(basket)
    p.append(box('bbot', (0.3, 0.36, 0.006), (0.64, 0, 0.8), chrome))
    # 泥除け・荷台・チェーンケース
    p.append(box('fender_r', (0.55, 0.06, 0.012), (rx + 0.05, 0, hz + r + 0.03), frame))
    p.append(box('rack', (0.4, 0.18, 0.015), (rx + 0.08, 0, hz + r + 0.06), chrome))
    p.append(box('chain', (0.55, 0.012, 0.12), (-0.25, 0.06, 0.32), frame))
    p.append(box('stand', (0.02, 0.4, 0.02), (rx - 0.05, 0, 0.12), chrome))
    p.append(box('lamp', (0.06, 0.06, 0.06), (0.7, 0, 0.6), chrome))
    return join(p, name, smooth_angle=50)


def bike_rack():
    """駐輪ラック（スタンド式）6台分、x方向へ 0.6m間隔。"""
    m = M()
    p = [box('rail', (3.6, 0.05, 0.05), (1.5, 0.35, 0.05), m['galv']),
         box('rail2', (3.6, 0.05, 0.05), (1.5, -0.35, 0.05), m['galv'])]
    for i in range(6):
        x = i * 0.6
        p.append(box('slot', (0.06, 0.75, 0.04), (x, 0, 0.08), m['galv']))
        p.append(box('guide', (0.04, 0.04, 0.3), (x, 0.32, 0.2), m['galv']))
    p.append(box('sign', (0.02, 0.4, 0.3), (-0.3, 0.3, 0.9), m['blue']))
    p.append(cyl('sp', 0.02, 0.8, (-0.3, 0.3, 0.4), m['galv'], verts=8))
    return join(p, 'bike_rack', smooth_angle=40)


def recycle_box():
    """自販機横の空き缶・ペットボトル回収箱（2個）。正面+X。"""
    m = M()
    blue = mat('SP_RecBlue', '#2a64b4', rough=0.4)
    green = mat('SP_RecGreen', '#2f8f4a', rough=0.4)
    p = []
    for y, col in ((-0.24, blue), (0.24, green)):
        p.append(box('b', (0.42, 0.42, 0.9), (0, y, 0.45), col, bevel=0.03))
        p.append(cyl('hole', 0.065, 0.02, (0.205, y, 0.72), m['black'], verts=16, axis='X'))
        p.append(box('lab', (0.01, 0.3, 0.12), (0.212, y, 0.5), m['signw']))
    return join(p, 'recycle_box', smooth_angle=40)


def utility_box():
    """地上機器（配電用の歩道上キャビネット）。正面+X。"""
    m = M()
    body = mat('SP_UtilBox', '#b9b7a8', metal=0.2, rough=0.55)
    p = [box('base', (0.6, 1.3, 0.12), (0, 0, 0.06), m['conc']),
         box('body', (0.5, 1.2, 1.15), (0, 0, 0.7), body, bevel=0.015)]
    for z in (0.4, 0.5, 1.05, 1.15):
        p.append(box('vent', (0.012, 0.9, 0.02), (0.255, 0, z), m['grey']))
    p.append(box('seam', (0.012, 0.01, 1.0), (0.255, 0, 0.7), m['grey']))
    p.append(box('tag', (0.01, 0.2, 0.08), (0.256, 0.35, 0.85), m['yellow']))
    return join(p, 'utility_box', smooth_angle=40)


def hydrant_sign():
    """消火栓標識（赤い板・白文字）。正面+X、両面。"""
    m = M()
    p = sign_pole(2.6, m)
    p.append(box('plate', (0.02, 0.4, 0.62), (0.04, 0, 2.2), m['red']))
    p.append(box('wband', (0.022, 0.38, 0.03), (0.04, 0, 1.96), m['signw']))
    p += vtext('消火栓', 0.13, (0.052, 0, 2.38), '+X', m['signw'])
    p += vtext('消火栓', 0.13, (0.028, 0, 2.38), '-X', m['signw'])
    p.append(box('band', (0.022, 0.4, 0.18), (0.04, 0, 1.78), m['signw']))
    p.append(text3d('ad', '松山市', 0.06, (0.052, 0, 1.78), '+X', m['dark'], depth=0.003))
    return join(p, 'hydrant_sign', smooth_angle=40)


def vtext(s, size, loc, facing, mm):
    return [text3d('v', ch, size, (loc[0], loc[1], loc[2] - i * size * 1.08), facing, mm, depth=0.003) for i, ch in enumerate(s)]


def bench():
    """公園・歩道のベンチ（木の座板＋鋳物脚）。座る向き+X。"""
    m = M()
    wood = mat('SP_BenchWood', '#8a6038', rough=0.7)
    iron = mat('SP_Iron', '#2c2e2f', metal=0.6, rough=0.5)
    p = []
    for k in range(4):
        p.append(box('seat', (0.09, 1.7, 0.035), (0.12 - k * 0.11, 0, 0.44), wood, bevel=0.008))
    for k in range(3):
        p.append(box('back', (0.03, 1.7, 0.09), (-0.24 - k * 0.025, 0, 0.58 + k * 0.12), wood, bevel=0.008))
    for y in (-0.72, 0.72):
        p.append(prism('leg', [(0.22, 0), (0.17, 0), (0.0, 0.42), (-0.26, 0.42), (-0.34, 0.0), (-0.28, 0.0), (-0.2, 0.4), (-0.32, 0.86), (-0.28, 0.86), (-0.12, 0.42), (0.1, 0.42)],
                       y - 0.025, y + 0.025, iron))
    return join(p, 'bench', smooth_angle=40)


def map_board():
    """観光案内板（瓦屋根付きの掲示板）。正面+X。"""
    m = M()
    wood = mat('SP_DarkWood', '#4a3424', rough=0.7)
    kawara = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = []
    for y in (-0.95, 0.95):
        p.append(box('post', (0.12, 0.12, 2.3), (0, y, 1.15), wood))
    p.append(box('board', (0.06, 1.8, 1.1), (0, 0, 1.35), wood))
    # 地図面（色分けした街区）
    face = mat('SP_MapBase', '#e9e2cc', rough=0.6)
    p.append(box('face', (0.012, 1.66, 0.96), (0.035, 0, 1.35), face))
    rr = random.Random(3)
    cols = [mat('SP_MapG', '#8fbf7a'), mat('SP_MapB', '#7fb2d8'), mat('SP_MapY', '#e8cf7a'), mat('SP_MapR', '#d9786a'), mat('SP_MapW', '#ffffff')]
    for i in range(26):
        c = cols[rr.randrange(len(cols))]
        sy, sz = rr.uniform(0.08, 0.32), rr.uniform(0.06, 0.22)
        p.append(box('blk', (0.006, sy, sz), (0.043, rr.uniform(-0.7, 0.7), 1.35 + rr.uniform(-0.38, 0.33)), c))
    p.append(box('title', (0.006, 1.66, 0.12), (0.043, 0, 1.76), wood))
    p.append(text3d('tt', '松山市 観光案内図', 0.08, (0.047, 0, 1.76), '+X', m['signw'], depth=0.003))
    p.append(prism('roof', [(-0.5, 2.3), (0.5, 2.3), (0, 2.55)], -1.15, 1.15, kawara, axis='Y'))
    p.append(prism('roof2', [(-0.45, 2.25), (0.45, 2.25), (0.45, 2.3), (-0.45, 2.3)], -1.12, 1.12, wood, axis='Y'))
    return join(p, 'map_board', smooth_angle=30)


def planter_box():
    """商店街のコンクリートプランター（季節の花）。"""
    m = M()
    p = [box('box', (1.2, 0.5, 0.45), (0, 0, 0.225), m['granite'], bevel=0.02),
         box('soil', (1.12, 0.42, 0.04), (0, 0, 0.44), m['soil'])]
    rr = random.Random(9)
    leaf = mat('SP_Leaf', '#3b7a33', rough=0.8)
    fl = [mat('SP_FlR', '#e2384a', rough=0.6), mat('SP_FlY', '#f2c43a', rough=0.6), mat('SP_FlP', '#d65aa6', rough=0.6), mat('SP_FlW', '#f4f2ee', rough=0.6)]
    for i in range(9):
        x, y = -0.45 + i * 0.11 + rr.uniform(-0.03, 0.03), rr.uniform(-0.12, 0.12)
        p.append(ico('lf', 0.12, (x, y, 0.52), leaf, sub=1, scale=(1, 1, 0.7)))
    for i in range(16):
        x, y = rr.uniform(-0.5, 0.5), rr.uniform(-0.16, 0.16)
        p.append(ico('fl', 0.04, (x, y, 0.6 + rr.uniform(0, 0.06)), fl[i % 4], sub=1))
    return join(p, 'planter_box', smooth_angle=60)


def parking_sign():
    """コインパーキングの看板（Pマーク・黄色）と精算機。"""
    m = M()
    yel = mat('SP_ParkYellow', '#f2c22a', rough=0.4)
    p = [cyl('pole', 0.06, 3.6, (0, 0, 1.8), m['galv'], verts=12),
         box('board', (0.12, 1.0, 1.2), (0, 0, 3.4), yel, bevel=0.02),
         box('blue', (0.124, 0.8, 0.78), (0, 0, 3.52), m['blue']),
         box('lit', (0.126, 0.92, 0.26), (0, 0, 2.95), mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0))]
    for f, x in (('+X', 0.065), ('-X', -0.065)):
        p.append(text3d('P', 'P', 0.62, (x, 0, 3.5), f, m['signw'], depth=0.005))
        p.append(text3d('t', '24H 駐車場', 0.12, (x, 0, 2.95), f, m['dark'], depth=0.004))
    # 精算機
    p.append(box('mach', (0.4, 0.45, 1.3), (0.9, 0, 0.65), mat('SP_MachGrey', '#d4d6d8', rough=0.4), bevel=0.02))
    p.append(box('mhood', (0.5, 0.55, 0.06), (0.9, 0, 1.33), yel))
    p.append(box('mscr', (0.01, 0.3, 0.2), (1.105, 0, 1.0), mat('SP_Screen', '#1a2a3a', rough=0.1, emit='#4a8acc', estr=0.3)))
    return join(p, 'parking_sign', smooth_angle=40)


def car_stop():
    """駐車場の車止めブロック。"""
    m = M()
    return join([box('cs', (0.15, 1.2, 0.12), (0, 0, 0.06), m['conc'], bevel=0.02),
                 box('y', (0.152, 0.3, 0.122), (0, 0.3, 0.06), m['yellow']), box('y2', (0.152, 0.3, 0.122), (0, -0.3, 0.06), m['yellow'])],
                'car_stop', smooth_angle=40)


def clock_pole():
    """駅前広場の時計塔（丸時計）。"""
    m = M()
    face = mat('NightGlow_Clock', '#f6f4ec', rough=0.3, emit='#fff8e8', estr=0.0)
    p = [cyl('pole', 0.09, 4.0, (0, 0, 2.0), m['steel'], verts=14),
         cyl('base', 0.22, 0.3, (0, 0, 0.15), m['granite'], verts=14),
         cyl('case', 0.42, 0.18, (0, 0, 4.3), m['steel'], verts=32, axis='X'),
         cyl('face', 0.37, 0.19, (0, 0, 4.3), face, verts=32, axis='X')]
    for f in (1, -1):
        for k in range(12):
            a = k / 12 * math.tau
            p.append(box('tick', (0.004, 0.02, 0.05), (f * 0.097, math.cos(a) * 0.31, 4.3 + math.sin(a) * 0.31), m['black'], rot=('X', a)))
        p.append(box('hh', (0.004, 0.02, 0.2), (f * 0.098, 0.05, 4.36), m['black'], rot=('X', -0.5)))
        p.append(box('mh', (0.004, 0.014, 0.3), (f * 0.099, -0.08, 4.39), m['black'], rot=('X', 0.9)))
    p.append(sphere('top', 0.1, (0, 0, 4.55), m['steel'], seg=12, rings=6))
    return join(p, 'clock_pole', smooth_angle=40)


def build_stage2():
    return [post_round(), post_square(), phone_booth(), bicycle('bicycle_a', '#c8c9cc'), bicycle('bicycle_b', '#2a4f8e'),
            bicycle('bicycle_c', '#8a2a2a'), bike_rack(), recycle_box(), utility_box(), hydrant_sign(), bench(), map_board(),
            planter_box(), parking_sign(), car_stop(), clock_pole()]



# ======================================================================
# 第3段: 地区ごとの街具（道後・商店・住宅地・港）
# ======================================================================
def awning(name, c1, c2):
    """店先の日除けテント（幅3m・出1.2m）。壁面が x=0、+X が道路側。"""
    a = mat('SP_Awn_' + name, c1, rough=0.7)
    b = mat('SP_Awn2_' + name, c2, rough=0.7) if c2 else a
    m = M()
    p = []
    W, D, z0, z1 = 3.0, 1.2, 2.95, 2.45
    n = 10
    for i in range(n):
        y0 = -W / 2 + i * W / n
        mm = a if i % 2 == 0 else b
        bm = bmesh.new()
        v = [bm.verts.new(q) for q in ((0, y0, z0), (D, y0, z1), (D, y0 + W / n, z1), (0, y0 + W / n, z0))]
        bm.faces.new(v)
        o = mesh_from_bm('s', bm, [mm])
        add_mod(o, 'SOLIDIFY', thickness=0.015)
        p.append(o)
        p.append(box('val', (0.012, W / n, 0.28), (D + 0.006, y0 + W / n / 2, z1 - 0.14), mm))
    for s in (-1, 1):
        p.append(prism('side', [(0, z0), (D, z1), (D, z1 - 0.28), (0, z1 - 0.1)], s * W / 2 - 0.006, s * W / 2 + 0.006, a, axis='Y'))
    p.append(cyl('bar', 0.02, W, (D, 0, z1 - 0.02), m['steel'], verts=8, axis='Y'))
    return join(p, name, smooth_angle=30)


def stand_sign():
    """店先のA型スタンド看板。"""
    m = M()
    fr = mat('SP_StandFrame', '#2a2c2e', rough=0.5)
    board = mat('SP_Chalk', '#1e3a2c', rough=0.8)
    p = []
    for s in (-1, 1):
        pl = box('b', (0.03, 0.55, 0.8), (s * 0.13, 0, 0.45), fr)
        pl.rotation_euler = (0, s * -0.17, 0)
        p.append(pl)
        q = box('c', (0.032, 0.47, 0.6), (s * 0.135, 0, 0.47), board)
        q.rotation_euler = (0, s * -0.17, 0)
        p.append(q)
    p.append(text3d('t', 'OPEN', 0.1, (0.17, 0, 0.62), '+X', m['signw'], depth=0.003, rot_extra=0.0))
    p.append(text3d('t2', 'ランチ', 0.08, (0.19, 0, 0.45), '+X', mat('SP_ChalkY', '#f2d24a'), depth=0.003))
    return join(p, 'stand_sign', smooth_angle=30)


def noren():
    """暖簾（藍染・白抜き文字）。壁面 x=0、入口の上に掛ける。"""
    m = M()
    ai = mat('SP_Noren', '#1f2f55', rough=0.85)
    p = [cyl('rod', 0.02, 1.9, (0.12, 0, 2.3), mat('SP_Bamboo', '#b49a5a', rough=0.6), verts=8, axis='Y')]
    for i in range(3):
        y = -0.6 + i * 0.6
        o = box('n', (0.012, 0.57, 0.9), (0.12, y, 1.84), ai)
        p.append(o)
    for i, ch in enumerate('営業中'):
        p.append(text3d('t', ch, 0.16, (0.128, -0.6 + i * 0.6, 1.7), '+X', m['signw'], depth=0.003))
    return join(p, 'noren', smooth_angle=30)


def chochin():
    """赤い提灯（直径40cm）。原点は吊り下げ点。"""
    red = mat('NightGlow_Red', '#c8301e', rough=0.6, emit='#ff6a3a', estr=0.0)
    blk = mat('SP_Black', '#141516', rough=0.5)
    p = [sphere('body', 0.2, (0, 0, -0.36), red, seg=14, rings=10, scale=(1, 1, 1.35)),
         cyl('top', 0.12, 0.06, (0, 0, -0.06), blk, verts=12),
         cyl('bot', 0.12, 0.06, (0, 0, -0.66), blk, verts=12),
         cyl('cord', 0.006, 0.05, (0, 0, -0.01), blk, verts=6)]
    return join(p, 'chochin', smooth_angle=60)


def nobori(name, col, txt, tcol='#ffffff'):
    """のぼり旗（幅45cm×高さ1.8m）。旗面の法線 ±X。"""
    m = M()
    cloth = mat('SP_Nobori_' + name, col, rough=0.8)
    tm = mat('SP_NoboriT_' + name, tcol, rough=0.8)
    p = [cyl('pole', 0.014, 2.6, (0, 0, 1.3), m['white'], verts=8),
         cyl('base', 0.16, 0.18, (0, 0, 0.09), mat('SP_WaterBase', '#3a5a9a', rough=0.5), verts=14),
         cyl('top', 0.01, 0.48, (0, 0.24, 2.55), m['white'], verts=6, axis='Y'),
         box('flag', (0.006, 0.46, 1.8), (0, 0.25, 1.62), cloth)]
    sz = 0.34 if len(txt) <= 4 else 0.27
    for f, x in (('+X', 0.006), ('-X', -0.006)):
        p += [text3d('t', ch, sz, (x, 0.25, 2.3 - i * sz * 1.12), f, tm, depth=0.002) for i, ch in enumerate(txt)]
    return join(p, name, smooth_angle=30)


def iron_fence():
    """道後駅前の黒い鋳鉄柵（飾り付き）2m区間。"""
    iron = mat('SP_IronFence', '#1c1e20', metal=0.5, rough=0.5)
    gold = mat('SP_FenceGold', '#b8933a', metal=0.9, rough=0.35)
    p = [box('post', (0.07, 0.07, 1.0), (0, 0, 0.5), iron), sphere('fin', 0.05, (0, 0, 1.04), gold, seg=10, rings=6)]
    for z in (0.12, 0.85):
        p.append(box('rail', (2.0, 0.03, 0.035), (1.0, 0, z), iron))
    for i in range(1, 16):
        x = i * 2.0 / 16
        p.append(box('bar', (0.014, 0.014, 0.73), (x, 0, 0.485), iron))
        if i % 2:
            p.append(cyl('sp', 0.022, 0.07, (x, 0, 0.9), iron, verts=4, r2=0.0))
    for k in range(4):
        x = 0.25 + k * 0.5
        bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.011, major_segments=12, minor_segments=3,
                                         location=(x, 0, 0.48), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object
        o.data.materials.append(iron)
        p.append(o)
    return join(p, 'iron_fence', smooth_angle=50)


def stone_lantern():
    """石灯籠（春日型）。"""
    st = mat('SP_Stone', '#9c988e', rough=0.9)
    p = [cyl('base', 0.42, 0.25, (0, 0, 0.125), st, verts=6),
         cyl('shaft', 0.14, 1.0, (0, 0, 0.75), st, verts=12),
         cyl('mid', 0.36, 0.2, (0, 0, 1.35), st, verts=6),
         box('fire', (0.5, 0.5, 0.42), (0, 0, 1.66), st),
         cyl('roof', 0.62, 0.3, (0, 0, 2.02), st, verts=6, r2=0.2),
         sphere('jewel', 0.12, (0, 0, 2.27), st, seg=10, rings=6, scale=(1, 1, 1.3))]
    win = mat('NightGlow_Warm', '#3a3226', rough=0.3, emit='#ffcf8a', estr=0.0)
    for s in (1, -1):
        p.append(box('w', (0.02, 0.24, 0.24), (s * 0.255, 0, 1.66), win))
        p.append(box('w2', (0.24, 0.02, 0.24), (0, s * 0.255, 1.66), win))
    return join(p, 'stone_lantern', smooth_angle=30)


def karakuri_clock():
    """坊っちゃんカラクリ時計（道後温泉駅前・放生園）。高さ約7.5m。"""
    m = M()
    white = mat('SP_KClockWhite', '#efe8d8', rough=0.6)
    copper = mat('SP_KClockCopper', '#5a8f7a', metal=0.5, rough=0.45)
    brick = mat('SP_KBrick', '#8a4a32', rough=0.85)
    gold = mat('SP_FenceGold', '#b8933a', metal=0.9, rough=0.35)
    face = mat('NightGlow_Clock', '#f6f4ec', rough=0.3, emit='#fff8e8', estr=0.0)
    p = [cyl('plinth', 1.7, 0.6, (0, 0, 0.3), brick, verts=8),
         cyl('stage', 1.3, 2.2, (0, 0, 1.7), white, verts=8),
         cyl('band', 1.38, 0.18, (0, 0, 2.85), copper, verts=8),
         cyl('mid', 1.0, 2.0, (0, 0, 3.95), white, verts=8),
         cyl('band2', 1.1, 0.18, (0, 0, 5.0), copper, verts=8),
         cyl('clock', 0.85, 1.2, (0, 0, 5.7), white, verts=8),
         cyl('roof', 1.05, 1.2, (0, 0, 6.85), copper, verts=8, r2=0.15),
         sphere('ball', 0.16, (0, 0, 7.55), gold, seg=10, rings=6),
         cyl('spire', 0.03, 0.5, (0, 0, 7.85), gold, verts=6)]
    for k in range(4):
        a = k * math.pi / 2
        cx, cy = math.cos(a) * 0.86, math.sin(a) * 0.86
        c = cyl('face', 0.36, 0.05, (0, 0, 0), face, verts=24, axis='X')
        c.rotation_euler = (0, 0, a); c.location = (cx, cy, 5.7)
        p.append(c)
        r = cyl('rim', 0.4, 0.04, (0, 0, 0), gold, verts=24, axis='X')
        r.rotation_euler = (0, 0, a); r.location = (math.cos(a) * 0.84, math.sin(a) * 0.84, 5.7)
        p.append(r)
        hand = box('h', (0.01, 0.03, 0.26), (0, 0, 0), m['black'], rot=('X', 0.9))
        hand.rotation_euler = (0, 0, a); hand.location = (math.cos(a) * 0.89, math.sin(a) * 0.89, 5.75)
        p.append(hand)
        # 舞台の窓（からくり人形が出る扉）
        w = box('door', (0.06, 0.8, 1.2), (0, 0, 0), mat('SP_KDoor', '#6a2a22', rough=0.5))
        w.rotation_euler = (0, 0, a); w.location = (math.cos(a) * 1.22, math.sin(a) * 1.22, 1.9)
        p.append(w)
        win = box('win', (0.05, 0.5, 0.8), (0, 0, 0), mat('NightGlow_Warm', '#3a3226', rough=0.3, emit='#ffcf8a', estr=0.0))
        win.rotation_euler = (0, 0, a + math.pi / 4); win.location = (math.cos(a + math.pi / 4) * 0.94, math.sin(a + math.pi / 4) * 0.94, 3.95)
        p.append(win)
    return join(p, 'karakuri_clock', smooth_angle=30)


def uv_box(o, su, sv):
    """箱投影UV（側面: u=水平/su, v=z/sv）。"""
    me = o.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uv.data[li].uv = (v.x / su, v.y / sv)
            elif abs(n.x) > abs(n.y):
                uv.data[li].uv = (v.y / su, v.z / sv)
            else:
                uv.data[li].uv = (v.x / su, v.z / sv)


def block_wall():
    """住宅のコンクリートブロック塀（2m区間・高さ1.2m）。目地は 'SP_BlockTex'（ゲーム側でブロック柄に差し替え）。"""
    blk = mat('SP_BlockTex', '#b9b6ad', rough=0.9)
    cap = mat('SP_BlockCap', '#a9a69e', rough=0.85)
    hole = mat('SP_BlockHole', '#5a5852', rough=0.95)
    w = box('wall', (2.0, 0.15, 1.2), (1.0, 0, 0.6), blk)
    uv_box(w, 0.8, 0.4)
    p = [w, box('cap', (2.0, 0.19, 0.06), (1.0, 0, 1.23), cap), box('foot', (2.0, 0.25, 0.12), (1.0, 0, 0.06), cap)]
    for x in (0.6, 1.4):
        for s in (-1, 1):
            p.append(box('hole', (0.34, 0.006, 0.14), (x, s * 0.076, 0.9), hole))
    return join(p, 'block_wall', smooth_angle=30)


def propane():
    """LPガスボンベ2本（住宅の外壁ぎわ）。"""
    m = M()
    g = mat('SP_LPG', '#c9ccd0', metal=0.4, rough=0.45)
    p = []
    for y in (-0.22, 0.22):
        p += [cyl('c', 0.18, 1.1, (0, y, 0.6), g, verts=16), sphere('d', 0.18, (0, y, 1.15), g, seg=16, rings=6, scale=(1, 1, 0.5)),
              cyl('cap', 0.09, 0.2, (0, y, 1.3), g, verts=10), cyl('ft', 0.17, 0.05, (0, y, 0.025), m['dark'], verts=14)]
    p.append(box('chain', (0.02, 0.8, 0.02), (0.18, 0, 0.95), m['steel']))
    p.append(box('reg', (0.12, 0.3, 0.14), (-0.05, 0, 1.5), m['grey']))
    return join(p, 'propane', smooth_angle=40)


def ac_unit():
    """エアコン室外機。正面(ファン)+X。"""
    m = M()
    body = mat('SP_ACBody', '#e6e4dc', rough=0.5)
    p = [box('b', (0.3, 0.8, 0.6), (0, 0, 0.36), body, bevel=0.01),
         cyl('fan', 0.22, 0.02, (0.152, -0.1, 0.36), m['dark'], verts=20, axis='X'),
         box('grill', (0.01, 0.2, 0.5), (0.152, 0.28, 0.36), m['grey'])]
    for z in (0.2, 0.36, 0.52):
        p.append(box('fg', (0.01, 0.46, 0.012), (0.163, -0.1, z), body))
    for y in (-0.3, 0.3):
        p.append(box('leg', (0.34, 0.05, 0.06), (0, y, 0.03), m['dark']))
    p.append(cyl('pipe', 0.02, 0.5, (-0.1, 0.36, 0.7), m['white'], verts=6))
    return join(p, 'ac_unit', smooth_angle=40)


def gomi_station():
    """ごみステーション（緑の折りたたみ収集庫＋ネット）。正面+X。"""
    m = M()
    green = mat('SP_GomiGreen', '#3d7a4a', rough=0.5)
    net = mat('SP_GomiNet', '#2f6a8a', rough=0.8)
    bag = mat('SP_GomiBag', '#e8eae6', rough=0.4, alpha=1.0)
    p = [box('base', (1.0, 1.8, 0.04), (0, 0, 0.02), m['conc'])]
    frame = box('frame', (0.9, 1.6, 1.0), (0, 0, 0.52), green)
    add_mod(frame, 'WIREFRAME', thickness=0.03, use_replace=True)
    p.append(frame)
    for s in (-1, 1):
        p.append(box('side', (0.88, 0.01, 0.95), (0, s * 0.79, 0.5), net))
    p.append(box('back', (0.01, 1.56, 0.95), (-0.44, 0, 0.5), net))
    p.append(box('lid', (0.92, 1.62, 0.02), (0, 0, 1.03), green))
    rr = random.Random(4)
    for i in range(5):
        p.append(ico('bag', 0.22, (rr.uniform(-0.25, 0.25), rr.uniform(-0.6, 0.6), 0.25), bag, sub=1, scale=(1, 1, 1.1)))
    p.append(box('plate', (0.01, 0.4, 0.25), (0.45, 0, 0.8), m['signw']))
    return join(p, 'gomi_station', smooth_angle=40)


def container(name, col):
    """20フィート海上コンテナ（6.06×2.44×2.59m）。長手+X。"""
    c = mat('SP_Cont_' + name, col, metal=0.3, rough=0.55)
    m = M()
    L, W, H = 6.06, 2.44, 2.59
    p = [box('body', (L, W - 0.08, H - 0.1), (0, 0, H / 2), c)]
    for i in range(23):
        x = -L / 2 + 0.15 + i * (L - 0.3) / 22
        for s in (-1, 1):
            p.append(box('rib', (0.1, 0.05, H - 0.3), (x, s * (W / 2 - 0.03), H / 2), c))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (0.08, H - 0.08):
                p.append(box('cast', (0.18, 0.16, 0.16), (sx * (L / 2 - 0.09), sy * (W / 2 - 0.08), z), m['dark']))
        for sy in (-1, 1):
            p.append(box('cpost', (0.1, 0.1, H), (sx * (L / 2 - 0.05), sy * (W / 2 - 0.05), H / 2), c))
    for z in (0.05, H - 0.05):
        for s in (-1, 1):
            p.append(box('rail', (L, 0.1, 0.12), (0, s * (W / 2 - 0.05), z), c))
    for y in (-0.6, 0.6):
        p.append(box('door', (0.04, 1.14, H - 0.3), (L / 2 + 0.02, y, H / 2), c))
        for yy in (y - 0.3, y + 0.3):
            p.append(cyl('bar', 0.02, H - 0.4, (L / 2 + 0.06, yy, H / 2), m['steel'], verts=6))
    return join(p, name, smooth_angle=30)


def mooring_bollard():
    """岸壁の係船柱（ビット）。"""
    iron = mat('SP_Bitt', '#262829', metal=0.5, rough=0.6)
    yel = mat('SP_BittEdge', '#d9b62a', rough=0.5)
    p = [cyl('base', 0.3, 0.1, (0, 0, 0.05), iron, verts=16), cyl('post', 0.18, 0.55, (0, 0, 0.35), iron, verts=16),
         cyl('head', 0.28, 0.1, (0, 0, 0.65), iron, verts=16), box('edge', (0.6, 3.0, 0.02), (0.6, 0, 0.01), yel)]
    return join(p, 'mooring_bollard', smooth_angle=40)


def potted_plant():
    """玄関先の植木鉢（2鉢）。"""
    pot = mat('SP_Pot', '#9a5a3a', rough=0.7)
    leaf = mat('SP_Leaf', '#3b7a33', rough=0.8)
    p = []
    for (x, y, r, h) in ((0, -0.2, 0.18, 0.3), (0.05, 0.22, 0.14, 0.24)):
        p.append(cyl('pot', r, h, (x, y, h / 2), pot, verts=14, r2=r * 0.75))
        p.append(ico('lf', r * 1.5, (x, y, h + r * 1.1), leaf, sub=2, scale=(1, 1, 1.2)))
    return join(p, 'potted_plant', smooth_angle=60)


def build_stage3():
    return [awning('awning_red', '#c8322a', '#f2efe6'), awning('awning_green', '#2f7a46', '#f2efe6'),
            awning('awning_blue', '#2a4f8e', '#f2efe6'), awning('awning_orange', '#e07a20', None),
            stand_sign(), noren(), chochin(),
            nobori('nobori_a', '#e8701c', 'みかん'), nobori('nobori_b', '#2a8a4a', '坊っちゃん団子'),
            nobori('nobori_c', '#c8201e', '道後温泉'), nobori('nobori_d', '#1f3f8e', 'じゃこ天'),
            nobori('nobori_e', '#f2d22a', '大売出し', '#c8201e'),
            iron_fence(), stone_lantern(), karakuri_clock(), block_wall(), propane(), ac_unit(), gomi_station(),
            container('container_a', '#b8402e'), container('container_b', '#2a5a8a'), container('container_c', '#3a7a4a'),
            container('container_d', '#c8a03a'), mooring_bollard(), potted_plant()]



# ======================================================================
# 第5段: 踏切・架線柱・公園遊具・屋根の太陽光/アンテナ・ガソリンスタンド・工事・漁船・バス待合所
# ======================================================================
def stripes(name, r, h, z0, m1, m2, n=8, verts=12):
    return [cyl(name, r, h / n, (0, 0, z0 + (i + 0.5) * h / n), m1 if i % 2 == 0 else m2, verts=verts) for i in range(n)]


def crossing_post():
    """踏切警報機（クロスマーク・赤色灯2灯・遮断機の箱）。正面(+X)を道路の進入側へ。遮断桿は別ノード crossing_arm。"""
    m = M()
    p = stripes('pole', 0.07, 2.2, 0, m['yellow'], m['black'], n=8) + [cyl('pole2', 0.06, 1.6, (0, 0, 3.0), m['galv'], verts=10)]
    # クロスマーク（×）
    for a in (0.6, -0.6):
        b = box('x', (0.02, 0.9, 0.16), (0.08, 0, 3.55), m['yellow'], rot=('X', a))
        p.append(b)
        for k in (-0.3, 0.0, 0.3):
            p.append(box('xs', (0.022, 0.12, 0.165), (0.081, k * math.cos(a), 3.55 + k * math.sin(a)), m['black'], rot=('X', a)))
    # 赤色灯（左右）と庇
    lampL = mat('XingL', '#3a0a0a', rough=0.2, emit='#ff2a1a', estr=0.05)
    lampR = mat('XingR', '#3a0a0a', rough=0.2, emit='#ff2a1a', estr=0.05)
    p.append(box('bar', (0.06, 0.9, 0.08), (0.05, 0, 3.0), m['black']))
    for y, lm in ((-0.36, lampL), (0.36, lampR)):
        p.append(cyl('lamp', 0.13, 0.04, (0.12, y, 3.0), lm, verts=18, axis='X'))
        p.append(cyl('hood', 0.15, 0.14, (0.16, y, 3.05), m['black'], verts=14, axis='X', cap=False))
        p.append(cyl('back', 0.15, 0.1, (0.05, y, 3.0), m['black'], verts=14, axis='X'))
    p.append(box('sign', (0.02, 0.5, 0.22), (0.08, 0, 2.55), m['black']))
    p.append(text3d('t', 'ふみきり', 0.09, (0.092, 0, 2.55), '+X', m['yellow']))
    # 遮断機の箱（-Y 側に置き、遮断桿は +Y 方向へ延びる）
    p.append(box('mach', (0.4, 0.4, 0.9), (0, -0.5, 0.45), m['yellow'], bevel=0.02))
    p.append(cyl('hub', 0.1, 0.5, (0, -0.5, 0.9), m['black'], verts=10, axis='X'))
    return join(p, 'crossing_post', smooth_angle=40)


def crossing_arm():
    """遮断桿（黄黒の縞、長さ6m）。原点が回転軸、+Y へ延びる。"""
    m = M()
    p = []
    n = 12
    for i in range(n):
        p.append(box('a', (0.06, 6.0 / n, 0.1), (0, (i + 0.5) * 6.0 / n, 0), m['yellow'] if i % 2 == 0 else m['black']))
    p.append(box('cw', (0.15, 0.5, 0.25), (0, -0.25, 0), m['dark']))
    return join(p, 'crossing_arm')


def catenary_pole():
    """鉄道の架線柱（コンクリート柱＋可動ブラケット）。線路は +Y 側。"""
    m = M()
    p = [cyl('pole', 0.16, 7.5, (0, 0, 3.75), m['conc'], verts=10, r2=0.12),
         cyl('arm', 0.04, 3.2, (0, 1.6, 6.6), m['galv'], verts=8, axis='Y'),
         cyl('arm2', 0.03, 3.0, (0, 1.5, 7.2), m['galv'], verts=8, axis='Y'),
         box('stay', (0.05, 0.05, 0.7), (0, 2.8, 6.9), m['galv'])]
    for y in (0.3, 2.9):
        p.append(cyl('ins', 0.06, 0.25, (0, y, 6.6), mat('SP_Insul', '#7a3a2a', rough=0.3), verts=8, axis='Y'))
    return join(p, 'catenary_pole', smooth_angle=40)


def slide():
    """公園のすべり台。滑る向き +X。"""
    m = M()
    red = mat('SP_PlayRed', '#d23a2a', rough=0.45)
    yel = mat('SP_PlayYellow', '#f0c020', rough=0.45)
    p = []
    for x in (-0.6, 0.0):
        for y in (-0.35, 0.35):
            p.append(cyl('leg', 0.04, 1.6, (x - 0.6, y, 0.8), m['galv'], verts=8))
    p.append(box('deck', (0.7, 0.8, 0.06), (-0.9, 0, 1.6), yel))
    for k in range(6):
        p.append(box('step', (0.06, 0.6, 0.04), (-1.6 + k * 0.12, 0, 0.25 + k * 0.25), m['galv']))
    for y in (-0.3, 0.3):
        p.append(box('rail', (0.04, 0.04, 1.8), (-1.3, y, 0.9), m['galv'], rot=('Y', -0.5)))
        p.append(box('guard', (0.7, 0.04, 0.5), (-0.9, y * 1.3, 1.9), red))
    sl = prism('slide', [(-0.55, 1.6), (-0.55, 1.5), (1.5, 0.15), (1.9, 0.15), (1.9, 0.25), (1.5, 0.25)], -0.3, 0.3, red, axis='Y')
    p.append(sl)
    for y in (-0.3, 0.3):
        p.append(prism('lip', [(-0.55, 1.75), (-0.55, 1.6), (1.5, 0.25), (1.5, 0.4)], y - 0.025, y + 0.025, yel, axis='Y'))
    return join(p, 'slide', smooth_angle=30)


def swing():
    """ブランコ（2人用）。"""
    m = M()
    blue = mat('SP_PlayBlue', '#2a64b4', rough=0.45)
    p = []
    for y in (-1.3, 1.3):
        for x in (-0.7, 0.7):
            b = box('leg', (0.08, 0.08, 2.5), (x / 2, y, 1.2), blue, rot=('Y', -x * 0.28))
            p.append(b)
    p.append(cyl('top', 0.06, 2.8, (0, 0, 2.4), blue, verts=10, axis='Y'))
    for y in (-0.6, 0.6):
        for dy in (-0.22, 0.22):
            p.append(cyl('chain', 0.01, 1.9, (0, y + dy, 1.45), m['galv'], verts=4))
        p.append(box('seat', (0.25, 0.5, 0.04), (0, y, 0.5), mat('SP_PlaySeat', '#f2c43a', rough=0.5)))
    return join(p, 'swing', smooth_angle=30)


def jungle_gym():
    """ジャングルジム（3×3×3）。"""
    cols = [mat('SP_JgR', '#d23a2a'), mat('SP_JgB', '#2a64b4'), mat('SP_JgY', '#f0c020'), mat('SP_JgG', '#3a9a4a')]
    p = []
    n, s = 3, 0.6
    for i in range(n + 1):
        for j in range(n + 1):
            p.append(cyl('v', 0.02, n * s, ((i - 1.5) * s, (j - 1.5) * s, n * s / 2), cols[(i + j) % 4], verts=6))
            for k in range(1, n + 1):
                p.append(cyl('hx', 0.02, n * s, (0, (j - 1.5) * s, k * s), cols[(j + k) % 4], verts=6, axis='X'))
                p.append(cyl('hy', 0.02, n * s, ((i - 1.5) * s, 0, k * s), cols[(i + k + 1) % 4], verts=6, axis='Y'))
    return join(p, 'jungle_gym', smooth_angle=60)


def sandbox():
    """砂場（木枠）。"""
    sand = mat('SP_Sand', '#d8c38e', rough=0.95)
    wood = mat('SP_BenchWood', '#8a6038', rough=0.7)
    p = [box('sand', (3.0, 3.0, 0.08), (0, 0, 0.04), sand)]
    for s in (-1, 1):
        p.append(box('fx', (3.2, 0.12, 0.25), (0, s * 1.55, 0.12), wood))
        p.append(box('fy', (0.12, 3.2, 0.25), (s * 1.55, 0, 0.12), wood))
    return join(p, 'sandbox', smooth_angle=30)


def park_toilet():
    """公園の公衆トイレ（4×3m、瓦屋根）。入口+X。"""
    m = M()
    wall = mat('SP_ToiletWall', '#d9cdb4', rough=0.8)
    kawara = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = [box('body', (3.0, 4.0, 2.6), (0, 0, 1.3), wall, bevel=0.02)]
    p.append(prism('roof', [(-1.9, 2.6), (1.9, 2.6), (0, 3.5)], -2.3, 2.3, kawara, axis='Y'))
    for y, t in ((-1.0, '男'), (1.0, '女')):
        p.append(box('door', (0.04, 0.9, 2.0), (1.5, y, 1.0), m['dark']))
        p.append(box('pl', (0.02, 0.4, 0.4), (1.53, y, 2.25), m['blue'] if t == '男' else m['red']))
        p.append(text3d('t', t, 0.25, (1.545, y, 2.25), '+X', m['signw']))
    p.append(box('sign', (0.02, 1.2, 0.3), (1.53, 0, 2.3), m['signw']))
    p.append(text3d('ts', 'トイレ', 0.16, (1.545, 0, 2.3), '+X', m['dark']))
    return join(p, 'park_toilet', smooth_angle=30)


def park_lamp():
    """公園灯（ポール＋丸いグローブ）。"""
    m = M()
    glob_ = mat('LampLight', '#fff8e8', rough=0.3, emit='#fff1d0', estr=4.0)
    p = [cyl('pole', 0.06, 3.4, (0, 0, 1.7), mat('SP_Iron', '#2c2e2f', metal=0.6, rough=0.5), verts=10),
         sphere('glb', 0.22, (0, 0, 3.6), glob_, seg=14, rings=8),
         cyl('cap', 0.12, 0.08, (0, 0, 3.85), mat('SP_Iron', '#2c2e2f', metal=0.6, rough=0.5), verts=10)]
    return join(p, 'park_lamp', smooth_angle=40)


def fountain():
    """水飲み場。"""
    m = M()
    return join([cyl('c', 0.2, 0.85, (0, 0, 0.42), m['granite'], verts=12), cyl('b', 0.3, 0.12, (0, 0, 0.9), m['granite'], verts=16),
                 cyl('tap', 0.02, 0.12, (0.15, 0, 1.0), m['stain'], verts=6)], 'fountain', smooth_angle=40)


def solar_panel():
    """住宅屋根の太陽光パネル（4×3枚、3.4×2.0m）。原点=中心、パネル面は XY（傾きはゲーム側で付ける）。"""
    cell = mat('SP_Solar', '#1c2a44', metal=0.4, rough=0.2)
    fr = mat('SP_SolarFrame', '#b8bcc0', metal=0.8, rough=0.3)
    p = [box('fr', (3.4, 2.0, 0.05), (0, 0, 0.03), fr)]
    for i in range(4):
        for j in range(3):
            p.append(box('c', (0.8, 0.62, 0.02), (-1.25 + i * 0.83, -0.65 + j * 0.65, 0.065), cell))
    return join(p, 'solar_panel')


def tv_antenna():
    """屋根のテレビアンテナ（八木式）。"""
    m = M()
    p = [cyl('mast', 0.025, 2.4, (0, 0, 1.2), m['galv'], verts=6), cyl('boom', 0.015, 1.6, (0.4, 0, 2.3), m['galv'], verts=6, axis='X')]
    for k in range(9):
        p.append(cyl('el', 0.006, 0.5 - k * 0.025, (-0.35 + k * 0.17, 0, 2.3), m['galv'], verts=4, axis='Y'))
    p.append(cyl('dish', 0.25, 0.04, (0.05, 0, 1.6), m['white'], verts=16, axis='X'))
    return join(p, 'tv_antenna', smooth_angle=40)


def gs_canopy():
    """ガソリンスタンドの大屋根（14×10m、高さ5m）。"""
    m = M()
    band = mat('SP_GSBand', '#d83020', rough=0.4)
    under = mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0)
    p = [box('roof', (14, 10, 0.5), (0, 0, 5.25), m['white']), box('under', (13.6, 9.6, 0.02), (0, 0, 4.99), under)]
    for s in (-1, 1):
        p.append(box('band', (14.04, 0.02, 0.5), (0, s * 5.01, 5.25), band))
        p.append(box('bandx', (0.02, 10.04, 0.5), (s * 7.01, 0, 5.25), band))
    for x in (-4, 4):
        p.append(box('pillar', (0.4, 0.4, 5.0), (x, 0, 2.5), m['white']))
    for f, x in (('+X', 7.03), ('-X', -7.03)):
        p.append(text3d('t', 'MIKAN OIL', 0.32, (x, 0, 5.25), f, m['signw']))
    return join(p, 'gs_canopy', smooth_angle=30)


def gs_pump():
    """給油機とアイランド。"""
    m = M()
    p = [box('isl', (3.6, 1.0, 0.18), (0, 0, 0.09), m['conc'], bevel=0.03),
         box('body', (1.0, 0.5, 1.7), (0, 0, 1.03), m['white'], bevel=0.03),
         box('top', (1.04, 0.54, 0.25), (0, 0, 1.75), mat('SP_GSBand', '#d83020', rough=0.4)),
         box('scr', (0.4, 0.52, 0.3), (0, 0, 1.3), mat('SP_Screen', '#1a2a3a', rough=0.1, emit='#4a8acc', estr=0.3))]
    for s in (-1, 1):
        p.append(cyl('hose', 0.03, 1.0, (s * 0.45, 0.28, 1.0), m['black'], verts=6))
        p.append(cyl('post', 0.08, 1.0, (s * 1.6, 0, 0.6), m['yellow'], verts=10))
    return join(p, 'gs_pump', smooth_angle=40)


def gs_sign():
    """ガソリン価格の看板塔。"""
    m = M()
    lit = mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0)
    p = [box('pole', (0.4, 0.4, 6.0), (0, 0, 3.0), m['grey']), box('top', (0.4, 2.0, 1.6), (0, 0, 6.6), mat('SP_GSBand', '#d83020', rough=0.4)),
         box('board', (0.42, 1.8, 2.2), (0, 0, 4.6), m['dark'])]
    for f, x in (('+X', 0.215), ('-X', -0.215)):
        p.append(text3d('m', 'MIKAN', 0.3, (x, 0, 6.6), f, m['signw']))
        for k, (lab, pr) in enumerate((('レギュラー', '168'), ('ハイオク', '179'), ('軽油', '148'))):
            p.append(text3d('l', lab, 0.13, (x, -0.45, 5.4 - k * 0.6), f, m['signw']))
            p.append(text3d('p', pr, 0.3, (x, 0.45, 5.4 - k * 0.6), f, mat('SP_PriceLit', '#ffb020', emit='#ffb020', estr=0.5)))
    return join(p, 'gs_sign', smooth_angle=30)


def gs_office():
    """スタンドの事務所・売店。入口+X。"""
    m = M()
    glass = mat('NightGlow_Warm', '#3a3226', rough=0.3, emit='#ffcf8a', estr=0.0)
    p = [box('body', (5.0, 7.0, 3.0), (0, 0, 1.5), m['white']), box('win', (0.04, 5.0, 1.8), (2.52, 0, 1.3), glass),
         box('band', (5.04, 7.04, 0.5), (0, 0, 3.0), mat('SP_GSBand', '#d83020', rough=0.4))]
    return join(p, 'gs_office', smooth_angle=30)


def traffic_cone():
    m = M()
    p = [box('base', (0.4, 0.4, 0.04), (0, 0, 0.02), m['dark']), cyl('c', 0.15, 0.68, (0, 0, 0.38), m['orange'], verts=12, r2=0.03)]
    p.append(cyl('band', 0.115, 0.12, (0, 0, 0.42), m['white'], verts=12, r2=0.09))
    return join(p, 'traffic_cone', smooth_angle=50)


def barricade():
    """工事用バリケード（黄黒の横板）1.8m。"""
    m = M()
    p = []
    for x in (-0.8, 0.8):
        for s in (-1, 1):
            p.append(box('leg', (0.05, 0.05, 1.0), (x, s * 0.18, 0.48), m['white'], rot=('X', s * 0.3)))
    for z in (0.85, 0.5):
        for i in range(6):
            p.append(box('b', (0.3, 0.03, 0.18), (-0.75 + i * 0.3, 0, z), m['yellow'] if i % 2 == 0 else m['black']))
    p.append(cyl('lamp', 0.06, 0.08, (0.8, 0, 1.05), mat('NightGlow_Red', '#c8301e', rough=0.6, emit='#ff6a3a', estr=0.0), verts=10))
    return join(p, 'barricade', smooth_angle=40)


def koji_sign():
    """「工事中」看板（A型スタンド）。正面+X。"""
    m = M()
    p = []
    for s in (-1, 1):
        b = box('b', (0.03, 0.7, 1.1), (s * 0.15, 0, 0.55), m['white'])
        b.rotation_euler = (0, s * -0.15, 0)
        p.append(b)
    p.append(box('y', (0.012, 0.6, 0.35), (0.24, 0, 0.85), m['yellow'], rot=('Y', -0.15)))
    p.append(text3d('t', '工事中', 0.13, (0.255, 0, 0.86), '+X', m['black'], rot_extra=0.0))
    p.append(text3d('t2', 'ご迷惑をおかけします', 0.045, (0.21, 0, 0.55), '+X', m['dark']))
    return join(p, 'koji_sign', smooth_angle=40)


def fishing_boat():
    """小型漁船（全長9m）。前方+X。"""
    white = mat('SP_BoatWhite', '#eef0ee', rough=0.4)
    blue = mat('SP_BoatBlue', '#2a5a9a', rough=0.45)
    red = mat('SP_BoatRed', '#b8302a', rough=0.5)
    m = M()
    secs = [(-4.4, 1.2, 0.2, 1.6), (-3.5, 1.45, 0.0, 1.7), (2.0, 1.45, 0.0, 1.8), (3.6, 0.9, 0.4, 2.0), (4.6, 0.1, 1.0, 2.15)]
    hull = loft_rect('hull', secs, white)
    me = hull.data
    me.materials.append(blue); me.materials.append(red)
    bm = bmesh.new(); bm.from_mesh(me)
    for z in (0.45, 1.3, 1.55):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    for f in bm.faces:
        cz = f.calc_center_median().z
        f.material_index = 2 if cz < 0.45 else (1 if 1.3 < cz < 1.55 else 0)
    bm.to_mesh(me); bm.free()
    p = [hull,
         box('cabin', (2.0, 1.8, 1.6), (-1.6, 0, 2.5), white, bevel=0.05), box('cwin', (0.04, 1.4, 0.4), (-0.58, 0, 2.9), m['dark']),
         cyl('mast', 0.05, 3.0, (-1.2, 0, 4.4), m['white'], verts=8), box('deck', (6.0, 2.6, 0.05), (0.2, 0, 1.72), mat('SP_Deck', '#9a8a6a', rough=0.8))]
    for k in range(3):
        p.append(sphere('buoy', 0.18, (1.5 + k * 0.6, 1.2, 1.9), m['orange'], seg=10, rings=6))
    return join(p, 'fishing_boat', smooth_angle=35)


def bus_shelter():
    """屋根付きバス待合所（4m、ベンチ・広告パネル）。正面(道路側)+X。"""
    m = M()
    glass = mat('SP_Glass', '#a6c0cc', rough=0.05, alpha=0.35)
    ad = mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0)
    p = [box('roof', (1.7, 4.2, 0.1), (0.1, 0, 2.55), m['steel'], bevel=0.02), box('back', (0.03, 4.0, 1.9), (-0.7, 0, 1.25), glass),
         box('ad', (0.08, 1.2, 1.7), (-0.68, 1.4, 1.2), ad)]
    for y in (-1.95, 1.95):
        p.append(box('post', (0.08, 0.08, 2.5), (-0.7, y, 1.25), m['steel']))
        p.append(box('side', (1.2, 0.03, 1.7), (-0.15, y, 1.25), glass))
    p.append(box('bench', (0.4, 2.4, 0.05), (-0.4, -0.5, 0.45), mat('SP_BenchWood', '#8a6038', rough=0.7)))
    return join(p, 'bus_shelter', smooth_angle=40)


def build_stage5():
    return [crossing_post(), crossing_arm(), catenary_pole(), slide(), swing(), jungle_gym(), sandbox(), park_toilet(), park_lamp(),
            fountain(), solar_panel(), tv_antenna(), gs_canopy(), gs_pump(), gs_sign(), gs_office(), traffic_cone(), barricade(),
            koji_sign(), fishing_boat(), bus_shelter()]



# ======================================================================
# 第6段: コンビニ・送電鉄塔・歩道橋・郊外駅ホーム・野立て看板・河川敷・港のクレーン・小さな神社・農機具小屋・タクシー乗り場
# ======================================================================
def konbini():
    """コンビニ（18×12m・平屋）。正面(ガラス面)+X。"""
    m = M()
    wall = mat('SP_KonbiniWall', '#eef0ee', rough=0.6)
    org = mat('SP_KonbiniOrange', '#f07a1a', rough=0.4)
    grn = mat('SP_KonbiniGreen', '#2f9a4a', rough=0.4)
    glass = mat('NightGlow_LightGlass', '#4a5c66', rough=0.08, spec=0.9, emit='#fff6e0', estr=0.0)
    p = [box('body', (12.0, 18.0, 4.2), (0, 0, 2.1), wall), box('glass', (0.06, 13.0, 2.4), (6.02, -1.5, 1.4), glass),
         box('door', (0.08, 2.0, 2.4), (6.03, 6.5, 1.3), m['dark']), box('roofedge', (12.3, 18.3, 0.3), (0, 0, 4.35), wall)]
    for z, mm in ((3.15, grn), (3.45, m['white']), (3.75, org)):
        p.append(box('band', (12.06, 18.06, 0.3), (0, 0, z), mm))
    for f, x in (('+X', 6.06), ('-X', -6.06)):
        p.append(text3d('t', 'MIKAN MART', 0.42, (x, 0, 3.45), f, org))
    for k in range(3):
        p.append(box('ac', (1.0, 1.8, 1.0), (-3 + k * 2.6, -6, 5.0), m['white']))
    for k in range(7):
        p.append(box('mull', (0.08, 0.08, 2.4), (6.06, -8.0 + k * 2.16, 1.4), m['grey']))
    p.append(box('post', (0.1, 13.2, 0.1), (6.06, -1.5, 2.6), m['grey']))
    p.append(box('trash', (0.5, 2.0, 1.0), (6.3, 8.0, 0.5), m['grey']))
    return join(p, 'konbini', smooth_angle=30)


def konbini_sign():
    """コンビニの看板塔（夜は点灯）。"""
    m = M()
    lit = mat('NightGlow_Light', '#f2f2ec', emit='#fff6e0', estr=0.0)
    org = mat('SP_KonbiniOrange', '#f07a1a', rough=0.4)
    p = [box('pole', (0.35, 0.35, 5.5), (0, 0, 2.75), m['grey']), box('box', (0.6, 2.2, 2.0), (0, 0, 6.3), lit)]
    for f, x in (('+X', 0.31), ('-X', -0.31)):
        p.append(box('o', (0.02, 2.2, 0.5), (x, 0, 6.9), org))
        p.append(text3d('t', 'MIKAN', 0.4, (x * 1.03, 0, 6.1), f, org))
        p.append(text3d('t2', '24h', 0.28, (x * 1.03, 0, 5.6), f, m['dark']))
    return join(p, 'konbini_sign', smooth_angle=30)


def pylon():
    """送電鉄塔（高さ40m、腕は±Y）。"""
    st = mat('SP_Pylon', '#b8bcbe', metal=0.6, rough=0.45)
    p = []
    H = 40.0
    def leg(x0, y0, x1, y1, z0, z1, r=0.12):
        a, b = Vector((x0, y0, z0)), Vector((x1, y1, z1))
        d = b - a
        o = cyl('l', r, d.length, (0, 0, 0), st, verts=4, cap=False)
        o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        o.location = (a + b) / 2
        return o
    w = lambda z: 4.0 * (1 - z / H) + 0.8 * (z / H)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(leg(sx * w(0), sy * w(0), sx * w(H), sy * w(H), 0, H, 0.18))
    lv = [0, 6, 12, 18, 24, 30, 36, 40]
    for z0, z1 in zip(lv, lv[1:]):
        for (ax, ay, bx, by) in ((1, 1, 1, -1), (-1, 1, -1, -1), (1, 1, -1, 1), (1, -1, -1, -1)):
            p.append(leg(ax * w(z0), ay * w(z0), bx * w(z1), by * w(z1), z0, z1, 0.06))
            p.append(leg(bx * w(z0), by * w(z0), ax * w(z1), ay * w(z1), z0, z1, 0.06))
    for z, L in ((26, 6.5), (32, 6.0), (38, 5.0)):
        for s in (-1, 1):
            p.append(leg(0, s * w(z), 0, s * L, z, z, 0.12))
            p.append(leg(0, s * w(z - 2), 0, s * L, z - 2, z, 0.06))
            p.append(cyl('ins', 0.12, 1.4, (0, s * (L - 0.2), z - 0.7), mat('SP_Insul', '#7a3a2a', rough=0.3), verts=6))
    return join(p, 'pylon', smooth_angle=30)


def ob_stair():
    """歩道橋の階段（幅2m、長さ10m、高さ5.2m）。+X へ上り、x=10 で踊り場。"""
    st = mat('SP_OBBlue', '#3a6a9a', metal=0.4, rough=0.45)
    m = M()
    p = []
    n = 26
    for i in range(n):
        x = 0.2 + i * 0.36
        p.append(box('st', (0.36, 2.0, 0.08), (x, 0, 0.2 * (i + 1)), m['grey']))
    for s in (-1, 1):
        p.append(prism('stringer', [(0, 0), (9.6, 5.2), (9.6, 5.6), (0, 0.4)], s * 1.0 - 0.06, s * 1.0 + 0.06, st, axis='Y'))
        p.append(prism('rail', [(0, 1.0), (9.6, 6.2), (9.6, 6.3), (0, 1.1)], s * 1.05 - 0.03, s * 1.05 + 0.03, st, axis='Y'))
    p.append(box('land', (2.4, 2.4, 0.3), (10.8, 0, 5.05), st))
    for x in (6.0, 11.6):
        for s in (-1, 1):
            p.append(box('col', (0.25, 0.25, 5.2 if x > 10 else 3.3), (x, s * 0.9, (5.2 if x > 10 else 3.3) / 2), st))
    return join(p, 'ob_stair', smooth_angle=30)


def platform():
    """郊外駅のホーム（30m×3m、高さ0.9m）と上屋・駅名標。線路は +Y 側。"""
    m = M()
    conc = mat('SP_Conc', '#b4b1a8', rough=0.9)
    tact = mat('SP_Tactile', '#e8c22a', rough=0.6)
    roof = mat('SP_Roof', '#d9dcdc', metal=0.3, rough=0.4)
    p = [box('deck', (30, 3.0, 0.9), (0, 0, 0.45), conc), box('edge', (30, 0.3, 0.02), (0, 1.25, 0.91), tact),
         box('wl', (30, 0.08, 0.02), (0, 0.9, 0.91), m['white'])]
    for x in (-6, 0, 6):
        p.append(box('post', (0.15, 0.15, 3.0), (x, -0.8, 2.4), m['steel']))
    p.append(box('roof', (15, 3.2, 0.12), (0, 0, 3.95), roof))
    p.append(box('bench', (2.0, 0.4, 0.05), (-3, -0.9, 1.35), mat('SP_BenchWood', '#8a6038', rough=0.7)))
    for x in (8.0,):
        p.append(box('np', (0.08, 0.08, 2.2), (x - 0.9, -0.9, 2.0), m['steel']))
        p.append(box('np2', (0.08, 0.08, 2.2), (x + 0.9, -0.9, 2.0), m['steel']))
        p.append(box('nb', (2.0, 0.05, 0.6), (x, -0.9, 2.9), m['signw']))
        p.append(box('nb2', (2.0, 0.055, 0.12), (x, -0.9, 3.12), mat('SP_TramGreen', '#2e6b4a', rough=0.45)))
        for f, y in (('-Y', -0.93), ('+Y', -0.87)):
            p.append(text3d('t', 'のりば', 0.22, (x, y, 2.85), f, m['dark']))
    for k in range(15):
        p.append(box('fence', (0.05, 0.05, 1.1), (-14 + k * 2, -1.45, 1.45), m['galv']))
    p.append(box('fr', (30, 0.05, 0.05), (0, -1.45, 1.95), m['galv']))
    for s in (-1, 1):
        p.append(prism('ramp', [(0, 0), (3.0, 0), (0, 0.9)], -1.5, 1.5, conc, axis='Y') if False else box('rmp', (0.01, 0.01, 0.01), (0, 0, 0), conc))
    return join(p, 'platform', smooth_angle=30)


def billboard():
    """野立て看板（10×4m、高さ8m）。看板面はゲーム側で広告アトラスを貼る（ここは骨組みと裏面）。正面+X。"""
    m = M()
    p = []
    for y in (-3.5, 3.5):
        p.append(box('pole', (0.4, 0.4, 8.0), (-0.3, y, 4.0), m['grey']))
    p.append(box('back', (0.2, 10.2, 4.2), (-0.12, 0, 6.0), m['grey']))
    for z in (4.2, 7.8):
        p.append(box('light', (0.8, 0.12, 0.12), (0.4, 0, z), m['dark']))
    p.append(box('walk', (0.8, 10.0, 0.08), (0.3, 0, 3.8), m['galv']))
    return join(p, 'billboard', smooth_angle=30)


def net_grid(name, w, h, cx, cy, z0, ang, mm, step=0.4):
    """縦横の細い棒で作る網（YZ面、中心 (cx,cy)、Z軸回りに ang 回転）。"""
    p = []
    ca, sa = math.cos(ang), math.sin(ang)
    for k in range(int(w / step) + 1):
        y = -w / 2 + k * step
        p.append(box(name, (0.015, 0.015, h), (cx - sa * y, cy + ca * y, z0 + h / 2), mm, rot=('Z', ang)))
    for k in range(int(h / step) + 1):
        p.append(box(name, (0.015, w, 0.015), (cx, cy, z0 + k * step), mm, rot=('Z', ang)))
    return p


def backstop():
    """河川敷の野球場のバックネット。ホーム側(+X)。"""
    m = M()
    netm = mat('SP_Net', '#3a4a3a', rough=0.8)
    p = net_grid('net', 12.0, 6.0, 0, 0, 0, 0, netm, 0.5)
    for y in (-6, -2, 2, 6):
        p.append(cyl('post', 0.08, 6.0, (0, y, 3.0), m['galv'], verts=8))
    for s in (-1, 1):
        p += net_grid('wing', 6.0, 3.0, 2.3, s * 8.2, 0, s * 0.7, netm, 0.5)
    p.append(box('bench', (0.4, 3.0, 0.45), (3.0, -9, 0.22), mat('SP_BenchWood', '#8a6038', rough=0.7)))
    return join(p, 'backstop', smooth_angle=30)


def soccer_goal():
    m = M()
    p = [cyl('bar', 0.06, 7.3, (0, 0, 2.44), m['white'], verts=8, axis='Y')]
    for y in (-3.66, 3.66):
        p.append(cyl('post', 0.06, 2.44, (0, y, 1.22), m['white'], verts=8))
        p.append(cyl('back', 0.03, 2.0, (-1.0, y, 1.0), m['white'], verts=6))
    net = box('net', (2.0, 7.3, 2.44), (-1.0, 0, 1.22), mat('SP_NetW', '#e8e8e8', rough=0.8))
    add_mod(net, 'WIREFRAME', thickness=0.015, use_replace=True)
    p.append(net)
    return join(p, 'soccer_goal', smooth_angle=30)


def jib_crane():
    """港の旋回式クレーン（高さ約22m）。"""
    yel = mat('SP_CraneY', '#e8b020', rough=0.45)
    red = mat('SP_CraneR', '#c8342a', rough=0.45)
    m = M()
    p = [box('base', (6, 6, 1.5), (0, 0, 0.75), m['conc']), cyl('tower', 1.2, 14, (0, 0, 8.5), yel, verts=12),
         box('cab', (3.5, 3.0, 3.0), (0.5, 0, 16.5), yel), box('win', (0.05, 2.4, 1.2), (2.27, 0, 17.0), m['dark'])]
    boom = box('boom', (24, 1.0, 1.0), (12, 0, 19), red)
    boom.rotation_euler = (0, math.radians(-14), 0)
    p.append(boom)
    p.append(box('cw', (3, 2.5, 2.0), (-2.5, 0, 17.5), m['grey']))
    p.append(cyl('rope', 0.04, 9, (23.2, 0, 20.0), m['dark'], verts=4))
    p.append(box('hook', (0.6, 0.6, 0.8), (23.2, 0, 15.2), m['black']))
    return join(p, 'jib_crane', smooth_angle=30)


def small_shrine():
    """町の小さな神社（鳥居＋祠＋石段）。参道は +X 方向（鳥居が +X 側）。"""
    m = M()
    ver = mat('LM_Vermilion', '#c8402a', rough=0.5)
    blk = mat('LM_BlackWood', '#26231f', rough=0.7)
    wood = mat('SP_ShrineWood', '#8a6a48', rough=0.7)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = []
    tx = 4.5
    for y in (-1.3, 1.3):
        p.append(cyl('hashira', 0.16, 3.4, (tx, y, 1.7), ver, verts=12))
    p.append(box('kasagi', (0.4, 3.8, 0.25), (tx, 0, 3.5), blk))
    p.append(box('shimaki', (0.3, 3.4, 0.2), (tx, 0, 3.25), ver))
    p.append(box('nuki', (0.2, 3.0, 0.18), (tx, 0, 2.7), ver))
    p.append(box('base', (2.2, 2.2, 0.5), (-1.5, 0, 0.25), m['granite']))
    p.append(box('hokora', (1.2, 1.1, 1.2), (-1.5, 0, 1.1), wood))
    p.append(prism('roof', [(-0.9, 1.7), (0.9, 1.7), (0, 2.3)], -2.3, -0.7, kaw, axis='X') if False else
             prism('roof', [(-0.85, 1.65), (0.85, 1.65), (0, 2.25)], -2.35, -0.65, kaw, axis='X'))
    p.append(box('rope', (0.1, 1.2, 0.08), (-0.85, 0, 1.6), mat('SP_Rope', '#d8c890', rough=0.8)))
    for k in range(4):
        p.append(box('path', (0.9, 1.2, 0.06), (0.5 + k * 1.0, 0, 0.03), m['granite']))
    return join(p, 'small_shrine', smooth_angle=30)


def farm_hut():
    """農機具小屋（波板トタン、4×3m）。入口+X。"""
    m = M()
    rust = mat('SP_Tin', '#8a8f8a', metal=0.5, rough=0.6)
    roof = mat('SP_TinRoof', '#7a4a3a', metal=0.4, rough=0.6)
    p = [box('body', (3.0, 4.0, 2.4), (0, 0, 1.2), rust), box('door', (0.04, 2.2, 2.0), (1.52, 0, 1.0), m['dark'])]
    r = box('roof', (3.6, 4.4, 0.08), (0, 0, 2.6), roof)
    r.rotation_euler = (0, math.radians(8), 0)
    p.append(r)
    p.append(box('drum', (0.6, 0.6, 0.9), (1.9, 1.6, 0.45), mat('SP_Drum', '#2a5a9a', rough=0.5)))
    return join(p, 'farm_hut', smooth_angle=30)


def taxi_sign():
    m = M()
    p = sign_pole(2.6, m) + [box('b', (0.02, 0.6, 0.4), (0.05, 0, 2.3), m['yellow'])]
    for f, x in (('+X', 0.062), ('-X', 0.038)):
        p.append(text3d('t', 'タクシー', 0.11, (x, 0, 2.36), f, m['black']))
        p.append(text3d('t2', 'のりば', 0.1, (x, 0, 2.2), f, m['black']))
    return join(p, 'taxi_sign', smooth_angle=30)


def build_stage6():
    return [konbini(), konbini_sign(), pylon(), ob_stair(), platform(), billboard(), backstop(), soccer_goal(), jib_crane(),
            small_shrine(), farm_hut(), taxi_sign()]



# ======================================================================
# 第7段: 壊せる物の追加（地上式消火栓）
# ======================================================================
def hydrant():
    """地上式消火栓（赤、高さ約0.9m）。放水口は ±Y。"""
    m = M()
    red = mat('SP_HydRed', '#c8241c', rough=0.4, coat=0.3)
    p = [cyl('base', 0.2, 0.08, (0, 0, 0.04), m['dark'], verts=14), cyl('body', 0.13, 0.62, (0, 0, 0.39), red, verts=16),
         cyl('ring', 0.16, 0.06, (0, 0, 0.66), red, verts=16), sphere('dome', 0.14, (0, 0, 0.7), red, seg=14, rings=6, scale=(1, 1, 0.8)),
         cyl('nut', 0.04, 0.08, (0, 0, 0.83), m['steel'], verts=6)]
    for s in (-1, 1):
        p.append(cyl('outlet', 0.06, 0.16, (0, s * 0.17, 0.48), red, verts=10, axis='Y'))
        p.append(cyl('cap', 0.07, 0.04, (0, s * 0.26, 0.48), m['steel'], verts=10, axis='Y'))
    return join(p, 'hydrant', smooth_angle=50)


def build_stage7():
    return [hydrant()]



# ======================================================================
# 第8段: 海岸（消波ブロック・灯台）
# ======================================================================
def tetrapod():
    """消波ブロック（テトラポッド型、約2.4m）。原点は中心。4本の脚は正四面体の頂点方向。"""
    c = mat('SP_Tetra', '#a6a49c', rough=0.92)
    dirs = [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]
    p = [sphere('core', 0.55, (0, 0, 0), c, seg=10, rings=6)]
    for d in dirs:
        v = Vector(d).normalized()
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=9, radius1=0.5, radius2=0.3, depth=1.15)
        q = Vector((0, 0, 1)).rotation_difference(v).to_matrix()
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q, verts=bm.verts)
        bmesh.ops.translate(bm, vec=v * 0.62, verts=bm.verts)
        p.append(mesh_from_bm('leg', bm, [c]))
    return join(p, 'tetrapod', smooth_angle=40)


def lighthouse(name, col, lamp):
    """防波堤の先端の灯台（赤灯台・白灯台、高さ約10m）。灯器は夜に点滅（NightGlow_*Blink）。"""
    m = M()
    body = mat('SP_LH_' + name, col, rough=0.45, coat=0.2)
    wh = mat('SP_LH_White', '#f2f0ea', rough=0.45)
    glow = mat(lamp, '#e8e0c8' if 'Light' in lamp else '#a83020', rough=0.2, emit='#ffffff', estr=0.0)
    p = [cyl('base', 1.7, 0.6, (0, 0, 0.3), m['conc'], verts=20),
         cyl('tower', 1.15, 7.4, (0, 0, 4.3), body, verts=20, r2=0.85),
         cyl('band', 1.0, 0.25, (0, 0, 6.2), wh if col != '#f2f0ea' else body, verts=20),
         cyl('deck', 1.35, 0.18, (0, 0, 8.1), m['dark'], verts=20),
         cyl('rail', 1.3, 0.45, (0, 0, 8.4), m['steel'], verts=20, cap=False),
         cyl('lamproom', 0.62, 0.25, (0, 0, 8.35), m['dark'], verts=14),
         cyl('lamp', 0.55, 1.1, (0, 0, 9.0), glow, verts=14),
         cyl('cap', 0.72, 0.4, (0, 0, 9.75), body, verts=14, r2=0.15),
         cyl('vane', 0.04, 0.6, (0, 0, 10.2), m['dark'], verts=6),
         box('door', (0.06, 0.7, 1.6), (1.12, 0, 1.4), m['dark'])]
    return join(p, name, smooth_angle=40)


def build_stage8():
    return [tetrapod(), lighthouse('lighthouse_red', '#c82a22', 'NightGlow_RedBlink'), lighthouse('lighthouse_white', '#f2f0ea', 'NightGlow_LightBlink')]



# ======================================================================
# 第9段: アーケード（入口の看板・吊り看板・フラッグ・店頭ワゴン）
# ======================================================================
def arcade_gate(name, width, title, sub, bg, fg):
    """アーケード入口の看板アーチ（夜は看板が光る）。+X がアーケードの外向き、Y が幅方向。"""
    m = M()
    frame = mat('SP_ArcFrame', '#5c6066', metal=0.6, rough=0.4)
    board = mat('NightGlow_Light_' + name, bg, rough=0.4, emit='#ffffff', estr=0.0)
    ink = mat('SP_ArcInk_' + name, fg, rough=0.35)
    hw = width / 2
    p = []
    for s in (-1, 1):
        p.append(box('post', (0.45, 0.45, 5.6), (0, s * (hw - 0.35), 2.8), frame))
    p.append(box('beam', (0.6, width, 0.3), (0, 0, 5.75), frame))
    p.append(box('board', (0.5, width * 0.62, 1.15), (0, 0, 4.85), board))
    p.append(box('trim', (0.55, width * 0.64, 0.08), (0, 0, 5.46), frame))
    p.append(box('trim', (0.55, width * 0.64, 0.08), (0, 0, 4.24), frame))
    for f, x in (('+X', 0.26), ('-X', -0.26)):
        p.append(text3d('t', title, 0.62, (x, 0, 5.0), f, ink))
        p.append(text3d('s', sub, 0.2, (x, 0, 4.45), f, ink))
    return join(p, name, smooth_angle=30)


HANG = [('hang_sign_a', 'くすり', '#2a6ab0', '#ffffff'), ('hang_sign_b', 'めがね', '#f2efe6', '#2a2a2a'), ('hang_sign_c', '珈琲', '#4a2e1e', '#f0d8a8'),
        ('hang_sign_d', '書店', '#1e5a3a', '#ffffff'), ('hang_sign_e', '時計・宝石', '#14141a', '#e8c860'), ('hang_sign_f', 'うどん', '#f2efe6', '#b02020'),
        ('hang_sign_g', 'みかん', '#f08a1c', '#ffffff'), ('hang_sign_h', '靴', '#b02828', '#ffffff')]


def hang_sign(name, label, bg, fg):
    """アーケードの屋根から吊った店の看板（両面）。板は Y 方向に長く、+X/-X の面に文字。"""
    m = M()
    b = mat('SP_Hang_' + name, bg, rough=0.45)
    ink = mat('SP_HangInk_' + name, fg, rough=0.4)
    p = [box('board', (0.07, 1.5, 0.5), (0, 0, 2.95), b)]
    for y in (-0.6, 0.6):
        p.append(cyl('rod', 0.012, 2.0, (0, y, 4.2), m['steel'], verts=5))
    for f, x in (('+X', 0.04), ('-X', -0.04)):
        p.append(text3d('t', label, 0.26 if len(label) <= 3 else 0.19, (x, 0, 2.95), f, ink))
    return join(p, name, smooth_angle=30)


def arcade_flag():
    """屋根の梁から下げたフラッグ（2枚）。"""
    m = M()
    cols = [mat('SP_FlagA', '#e86a1a', rough=0.8), mat('SP_FlagB', '#2a78c8', rough=0.8)]
    p = [cyl('bar', 0.02, 1.6, (0, 0, 4.6), m['steel'], verts=6, axis='Y')]
    for k, y in enumerate((-0.42, 0.42)):
        p.append(box('flag', (0.02, 0.5, 1.3), (0, y, 3.9), cols[k]))
        p.append(text3d('t', 'SALE' if k == 0 else 'みかん祭', 0.12, (0.015, y, 4.1), '+X', m['signw']))
    return join(p, 'arcade_flag', smooth_angle=30)


def shop_wagon():
    """店頭のワゴン（商品の箱を山盛り）。長手 Y。"""
    m = M()
    frame = mat('SP_WagonFrame', '#b8bcc0', metal=0.6, rough=0.4)
    p = [box('basket', (0.62, 1.2, 0.32), (0, 0, 0.7), frame), box('base', (0.5, 1.1, 0.04), (0, 0, 0.3), frame)]
    for (x, y) in ((-0.25, -0.5), (0.25, -0.5), (-0.25, 0.5), (0.25, 0.5)):
        p.append(cyl('leg', 0.015, 0.54, (x, y, 0.27), frame, verts=5))
    rr = random.Random(7)
    cols = ['#e86a1a', '#f2d24a', '#3a8ad8', '#d84a6a', '#5ab04a', '#f2f2ea']
    for i in range(10):
        c = mat('SP_Goods%d' % (i % 6), cols[i % 6], rough=0.6)
        p.append(box('g', (0.18, 0.2, 0.12 + rr.random() * 0.08), (-0.18 + (i % 3) * 0.18, -0.45 + (i // 3) * 0.3, 0.9), c))
    return join(p, 'shop_wagon', smooth_angle=30)


def build_stage9():
    return [arcade_gate('arcade_gate_okaido', 12.0, '大街道', 'OKAIDO SHOPPING STREET', '#1e3c78', '#ffffff'),
            arcade_gate('arcade_gate_gintengai', 10.4, '銀天街', 'GINTENGAI', '#7a1e1e', '#f2d27a'),
            arcade_gate('arcade_gate_dogo', 9.6, '道後ハイカラ通り', 'DOGO HAIKARA-DORI', '#2a221c', '#f2e6c8')] + \
           [hang_sign(*h) for h in HANG] + [arcade_flag(), shop_wagon()]



# ======================================================================
# 第10段: 道後公園（湯築城跡）の武家屋敷・土塀・門・東屋・石碑
# ======================================================================
def pyramid_roof(name, w, d, z, h, over, m):
    """寄棟（方形）の屋根。中心 (0,0)、軒の高さ z。"""
    bm = bmesh.new()
    a, b = w / 2 + over, d / 2 + over
    c = [bm.verts.new(p) for p in ((-a, -b, z), (a, -b, z), (a, b, z), (-a, b, z))]
    t = bm.verts.new((0, 0, z + h))
    for i in range(4):
        bm.faces.new((c[i], c[(i + 1) % 4], t))
    bm.faces.new(list(reversed(c)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, [m])


def buke_house():
    """武家屋敷の母屋（10×6.5m、瓦の切妻、腰板＋白壁、+Y 側に縁側と障子）。"""
    m = M()
    wood = mat('SP_BukeWood', '#3e2e22', rough=0.75)
    plas = mat('SP_BukePlaster', '#efe9dc', rough=0.85)
    shoji = mat('NightGlow_Shoji', '#e8dcc0', rough=0.9, emit='#ffffff', estr=0.0)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    W, D = 10.0, 6.5
    p = [box('base', (W + 0.4, D + 0.4, 0.5), (0, 0, 0.25), m['granite']),
         box('koshi', (W, D, 0.9), (0, 0, 0.95), wood), box('wall', (W - 0.1, D - 0.1, 1.9), (0, 0, 2.35), plas)]
    for x in (-W / 2, -W / 4, 0, W / 4, W / 2):
        for y in (-D / 2, D / 2):
            p.append(box('post', (0.2, 0.2, 2.8), (x, y, 1.9), wood))
    for k in range(6):   # 縁側に面した障子
        p.append(box('shoji', (1.4, 0.05, 1.7), (-W / 2 + 0.95 + k * 1.62, D / 2 + 0.03, 1.85), shoji))
    p.append(box('engawa', (W, 1.0, 0.12), (0, D / 2 + 0.5, 0.62), wood))
    p.append(prism('roof', [(-D / 2 - 1.0, 3.2), (D / 2 + 1.0, 3.2), (0, 5.2)], -W / 2 - 0.8, W / 2 + 0.8, kaw, axis='X'))
    p.append(box('ridge', (W + 1.7, 0.4, 0.35), (0, 0, 5.25), kaw))
    p.append(box('genkan', (2.0, 1.2, 2.2), (W / 2 - 1.6, -D / 2 - 0.6, 1.6), wood))
    return join(p, 'buke_house', smooth_angle=30)


def buke_kura():
    """土蔵（4×3.5m、白漆喰・腰はなまこ壁風の黒、瓦屋根）。"""
    m = M()
    plas = mat('SP_KuraPlaster', '#f2eee4', rough=0.85)
    blk = mat('SP_KuraBlack', '#2a2c30', rough=0.7)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = [box('base', (4.3, 3.8, 0.4), (0, 0, 0.2), m['granite']), box('low', (4.0, 3.5, 1.0), (0, 0, 0.9), blk),
         box('wall', (3.95, 3.45, 2.4), (0, 0, 2.6), plas), box('door', (0.06, 1.2, 1.8), (2.0, 0, 1.4), blk)]
    for k in range(5):
        p.append(box('namako', (4.02, 0.03, 0.04), (0, 1.76, 0.5 + k * 0.18), plas))
    p.append(prism('roof', [(-2.3, 3.8), (2.3, 3.8), (0, 5.0)], -2.4, 2.4, kaw, axis='X'))
    return join(p, 'buke_kura', smooth_angle=30)


def dobei():
    """土塀 4m（石の基礎＋土壁＋瓦の笠）。長手 X、中心が原点。"""
    m = M()
    wall = mat('SP_Dobei', '#cdbf9e', rough=0.9)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = [box('base', (4.0, 0.7, 0.45), (0, 0, 0.225), m['granite']), box('wall', (4.0, 0.5, 1.45), (0, 0, 1.17), wall),
         prism('cap', [(-0.6, 1.9), (0.6, 1.9), (0, 2.25)], -2.02, 2.02, kaw, axis='X')]
    return join(p, 'dobei', smooth_angle=30)


def dobei_gate():
    """屋敷の門（扉は内側へ開いている）。通り口は Y 方向に 2.6m、+X が外。"""
    m = M()
    wood = mat('SP_BukeWood', '#3e2e22', rough=0.75)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = []
    for y in (-1.45, 1.45):
        p.append(box('post', (0.32, 0.32, 3.0), (0, y, 1.5), wood))
        p.append(box('door', (1.3, 0.08, 2.4), (-0.75, y * 0.97, 1.3), wood))   # 開いた扉（内側へ）
    p.append(box('beam', (0.36, 3.6, 0.3), (0, 0, 3.0), wood))
    p.append(prism('roof', [(-1.3, 3.15), (1.3, 3.15), (0, 4.0)], -2.2, 2.2, kaw, axis='Y'))
    return join(p, 'dobei_gate', smooth_angle=30)


def azumaya():
    """公園の東屋（3.6m四方、方形の屋根、中にベンチ）。"""
    m = M()
    wood = mat('SP_AzuWood', '#6a4a30', rough=0.75)
    kaw = mat('SP_Kawara', '#4a5056', rough=0.5, metal=0.2)
    p = []
    for x in (-1.6, 1.6):
        for y in (-1.6, 1.6):
            p.append(box('post', (0.18, 0.18, 2.6), (x, y, 1.3), wood))
    p.append(pyramid_roof('roof', 3.6, 3.6, 2.6, 1.3, 0.7, kaw))
    for y in (-1.2, 1.2):
        p.append(box('seat', (2.6, 0.4, 0.06), (0, y, 0.45), wood))
    p.append(box('floor', (3.8, 3.8, 0.12), (0, 0, 0.06), m['granite']))
    return join(p, 'azumaya', smooth_angle=30)


def sekihi():
    """石碑「湯築城跡」（文字は +X 面）。"""
    m = M()
    st = mat('SP_Sekihi', '#7a7a74', rough=0.8)
    ink = mat('SP_SekihiInk', '#1c1c1c', rough=0.7)
    p = [box('base', (1.2, 1.6, 0.35), (0, 0, 0.175), m['granite']), box('stone', (0.35, 0.9, 2.0), (0, 0, 1.35), st)]
    p += vtext('湯築城跡', 0.2, (0.18, 0, 2.05), '+X', ink)
    return join(p, 'sekihi', smooth_angle=30)


def build_stage10():
    return [buke_house(), buke_kura(), dobei(), dobei_gate(), azumaya(), sekihi()]



# ======================================================================
# 第11段: 漁港（魚市場・網・浮き玉・トロ箱・ドラム缶・漁協）
# ======================================================================
def crate_stack(p, x, y, n, col, m2):
    for k in range(n):
        p.append(box('crate', (0.62, 0.42, 0.24), (x, y, 0.12 + k * 0.25), col))
        p.append(box('rim', (0.64, 0.44, 0.03), (x, y, 0.23 + k * 0.25), m2))


def fish_market():
    """魚市場の上屋（24×12m、柱だけで壁なし、鋼板の切妻屋根）。長手 X、海側 -Y。中にトロ箱の山。"""
    m = M()
    col = mat('SP_MarketCol', '#5a7a92', metal=0.5, rough=0.45)
    roof = mat('SP_MarketRoof', '#c8ccc8', metal=0.5, rough=0.5)
    blue = mat('SP_Toro', '#2a6ab8', rough=0.5)
    white = mat('SP_Styro', '#f2f2ee', rough=0.8)
    p = [box('slab', (24.4, 12.4, 0.12), (0, 0, 0.06), m['conc'])]
    for x in (-12, -6, 0, 6, 12):
        for y in (-6, 6):
            p.append(box('col', (0.35, 0.35, 5.0), (x, y, 2.5), col))
    p.append(box('beam', (24.4, 0.3, 0.4), (0, -6, 5.1), col)); p.append(box('beam', (24.4, 0.3, 0.4), (0, 6, 5.1), col))
    p.append(prism('roof', [(-7.2, 5.2), (7.2, 5.2), (0, 6.6)], -12.6, 12.6, roof, axis='X'))
    sign = mat('SP_MarketSign', '#f2f2ea', rough=0.4)
    p.append(box('signb', (6.0, 0.12, 1.1), (0, 6.2, 4.4), sign))
    p.append(text3d('t', '魚市場', 0.7, (0, 6.27, 4.4), '+Y', m['blue']))
    p.append(text3d('t2', '魚市場', 0.7, (0, -6.2, 4.55), '-Y', m['blue']))
    rr = random.Random(11)
    for i in range(9):
        x, y = -9 + (i % 3) * 7 + rr.uniform(-1, 1), -3 + (i // 3) * 3 + rr.uniform(-0.5, 0.5)
        for dx in (-0.35, 0.35):
            crate_stack(p, x + dx, y, 2 + int(rr.random() * 3), blue if rr.random() < 0.7 else white, white)
    return join(p, 'fish_market', smooth_angle=30)


def net_pile():
    """漁網の山（緑の網に橙の浮き）。約2.6×1.6m。"""
    net = mat('SP_Net', '#2f6a4a', rough=0.95)
    flo = mat('SP_Float', '#f07a1a', rough=0.5)
    p = [sphere('pile', 1.0, (0, 0, 0.25), net, seg=14, rings=8, scale=(1.35, 0.85, 0.55))]
    for k in range(9):
        a = k / 9 * math.tau
        p.append(sphere('f', 0.12, (math.cos(a) * 1.2, math.sin(a) * 0.72, 0.42 + 0.12 * math.sin(a * 2)), flo, seg=8, rings=5))
    return join(p, 'net_pile', smooth_angle=50)


def buoy_stack():
    """浮き玉の山（橙・白）を木のパレットの上に。"""
    m = M()
    o = mat('SP_BuoyO', '#f07a1a', rough=0.45)
    w = mat('SP_BuoyW', '#f2f2ee', rough=0.5)
    wood = mat('SP_Pallet', '#9a7a50', rough=0.8)
    p = [box('pallet', (1.2, 1.0, 0.14), (0, 0, 0.07), wood)]
    rr = random.Random(5)
    for lay, n in ((0, 3), (1, 2), (2, 1)):
        for i in range(n):
            for j in range(n):
                off = (3 - n) * 0.19
                p.append(sphere('b', 0.19, (-0.38 + off + i * 0.38, -0.3 + off * 0.8 + j * 0.3, 0.33 + lay * 0.31), o if rr.random() < 0.65 else w, seg=10, rings=6))
    return join(p, 'buoy_stack', smooth_angle=50)


def fish_crates():
    """トロ箱（青・白）の積み上げ。"""
    blue = mat('SP_Toro', '#2a6ab8', rough=0.5)
    white = mat('SP_Styro', '#f2f2ee', rough=0.8)
    p = []
    rr = random.Random(9)
    for i in range(3):
        for j in range(2):
            crate_stack(p, -0.66 + i * 0.66, -0.23 + j * 0.46, 3 + int(rr.random() * 3), blue if (i + j) % 3 else white, white)
    return join(p, 'fish_crates', smooth_angle=30)


def drum_set():
    """ドラム缶3本。"""
    cols = [mat('SP_DrumB', '#2a5a9a', rough=0.5, metal=0.3), mat('SP_DrumR', '#a83a2a', rough=0.5, metal=0.3)]
    p = []
    for k, (x, y) in enumerate(((0, 0), (0.62, 0.1), (0.3, 0.6))):
        p.append(cyl('drum', 0.29, 0.88, (x, y, 0.44), cols[k % 2], verts=14))
        p.append(cyl('hoop', 0.3, 0.03, (x, y, 0.3), cols[k % 2], verts=14))
        p.append(cyl('hoop', 0.3, 0.03, (x, y, 0.6), cols[k % 2], verts=14))
    return join(p, 'drum_set', smooth_angle=40)


def gyokyo():
    """漁業協同組合の事務所（8×6m、2階建て）。入口 +Y。"""
    m = M()
    wall = mat('SP_GyoWall', '#e6e2d6', rough=0.8)
    glass = mat('NightGlow_Office', '#3a4a58', rough=0.1, emit='#ffffff', estr=0.0)
    p = [box('body', (8.0, 6.0, 6.4), (0, 0, 3.2), wall), box('roof', (8.4, 6.4, 0.25), (0, 0, 6.5), m['grey'])]
    for z in (1.5, 4.5):
        for x in (-2.6, 0, 2.6):
            p.append(box('win', (1.6, 0.06, 1.1), (x, 3.02, z), glass))
            p.append(box('winb', (1.6, 0.06, 1.1), (x, -3.02, z), glass))
    p.append(box('door', (1.6, 0.08, 2.1), (-2.6, 3.04, 1.05), m['dark']))
    p.append(box('signb', (5.0, 0.1, 0.7), (0.8, 3.08, 3.0), m['signw']))
    p.append(text3d('t', '漁業協同組合', 0.38, (0.8, 3.14, 3.0), '+Y', m['blue']))
    return join(p, 'gyokyo', smooth_angle=30)


def build_stage11():
    return [fish_market(), net_pile(), buoy_stack(), fish_crates(), drum_set(), gyokyo()]



# ======================================================================
# 第12段: 緑（雑草・植え込み・庭木）
# ======================================================================
def weed(name, seed, tall=0.45, dry=False):
    """雑草の株（細い葉の束）。当たり判定なし。"""
    rr = random.Random(seed)
    cols = [mat('SP_WeedA', '#5f7f3a', rough=0.9), mat('SP_WeedB', '#7a8f45', rough=0.9), mat('SP_WeedC', '#9a9a5a', rough=0.95)]
    p = []
    for k in range(9):
        a = rr.random() * math.tau
        h = tall * rr.uniform(0.55, 1.1)
        lean = rr.uniform(0.15, 0.45)
        bm = bmesh.new()
        w = rr.uniform(0.025, 0.045)
        bx, by = math.cos(a) * rr.uniform(0, 0.1), math.sin(a) * rr.uniform(0, 0.1)
        tx, ty = bx + math.cos(a) * lean * h, by + math.sin(a) * lean * h
        px, py = -math.sin(a) * w, math.cos(a) * w
        v = [bm.verts.new((bx - px, by - py, 0)), bm.verts.new((bx + px, by + py, 0)), bm.verts.new((tx, ty, h))]
        bm.faces.new(v)
        c = cols[2] if (dry and rr.random() < 0.6) else cols[rr.randrange(2)]
        p.append(mesh_from_bm('blade', bm, [c]))
    return join(p, name, smooth_angle=None)


def shrub(name, seed, r, col, flower=None):
    """植え込みの低木（ツツジ・サツキなど）。"""
    leaf = mat('SP_Shrub_' + name, col, rough=0.85)
    p = [bush('b', 0, 0, r * 0.75, r, leaf, seed)]
    if flower:
        fl = mat('SP_Flower_' + name, flower, rough=0.6)
        rr = random.Random(seed)
        for k in range(40):   # 上半分の表面に花
            a, el = rr.random() * math.tau, rr.uniform(-0.15, 1.2)
            d = Vector((math.cos(a) * math.cos(el) * 1.15, math.sin(a) * math.cos(el), math.sin(el) * 0.85)) * r * 0.98
            p.append(sphere('f', 0.05, (d.x, d.y, r * 0.75 + d.z), fl, seg=6, rings=4))
    return join(p, name, smooth_angle=60)


def niwaki():
    """庭木の松（仕立て松: 曲がった幹に丸い葉の玉）。"""
    bark = mat('SP_PineBark', '#5a4232', rough=0.9)
    leaf = mat('SP_PineLeaf', '#2e4a2a', rough=0.85)
    p = []
    pts = [(0, 0, 0), (0.15, 0.05, 0.8), (-0.1, 0.1, 1.6), (0.25, -0.05, 2.4), (0.1, 0.0, 3.0)]
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        d = b - a
        o = cyl('t', 0.13 - i * 0.022, d.length, ((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), bark, verts=7)
        o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
        p.append(o)
    for k, (x, y, z, r) in enumerate(((0.9, 0.2, 1.7, 0.55), (-0.8, 0.3, 2.2, 0.5), (0.35, -0.6, 2.7, 0.45), (0.1, 0.0, 3.25, 0.5), (0.6, 0.5, 2.9, 0.35))):
        o = bush('pad', 0, 0, 0, r, leaf, 30 + k)   # 原点で平たくしてから枝先へ
        o.data.transform(Matrix.Diagonal((1.35, 1.35, 0.55, 1.0)))
        o.data.transform(Matrix.Translation((x, y, z)))
        p.append(o)
    return join(p, 'niwaki', smooth_angle=60)


def build_stage12():
    return [weed('weed_a', 3), weed('weed_b', 8, 0.65, dry=True), shrub('shrub_a', 4, 0.6, '#3e6a32'),
            shrub('shrub_b', 6, 0.5, '#456e36', flower='#e86aa8'), niwaki()]



# ======================================================================
# 第13段: 建物の外まわり（竪樋・メーター・外階段・テナント看板・洗濯物）
# ======================================================================
def drainpipe():
    """竪樋（高さ1mの単位。配置時に建物の高さへ縦に伸ばす）。壁は -X 側、+X が外。"""
    pm = mat('SP_Pipe', '#b8b4a8', rough=0.5)
    return join([cyl('pipe', 0.05, 1.0, (0.08, 0, 0.5), pm, verts=8)], 'drainpipe', smooth_angle=60)


def meter_box():
    """電気・ガスのメーター（壁付け）。+X が外。"""
    m = M()
    p = [box('elec', (0.14, 0.3, 0.42), (0.07, -0.2, 1.35), mat('SP_Meter', '#d8d8d2', rough=0.5)),
         box('glass', (0.02, 0.22, 0.16), (0.15, -0.2, 1.42), mat('SP_MeterGlass', '#2a3440', rough=0.1)),
         box('gas', (0.18, 0.26, 0.3), (0.09, 0.25, 1.05), mat('SP_GasMeter', '#c8c4b8', rough=0.5)),
         cyl('gaspipe', 0.025, 1.0, (0.06, 0.25, 0.5), mat('SP_GasPipe', '#d8c25a', rough=0.5), verts=6)]
    return join(p, 'meter_box', smooth_angle=30)


def stair_flight():
    """アパートの鉄骨外階段（1階分: 高さ2.8m）。壁は X=0、外へ +X に幅1m。Y=-2.0→+2.0 で上り、+Y 側に踊り場。"""
    st = mat('SP_StairSteel', '#6a7a86', metal=0.5, rough=0.5)
    tread = mat('SP_StairTread', '#8a8e90', metal=0.4, rough=0.6)
    p = []
    n = 14
    for i in range(n):
        y = -2.0 + 4.0 * (i + 0.5) / n
        p.append(box('tread', (1.0, 4.0 / n + 0.02, 0.05), (0.6, y, 2.8 * (i + 1) / n), tread))
    ang = math.atan2(2.8, 4.0)
    for x in (0.1, 1.1):
        o = box('stringer', (0.06, math.hypot(4.0, 2.8) + 0.1, 0.22), (x, 0, 1.4), st)
        o.rotation_euler = (ang, 0, 0)
        p.append(o)
    p.append(box('landing', (1.0, 1.3, 0.08), (0.6, 2.65, 2.8), tread))
    for (x, y) in ((1.1, 2.0), (1.1, 3.3)):
        p.append(box('post', (0.06, 0.06, 3.9), (x, y, 1.95), st))
    o = box('rail', (0.04, math.hypot(4.0, 2.8), 0.04), (1.12, 0, 2.4), st); o.rotation_euler = (ang, 0, 0); p.append(o)
    p.append(box('lrail', (0.04, 1.3, 0.04), (1.12, 2.65, 3.8), st))
    return join(p, 'stair_flight', smooth_angle=30)


TENANTS = [('tenant_a', ['喫茶 みかん', '歯科', '英会話', '学習塾', '司法書士']), ('tenant_b', ['不動産', 'ネイル', '整骨院', 'カラオケ', '居酒屋']),
           ('tenant_c', ['美容室', '税理士', 'ヨガ', '眼科', '保険'])]


def tenant_sign(name, labels):
    """ビルの縦型テナント看板（袖看板、高さ約7.5m）。壁から +X へ突き出し、文字は ±Y の面。"""
    m = M()
    cols = ['#f2f2ea', '#2a5aa8', '#c83a2a', '#f2c23a', '#2a8a5a', '#6a3a8a']
    frame = mat('SP_TenantFrame', '#3a3e44', metal=0.5, rough=0.4)
    lit = mat('NightGlow_Sign_' + name, '#f2f2ea', rough=0.4, emit='#ffffff', estr=0.0)
    p = [box('frame', (1.3, 0.3, 7.6), (0.75, 0, 3.8), frame)]
    rr = random.Random(len(name) * 7 + ord(name[-1]))
    for k, lab in enumerate(labels):
        z = 0.75 + k * 1.45
        bg = mat('SP_Ten_%s_%d' % (name, k), cols[1 + rr.randrange(len(cols) - 1)], rough=0.4)   # 白文字の段は色地にする
        p.append(box('panel', (1.15, 0.32, 1.3), (0.75, 0, z), bg if k % 2 else lit))
        ink = m['black'] if k % 2 == 0 else m['signw']
        for f, y in (('+Y', 0.165), ('-Y', -0.165)):
            p.append(text3d('t', lab, 0.2 if len(lab) <= 4 else 0.15, (0.75, y, z), f, ink))
            p.append(text3d('f', '%dF' % (k + 1), 0.13, (0.75, y, z + 0.47), f, ink))
    return join(p, name, smooth_angle=30)


def laundry():
    """ベランダの物干し（竿と洗濯物）。竿は Y 方向、+X が外。"""
    m = M()
    pole = mat('SP_LaundryPole', '#c8ccd0', metal=0.6, rough=0.4)
    p = [cyl('pole', 0.018, 1.9, (0.5, 0, 1.55), pole, verts=6, axis='Y')]
    for y in (-0.85, 0.85):
        p.append(cyl('stand', 0.015, 1.55, (0.5, y, 0.78), pole, verts=5))
    cols = ['#f2f2ee', '#5a8ad8', '#e86a6a', '#f2d24a', '#7a9a5a', '#d8a8c8']
    rr = random.Random(21)
    y = -0.7
    while y < 0.7:
        w = rr.uniform(0.25, 0.45)
        h = rr.uniform(0.45, 0.8)
        p.append(box('cloth', (0.02, w, h), (0.5, y + w / 2, 1.55 - h / 2), mat('SP_Cloth%d' % (int(y * 10) % 6), cols[rr.randrange(len(cols))], rough=0.9)))
        y += w + 0.06
    return join(p, 'laundry', smooth_angle=30)


def build_stage13():
    return [drainpipe(), meter_box(), stair_flight()] + [tenant_sign(n, l) for n, l in TENANTS] + [laundry()]



# ======================================================================
# 第14段: 空き地（金網フェンス・売地の看板）
# ======================================================================
def mesh_fence():
    """金網フェンス 2m（高さ1.5m）。長手 X（0→2）、柱は x=0。"""
    post = mat('SP_FencePost', '#3e5a3e', metal=0.5, rough=0.5)
    net = mat('SP_FenceNet', '#5a6a5a', metal=0.5, rough=0.5, alpha=0.4)
    p = [cyl('post', 0.03, 1.55, (0, 0, 0.775), post, verts=8), box('top', (2.0, 0.04, 0.04), (1.0, 0, 1.5), post),
         box('bot', (2.0, 0.03, 0.03), (1.0, 0, 0.08), post), box('net', (2.0, 0.01, 1.38), (1.0, 0, 0.8), net)]
    return join(p, 'mesh_fence', smooth_angle=30)


def urichi_sign():
    """売地の看板（2本足の板）。文字は +X 面。"""
    m = M()
    p = [cyl('leg', 0.03, 1.6, (0, -0.55, 0.8), m['steel'], verts=6), cyl('leg', 0.03, 1.6, (0, 0.55, 0.8), m['steel'], verts=6),
         box('board', (0.03, 1.4, 0.9), (0, 0, 1.45), m['signw'])]
    p.append(box('band', (0.035, 1.4, 0.25), (0.002, 0, 1.78), m['red']))
    p.append(text3d('t', '売地', 0.32, (0.02, 0, 1.45), '+X', m['red']))
    p.append(text3d('t2', 'みかん不動産', 0.1, (0.02, 0, 1.13), '+X', m['black']))
    return join(p, 'urichi_sign', smooth_angle=30)


def build_stage14():
    return [mesh_fence(), urichi_sign()]


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
    roots1 = build_stage1()
    roots2 = build_stage2()
    roots3 = build_stage3()
    roots5 = build_stage5()
    roots6 = build_stage6()
    roots7 = build_stage7()
    roots8 = build_stage8()
    roots9 = build_stage9()
    roots10 = build_stage10()
    roots11 = build_stage11()
    roots12 = build_stage12()
    roots13 = build_stage13()
    roots14 = build_stage14()
    roots = roots1 + roots2 + roots3 + roots5 + roots6 + roots7 + roots8 + roots9 + roots10 + roots11 + roots12 + roots13 + roots14
    export_glb(os.path.join(ASSETS, 'glb', 'street.glb'), roots)
    only = argv_after()
    def away():
        for o in roots:
            o.location = (0, 200, 0)
    for tag, grp, kw in (('5', roots5, dict(cols=8, gap=3.2, big=('gs_canopy', 'gs_office', 'gs_sign', 'fishing_boat', 'catenary_pole', 'crossing_arm', 'park_toilet'))),
                         ('3', roots3, dict(cols=9, gap=2.2, big=('karakuri_clock', 'container_a', 'container_b', 'container_c', 'container_d'))),
                         ('2', roots2, dict(cols=8, gap=2.0, big=('parking_sign',))),
                         ('1', roots1, dict(big=('guide_gantry', 'tram_stop')))):
        if only and tag not in only:
            continue
        away()
        layout_preview(grp, os.path.join(PREV, 'street%s.png' % tag), **kw)
    if only and '13' in only:
        away()
        for i, o in enumerate(roots13):
            o.location = (i * 2.6 - 9, 0, 0)
        preview(os.path.join(PREV, 'street13.png'), target=(0, 0, 3), dist=20, elev=12, azim=-60, lens=45, res=(1400, 800), samples=48)
    if only and '12' in only:
        away()
        for i, o in enumerate(roots12):
            o.location = (i * 2.4 - 5, 0, 0)
        preview(os.path.join(PREV, 'street12.png'), target=(0, 0, 1.0), dist=10, elev=14, azim=-70, lens=45, res=(1200, 700), samples=48)
    if only and '11' in only:
        away()
        for i, o in enumerate(roots11):
            o.location = ((i % 3) * 16 - 16, (i // 3) * 16 - 4, 0)
        preview(os.path.join(PREV, 'street11.png'), target=(0, 4, 2), dist=48, elev=24, azim=-55, lens=45, res=(1400, 800), samples=48)
    if only and '10' in only:
        away()
        for i, o in enumerate(roots10):
            o.location = ((i % 3) * 13 - 13, (i // 3) * 12 - 4, 0)
        preview(os.path.join(PREV, 'street10.png'), target=(0, 3, 2), dist=40, elev=22, azim=-55, lens=45, res=(1400, 800), samples=48)
    if only and '9' in only:
        away()
        for i, o in enumerate(roots9):
            o.location = ((i % 6) * 4.5 - 11, (i // 6) * 14 - 6, 0)
        preview(os.path.join(PREV, 'street9.png'), target=(0, 2, 3), dist=34, elev=14, azim=-60, lens=45, res=(1400, 800), samples=48)
    if only and '8' in only:
        away()
        for i, o in enumerate(roots8):
            o.location = (i * 5.0 - 5, 0, 1.2 if o.name == 'tetrapod' else 0)
        preview(os.path.join(PREV, 'street8.png'), target=(0, 0, 4), dist=24, elev=14, azim=-70, lens=45, res=(1200, 800), samples=48)
    if not only or 'big' in only:
        away()
        bpy.data.objects['karakuri_clock'].location = (-4, 0, 0)
        for i, n in enumerate(('container_a', 'container_b', 'container_c', 'container_d')):
            bpy.data.objects[n].location = (6, -6 + i * 2.6, 0 if i < 3 else 2.6)
        bpy.data.objects['container_d'].location = (6, -3.4, 2.6)
        preview(os.path.join(PREV, 'street3b.png'), target=(2, -2, 3), dist=22, elev=16, azim=-120, lens=40, res=(1400, 800), samples=48)
