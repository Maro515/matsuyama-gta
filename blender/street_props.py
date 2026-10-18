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
    t = bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.018, major_segments=20, minor_segments=4,
                                         location=(x, 0, r + 0.018), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    o.data.materials.append(m_tire)
    parts.append(o)
    parts.append(cyl('rim', r - 0.02, 0.012, (x, 0, r + 0.018), m_rim, verts=24, axis='Y', cap=False))
    for k in range(6):
        a = k / 6 * math.pi
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
        o = cyl('t', rad, d.length, (0, 0, 0), mm, verts=8)
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
    p.append(sphere('lamp', 0.04, (0.7, 0, 0.6), chrome, seg=10, rings=6))
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
    roots = roots1 + roots2 + roots3
    export_glb(os.path.join(ASSETS, 'glb', 'street.glb'), roots)
    only = argv_after()
    def away():
        for o in roots:
            o.location = (0, 200, 0)
    for tag, grp, kw in (('3', roots3, dict(cols=9, gap=2.2, big=('karakuri_clock', 'container_a', 'container_b', 'container_c', 'container_d'))),
                         ('2', roots2, dict(cols=8, gap=2.0, big=('parking_sign',))),
                         ('1', roots1, dict(big=('guide_gantry', 'tram_stop')))):
        if only and tag not in only:
            continue
        away()
        layout_preview(grp, os.path.join(PREV, 'street%s.png' % tag), **kw)
    if not only or 'big' in only:
        away()
        bpy.data.objects['karakuri_clock'].location = (-4, 0, 0)
        for i, n in enumerate(('container_a', 'container_b', 'container_c', 'container_d')):
            bpy.data.objects[n].location = (6, -6 + i * 2.6, 0 if i < 3 else 2.6)
        bpy.data.objects['container_d'].location = (6, -3.4, 2.6)
        preview(os.path.join(PREV, 'street3b.png'), target=(2, -2, 3), dist=22, elev=16, azim=-120, lens=40, res=(1400, 800), samples=48)
