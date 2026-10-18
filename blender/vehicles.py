"""乗り物モデル（セダン・軽・タクシー・パトカー・スポーツ・トラック・バス・原付）。
+X が前方、原点は車体中心の地面。ホイールは wheel_FL/FR/RL/RR（車軸はY方向）。
実行: Blender -b --factory-startup -P vehicles.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *


def MATS():
    return dict(
        paint=mat('Paint', '#c8ccd2', metal=0.55, rough=0.28, coat=1.0, coat_rough=0.04),
        glass=mat('Glass', '#0e151b', rough=0.03, spec=1.0),
        trim=mat('Trim', '#141516', rough=0.55),
        black=mat('Black', '#0b0b0c', rough=0.8),
        chrome=mat('Chrome', '#d6d9dc', metal=1.0, rough=0.12),
        tire=mat('Tire', '#161718', rough=0.88),
        rim=mat('Rim', '#b9bdc2', metal=0.95, rough=0.22),
        head=mat('HeadLight', '#e6edf2', metal=0.3, rough=0.08, emit='#fff6e0', estr=0.2),
        tail=mat('TailLight', '#7a0b0b', rough=0.2, emit='#ff1a0a', estr=0.1),
        amber=mat('Amber', '#c86a08', rough=0.25, emit='#ff8a10', estr=0.05),
        plate=mat('Plate', '#f2f2ea', rough=0.4),
        plate_txt=mat('PlateText', '#2a6a3a', rough=0.5),
        interior=mat('Interior', '#2a2b2e', rough=0.9),
    )


# ---------- 車体 ----------
def body_from_profile(name, prof, W, belt, top, taper=0.16, nose_round=0.45, m=None, arch=None, arch_mat=None):
    """側面シルエット prof(XZ)をY方向に押し出し、キャビンを絞り、前後を丸める。"""
    o = prism(name, prof, -W / 2, W / 2, m, axis='Y')
    xs = [p[0] for p in prof]
    xmin, xmax = min(xs), max(xs)
    me = o.data
    for v in me.vertices:
        x, y, z = v.co
        k = 1.0
        if z > belt:
            k *= 1 - taper * min(1, (z - belt) / max(0.01, top - belt))
        # 平面視で前後の角を丸める
        e = max(0.0, max(x - (xmax - nose_round), (xmin + nose_round) - x)) / nose_round
        k *= 1 - 0.09 * e * e
        v.co.y = y * k
    add_mod(o, 'BEVEL', width=0.045, segments=3, limit_method='ANGLE', angle_limit=math.radians(32))
    if arch:
        for (ax, r) in arch:
            c = cyl('arch', r, W + 0.4, (ax, 0, 0.0 + r * 0.92), arch_mat, verts=28, axis='Y')
            c.hide_render = True
            bo = add_mod(o, 'BOOLEAN', operation='DIFFERENCE', object=c, solver='EXACT')
            try:
                bo.material_mode = 'TRANSFER'
            except Exception:
                pass
    bake(o)
    for c in [ob for ob in bpy.context.scene.objects if ob.name.startswith('arch')]:
        bpy.data.objects.remove(c, do_unlink=True)
    return o


def split_paint(o, z, m_hi, xr=None):
    """車体を高さ z で水平に切断し、上側の塗装面（material 0）を m_hi に塗り分ける。"""
    me = o.data
    me.materials.append(m_hi)
    idx = len(me.materials) - 1
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    for f in bm.faces:
        c = f.calc_center_median()
        if f.material_index == 0 and c.z > z and (xr is None or xr[0] < c.x < xr[1]):
            f.material_index = idx
    bm.to_mesh(me)
    bm.free()


def taper_y(z, W, belt, top, taper):
    k = 1.0
    if z > belt:
        k = 1 - taper * min(1, (z - belt) / max(0.01, top - belt))
    return W / 2 * k


def glass_side(name, poly, W, belt, top, taper, m, side=1, off=0.008):
    bm = bmesh.new()
    vs = [bm.verts.new((x, side * (taper_y(z, W, belt, top, taper) + off), z)) for (x, z) in poly]
    f = bm.faces.new(vs if side > 0 else list(reversed(vs)))
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    o = mesh_from_bm(name, bm, [m])
    # 外向きに
    o.data.update()
    if (o.data.polygons[0].normal.y * side) < 0:
        o.data.flip_normals()
    return o


def glass_quad(name, a, b, W, belt, top, taper, m, inset=0.06, off=0.01, outward=(1, 0)):
    """フロント/リアガラス。a=(x,z)下端, b=(x,z)上端。"""
    ya = taper_y(a[1], W, belt, top, taper) - inset
    yb = taper_y(b[1], W, belt, top, taper) - inset
    # 面の法線（XZ平面内）に沿って少し浮かす
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    nx, nz = dz / L, -dx / L
    if nx * outward[0] + nz * outward[1] < 0:
        nx, nz = -nx, -nz
    ax, az = a[0] + nx * off, a[1] + nz * off
    bx, bz = b[0] + nx * off, b[1] + nz * off
    bm = bmesh.new()
    v = [bm.verts.new((ax, -ya, az)), bm.verts.new((ax, ya, az)), bm.verts.new((bx, yb, bz)), bm.verts.new((bx, -yb, bz))]
    f = bm.faces.new(v)
    o = mesh_from_bm(name, bm, [m])
    o.data.update()
    n = o.data.polygons[0].normal
    if n.x * outward[0] + n.z * outward[1] < 0:
        o.data.flip_normals()
    return o


def poly_inset(poly, d):
    """凸多角形を重心へ向けて d だけ縮める。"""
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)
    out = []
    for (x, z) in poly:
        dx, dz = cx - x, cz - z
        L = math.hypot(dx, dz) or 1.0
        out.append((x + dx / L * d, z + dz / L * d))
    return out


def slab_cutter(name, a, b, W, belt, top, taper, inset, outward, depth, m):
    """前後ガラスの裏をくり抜く板（ガラス面から外へ 6cm・内へ depth）。"""
    ya = taper_y(a[1], W, belt, top, taper) - inset
    yb = taper_y(b[1], W, belt, top, taper) - inset
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    nx, nz = dz / L, -dx / L
    if nx * outward[0] + nz * outward[1] < 0:
        nx, nz = -nx, -nz
    ux, uz = dx / L, dz / L
    a2 = (a[0] + ux * 0.03, a[1] + uz * 0.03)
    b2 = (b[0] - ux * 0.03, b[1] - uz * 0.03)
    bm = bmesh.new()
    vs = []
    for (px, pz), yy in ((a2, ya), (b2, yb)):
        for sg in (-1, 1):
            for off in (0.06, -depth):
                vs.append(bm.verts.new((px + nx * off, sg * yy, pz + nz * off)))
    bmesh.ops.convex_hull(bm, input=vs)
    return mesh_from_bm(name, bm, [m])


def hollow_cabin(body, sp, W, belt, top, taper, M, wsh=None, rgl=None, wsh_depth=0.28, rgl_depth=0.28):
    """窓の形で車体をくり抜いて車内を空にする（切り口は内装色）。窓越しに運転手と座席が見える。
    sp: 側面ガラスの多角形(XZ)、wsh/rgl: ((x,z)下端, (x,z)上端, 外向き, ガラスの内寄せ)"""
    cuts = [prism('cab_cut', poly_inset(sp, 0.025), -W / 2 - 0.3, W / 2 + 0.3, M['interior'], axis='Y')]
    if wsh:
        cuts.append(slab_cutter('wsh_cut', wsh[0], wsh[1], W, belt, top, taper, wsh[3] + 0.025, wsh[2], wsh_depth, M['interior']))
    if rgl:
        cuts.append(slab_cutter('rgl_cut', rgl[0], rgl[1], W, belt, top, taper, rgl[3] + 0.025, rgl[2], rgl_depth, M['interior']))
    for c in cuts:
        c.hide_render = True
        bo = add_mod(body, 'BOOLEAN', operation='DIFFERENCE', object=c, solver='EXACT')
        try:
            bo.material_mode = 'TRANSFER'
        except Exception:
            pass
    bake(body)
    for c in cuts:
        bpy.data.objects.remove(c, do_unlink=True)


def cabin_seats(sp, wsh, rgl, W, M, wheel_z=None):
    """前席の背もたれ・ヘッドレストとハンドル。運転席の頭の位置はゲーム側（20_dyn seatOf）と同じ求め方"""
    xs = [p[0] for p in sp] + [wsh[0][0], wsh[1][0]] + ([rgl[0][0], rgl[1][0]] if rgl else [])
    gmin, gmax = min(xs), max(xs)
    zs = [p[1] for p in sp]
    zmid = (min(zs) + max(zs)) / 2
    xh = max(gmin + 0.3, gmax - 1.15)
    parts = []
    for sg in (1, -1):
        y = sg * W * 0.2
        parts.append(box('seat', (0.12, 0.46, 0.62), (xh - 0.26, y, zmid - 0.42), M['interior'], bevel=0.03))
        parts.append(box('hrest', (0.1, 0.26, 0.18), (xh - 0.27, y, zmid + 0.02), M['interior'], bevel=0.03))
    parts.append(cyl('steer', 0.17, 0.035, (xh + 0.42, -W * 0.2, wheel_z if wheel_z else zmid - 0.2), M['black'], verts=16, axis='X'))
    return parts


def wheel(name, x, y, r, w, M, dual=False):
    parts = []
    t = cyl(name + '_tire', r, w, (0, 0, 0), M['tire'], verts=28, axis='Y')
    add_mod(t, 'BEVEL', width=r * 0.18, segments=3, limit_method='ANGLE', angle_limit=math.radians(40))
    parts.append(t)
    side = 1 if y > 0 else -1
    rim = cyl(name + '_rim', r * 0.66, 0.02, (0, side * (w / 2 + 0.002), 0), M['rim'], verts=24, axis='Y')
    parts.append(rim)
    hub = cyl(name + '_hub', r * 0.18, 0.03, (0, side * (w / 2 + 0.01), 0), M['chrome'], verts=12, axis='Y')
    parts.append(hub)
    for k in range(5):
        a = k / 5 * math.tau
        s = box(name + '_slot', (r * 0.14, 0.012, r * 0.32), (math.cos(a) * r * 0.4, side * (w / 2 + 0.008), math.sin(a) * r * 0.4), M['black'],
                rot=('Y', -a + math.pi / 2))
        parts.append(s)
    if dual:
        t2 = cyl(name + '_tire2', r, w, (0, -side * w * 0.95, 0), M['tire'], verts=28, axis='Y')
        parts.append(t2)
    o = join(parts, name, smooth_angle=50)
    set_origin(o, (0, 0, 0))
    o.location = (x, y, r)
    return o


def lamp_pair(name, x, z, y, sx, sy, sz, m, rot=0):
    a = box(name, (sx, sy, sz), (x, y, z), m, bevel=0.015, rot=('Y', rot) if rot else None)
    b = box(name, (sx, sy, sz), (x, -y, z), m, bevel=0.015, rot=('Y', rot) if rot else None)
    return [a, b]


def plates(x_front, z_front, x_rear, z_rear, M):
    o = []
    for (x, z, s) in ((x_front, z_front, 1), (x_rear, z_rear, -1)):
        o.append(box('plate', (0.02, 0.33, 0.165), (x + s * 0.012, 0, z), M['plate']))
        o.append(box('plate_t', (0.005, 0.24, 0.06), (x + s * 0.024, 0, z - 0.02), M['plate_txt']))
    return o


def mirrors(x, z, y, M, paint):
    o = []
    for s in (1, -1):
        o.append(box('mir', (0.12, 0.16, 0.1), (x, s * (y + 0.1), z), paint, bevel=0.02))
        o.append(box('mirarm', (0.05, 0.1, 0.03), (x + 0.02, s * (y + 0.02), z - 0.03), M['trim']))
    return o


def door_lines(xs, z0, z1, W, belt, M):
    o = []
    for x in xs:
        for s in (1, -1):
            o.append(box('seam', (0.012, 0.004, z1 - z0), (x, s * (W / 2 + 0.002), (z0 + z1) / 2), M['trim']))
    return o


def handles(xs, z, W, M):
    o = []
    for x in xs:
        for s in (1, -1):
            o.append(box('hdl', (0.16, 0.025, 0.035), (x, s * (W / 2 + 0.012), z), M['chrome'], bevel=0.008))
    return o


def finish(name, parts, wheels):
    root = empty(name)
    body = join(parts, name + '_body', smooth_angle=38)
    parent(body, root)
    for w in wheels:
        parent(w, root)
    return root


def sedan(name='sedan', taxi=False, police=False):
    M = MATS()
    paint = M['paint']
    if police:
        paint = mat('PaintBlack', '#101114', metal=0.4, rough=0.25, coat=1.0)
        white = mat('PaintWhite', '#f2f3f4', metal=0.2, rough=0.25, coat=1.0)
    L, W = 4.6, 1.80
    belt, top = 1.0, 1.45
    prof = [(-2.30, 0.28), (2.26, 0.28), (2.33, 0.42), (2.30, 0.70), (2.08, 0.84), (1.15, 0.97), (1.05, 1.00),
            (0.32, 1.44), (-0.72, 1.45), (-1.32, 1.01), (-2.02, 0.97), (-2.26, 0.86), (-2.34, 0.55)]
    if taxi:   # クラウンコンフォート風の角ばったセダン
        prof = [(-2.30, 0.28), (2.26, 0.28), (2.32, 0.45), (2.30, 0.78), (2.12, 0.86), (1.12, 0.96), (0.98, 1.00),
                (0.42, 1.48), (-0.85, 1.49), (-1.32, 1.02), (-2.12, 0.98), (-2.28, 0.88), (-2.33, 0.55)]
    arches = [(1.38, 0.38), (-1.32, 0.38)]
    body = body_from_profile('body', prof, W, belt, top, 0.17, 0.5, paint, arches, M['black'])
    parts = [body]
    if police:
        split_paint(body, 0.74, white, (-1.28, 1.1))
    gl = M['glass']
    side_poly = [(-1.22, 1.03), (0.98, 1.03), (0.33, 1.40), (-0.68, 1.41)]
    wsh, rgl = ((1.03, 1.03), (0.34, 1.41), (1, 1), 0.06), ((-1.28, 1.04), (-0.70, 1.41), (-1, 1), 0.06)
    hollow_cabin(body, side_poly, W, belt, top, 0.17, M, wsh, rgl)
    parts += cabin_seats(side_poly, wsh, rgl, W, M)
    parts += [glass_side('gls', side_poly, W, belt, top, 0.17, gl, 1), glass_side('gls', side_poly, W, belt, top, 0.17, gl, -1)]
    parts.append(glass_quad('wsh', (1.03, 1.03), (0.34, 1.41), W, belt, top, 0.17, gl, outward=(1, 1)))
    parts.append(glass_quad('rgl', (-1.28, 1.04), (-0.70, 1.41), W, belt, top, 0.17, gl, outward=(-1, 1)))
    for s in (1, -1):
        parts.append(box('bpil', (0.09, 0.012, 0.36), (-0.12, s * (taper_y(1.2, W, belt, top, 0.17) + 0.012), 1.2), M['trim'], rot=('X', s * math.atan(0.17 * W / 2 / 0.45))))
    parts += door_lines([1.02, -0.12, -1.25], 0.36, 0.98, W, belt, M)
    parts += handles([0.55, -0.62], 0.88, W, M)
    parts += lamp_pair('head', 2.2, 0.74, 0.62, 0.18, 0.36, 0.13, M['head'], rot=0.35)
    parts += lamp_pair('tail', -2.27, 0.78, 0.6, 0.12, 0.42, 0.14, M['tail'], rot=-0.3)
    parts += lamp_pair('turn', 2.24, 0.62, 0.78, 0.08, 0.14, 0.06, M['amber'])
    parts.append(box('grille', (0.06, 0.9, 0.16), (2.3, 0, 0.66), M['trim'], bevel=0.01))
    parts.append(box('intake', (0.06, 1.1, 0.12), (2.31, 0, 0.42), M['black'], bevel=0.01))
    parts.append(box('diffuser', (0.08, 1.2, 0.1), (-2.31, 0, 0.38), M['black'], bevel=0.01))
    parts += plates(2.32, 0.5, -2.33, 0.62, M)
    parts += mirrors(0.95, 1.06, W / 2, M, paint)
    parts.append(box('under', (L - 0.5, W - 0.25, 0.08), (0, 0, 0.22), M['black']))
    if taxi:
        andon = mat('Andon', '#f4f1e6', rough=0.4, emit='#fff1c8', estr=0.3)
        parts.append(box('andon', (0.22, 0.5, 0.2), (-0.15, 0, 1.56), andon, bevel=0.03))
        parts.append(box('andon_b', (0.25, 0.3, 0.04), (-0.15, 0, 1.47), M['trim']))
    if police:
        sr = mat('SirenR', '#5a0808', rough=0.2, emit='#ff1010', estr=0.1)
        sb = mat('SirenB', '#081a5a', rough=0.2, emit='#2050ff', estr=0.1)
        parts.append(box('lbar', (0.3, 1.2, 0.06), (-0.15, 0, 1.47), M['trim'], bevel=0.01))
        parts.append(box('sirR', (0.26, 0.5, 0.12), (-0.15, 0.3, 1.55), sr, bevel=0.03))
        parts.append(box('sirB', (0.26, 0.5, 0.12), (-0.15, -0.3, 1.55), sb, bevel=0.03))
    wr, tw, tr = 0.33, 0.22, 0.78
    wheels = [wheel('wheel_FL', 1.38, tr, wr, tw, M), wheel('wheel_FR', 1.38, -tr, wr, tw, M),
              wheel('wheel_RL', -1.32, tr, wr, tw, M), wheel('wheel_RR', -1.32, -tr, wr, tw, M)]
    return finish(name, parts, wheels)


def kei(name='kei'):
    M = MATS()
    W, belt, top = 1.47, 1.0, 1.76
    prof = [(-1.70, 0.27), (1.66, 0.27), (1.71, 0.42), (1.70, 0.74), (1.52, 0.90), (1.24, 0.98), (1.14, 1.02),
            (0.55, 1.75), (-1.58, 1.77), (-1.70, 1.62), (-1.72, 0.55)]
    arches = [(1.12, 0.33), (-1.18, 0.33)]
    body = body_from_profile('body', prof, W, belt, top, 0.06, 0.35, M['paint'], arches, M['black'])
    parts = [body]
    gl = M['glass']
    sp = [(-1.55, 1.05), (1.08, 1.05), (0.56, 1.68), (-1.52, 1.69)]
    wsh, rgl = ((1.12, 1.05), (0.57, 1.69), (1, 1), 0.06), ((-1.71, 1.1), (-1.66, 1.62), (-1, 0), 0.06)
    hollow_cabin(body, sp, W, belt, top, 0.06, M, wsh, rgl)
    parts += cabin_seats(sp, wsh, rgl, W, M)
    parts += [glass_side('gls', sp, W, belt, top, 0.06, gl, 1), glass_side('gls', sp, W, belt, top, 0.06, gl, -1)]
    parts.append(glass_quad('wsh', (1.12, 1.05), (0.57, 1.69), W, belt, top, 0.06, gl, outward=(1, 1)))
    parts.append(glass_quad('rgl', (-1.71, 1.1), (-1.66, 1.62), W, belt, top, 0.06, gl, outward=(-1, 0)))
    for s in (1, -1):
        for x in (0.42, -0.62):
            parts.append(box('pil', (0.08, 0.012, 0.6), (x, s * (taper_y(1.36, W, belt, top, 0.06) + 0.012), 1.37), M['trim']))
    parts += door_lines([1.1, 0.42, -0.62], 0.35, 1.0, W, belt, M)
    parts.append(box('rail', (1.4, 0.02, 0.03), (-0.6, W / 2 * 0.99, 1.02), M['trim']))
    parts.append(box('rail', (1.4, 0.02, 0.03), (-0.6, -W / 2 * 0.99, 1.02), M['trim']))
    parts += lamp_pair('head', 1.62, 0.8, 0.5, 0.14, 0.34, 0.16, M['head'], rot=0.4)
    parts += lamp_pair('tail', -1.71, 1.05, 0.62, 0.06, 0.14, 0.5, M['tail'])
    parts.append(box('grille', (0.05, 0.7, 0.14), (1.70, 0, 0.68), M['trim'], bevel=0.01))
    parts += plates(1.71, 0.48, -1.72, 0.7, M)
    parts += mirrors(1.05, 1.08, W / 2, M, M['paint'])
    wheels = [wheel('wheel_FL', 1.12, 0.64, 0.29, 0.18, M), wheel('wheel_FR', 1.12, -0.64, 0.29, 0.18, M),
              wheel('wheel_RL', -1.18, 0.64, 0.29, 0.18, M), wheel('wheel_RR', -1.18, -0.64, 0.29, 0.18, M)]
    return finish(name, parts, wheels)


def sports(name='sports'):
    M = MATS()
    W, belt, top = 1.84, 0.88, 1.25
    prof = [(-2.20, 0.22), (2.18, 0.22), (2.25, 0.34), (2.22, 0.52), (1.95, 0.70), (1.0, 0.86), (0.85, 0.88),
            (0.05, 1.24), (-0.55, 1.25), (-1.65, 0.96), (-2.15, 0.90), (-2.24, 0.70), (-2.25, 0.45)]
    arches = [(1.35, 0.38), (-1.35, 0.39)]
    body = body_from_profile('body', prof, W, belt, top, 0.22, 0.55, M['paint'], arches, M['black'])
    parts = [body]
    gl = M['glass']
    sp = [(-1.05, 0.92), (0.8, 0.92), (0.07, 1.2), (-0.5, 1.21)]
    wsh, rgl = ((0.83, 0.92), (0.07, 1.21), (1, 1), 0.06), ((-1.55, 0.98), (-0.56, 1.22), (-1, 1), 0.06)
    hollow_cabin(body, sp, W, belt, top, 0.22, M, wsh, rgl)
    parts += cabin_seats(sp, wsh, rgl, W, M)
    parts += [glass_side('gls', sp, W, belt, top, 0.22, gl, 1), glass_side('gls', sp, W, belt, top, 0.22, gl, -1)]
    parts.append(glass_quad('wsh', (0.83, 0.92), (0.07, 1.21), W, belt, top, 0.22, gl, outward=(1, 1)))
    parts.append(glass_quad('rgl', (-1.55, 0.98), (-0.56, 1.22), W, belt, top, 0.22, gl, outward=(-1, 1)))
    parts += door_lines([0.85, -0.85], 0.3, 0.86, W, belt, M)
    parts += lamp_pair('head', 2.05, 0.62, 0.66, 0.3, 0.34, 0.07, M['head'], rot=0.5)
    parts += lamp_pair('tail', -2.21, 0.78, 0.58, 0.08, 0.5, 0.08, M['tail'])
    parts.append(box('intake', (0.06, 1.3, 0.16), (2.23, 0, 0.36), M['black'], bevel=0.01))
    parts.append(box('diff', (0.3, 1.4, 0.06), (-2.12, 0, 0.26), M['black']))
    # リアウイング
    parts.append(box('wing', (0.3, 1.6, 0.03), (-2.0, 0, 1.08), M['paint'], bevel=0.01))
    for s in (1, -1):
        parts.append(box('wingst', (0.12, 0.03, 0.16), (-2.0, s * 0.6, 0.98), M['black']))
    for s in (1, -1):
        parts.append(cyl('exh', 0.045, 0.12, (-2.25, s * 0.45, 0.32), M['chrome'], verts=12, axis='X'))
    parts += plates(2.24, 0.42, -2.25, 0.6, M)
    parts += mirrors(0.75, 0.95, W / 2, M, M['paint'])
    wheels = [wheel('wheel_FL', 1.35, 0.8, 0.34, 0.26, M), wheel('wheel_FR', 1.35, -0.8, 0.34, 0.26, M),
              wheel('wheel_RL', -1.35, 0.8, 0.34, 0.28, M), wheel('wheel_RR', -1.35, -0.8, 0.34, 0.28, M)]
    return finish(name, parts, wheels)


def truck(name='truck'):
    """2t箱型トラック（キャブ＝塗装色、荷箱＝アルミ）。全長6.2m。"""
    M = MATS()
    W = 1.9
    cab_prof = [(1.1, 0.42), (3.05, 0.42), (3.1, 0.6), (3.08, 1.25), (2.98, 2.05), (2.85, 2.25), (1.2, 2.28), (1.1, 2.1)]
    cab = body_from_profile('cab', cab_prof, W, 1.4, 2.28, 0.04, 0.3, M['paint'], [(2.38, 0.42)], M['black'])
    parts = [cab]
    gl = M['glass']
    parts.append(glass_quad('wsh', (3.08, 1.3), (2.94, 2.08), W, 1.4, 2.28, 0.04, gl, inset=0.1, outward=(1, 0)))
    sp = [(2.1, 1.35), (2.9, 1.35), (2.86, 2.0), (2.1, 2.05)]
    wsh = ((3.08, 1.3), (2.94, 2.08), (1, 0), 0.1)
    hollow_cabin(cab, sp, W, 1.4, 2.28, 0.04, M, wsh, None, wsh_depth=0.3)
    parts += cabin_seats(sp, wsh, None, W, M)
    parts += [glass_side('gls', sp, W, 1.4, 2.28, 0.04, gl, 1), glass_side('gls', sp, W, 1.4, 2.28, 0.04, gl, -1)]
    parts.append(box('grille', (0.05, 1.3, 0.35), (3.1, 0, 0.85), M['trim'], bevel=0.02))
    parts.append(box('bumper', (0.14, 1.95, 0.22), (3.1, 0, 0.5), mat('Bumper', '#bcbfc2', metal=0.6, rough=0.35), bevel=0.03))
    parts += lamp_pair('head', 3.09, 0.72, 0.72, 0.06, 0.3, 0.16, M['head'])
    parts += plates(3.18, 0.5, -3.12, 0.55, M)
    parts += mirrors(2.95, 1.9, W / 2 + 0.1, M, M['trim'])
    # 荷箱（アルミバン）
    alu = mat('Alu', '#d9dcde', metal=0.6, rough=0.35)
    parts.append(box('cargo', (4.0, 2.1, 2.35), (-0.95, 0, 0.62 + 2.35 / 2), alu, bevel=0.03))
    rib = mat('Rib', '#b7bbbe', metal=0.6, rough=0.4)
    for x in [-2.6 + 0.4 * i for i in range(11)]:
        for s in (1, -1):
            parts.append(box('rib', (0.05, 0.02, 2.3), (x, s * 1.06, 0.62 + 2.35 / 2), rib))
    parts.append(box('chassis', (5.6, 0.9, 0.25), (-0.1, 0, 0.5), M['black']))
    parts += lamp_pair('tail', -2.97, 0.55, 0.85, 0.06, 0.25, 0.12, M['tail'])
    parts.append(box('rbump', (0.1, 2.0, 0.12), (-2.95, 0, 0.42), M['black']))
    wheels = [wheel('wheel_FL', 2.38, 0.82, 0.4, 0.22, M), wheel('wheel_FR', 2.38, -0.82, 0.4, 0.22, M),
              wheel('wheel_RL', -1.3, 0.72, 0.4, 0.22, M, dual=True), wheel('wheel_RR', -1.3, -0.72, 0.4, 0.22, M, dual=True)]
    root = finish(name, parts, wheels)
    return root


def bus(name='bus'):
    """伊予鉄バス風（みかん色＋アイボリー）。全長10.4m。"""
    M = MATS()
    W, L = 2.49, 10.4
    paint = M['paint']
    cream = mat('BusCream', '#f1ece0', rough=0.35, coat=0.6)
    prof = [(-5.2, 0.32), (5.2, 0.32), (5.24, 0.6), (5.24, 2.9), (5.12, 3.08), (-5.1, 3.08), (-5.22, 2.9), (-5.24, 0.6)]
    body = body_from_profile('body', prof, W, 3.0, 3.08, 0.01, 0.35, paint, [(3.45, 0.55), (-2.5, 0.55)], M['black'])
    split_paint(body, 1.25, cream)
    parts = [body]
    gl = M['glass']
    # 車内（窓の帯をくり抜き、座席の列）
    bsp = [(-4.9, 1.35), (4.4, 1.35), (4.4, 2.6), (-4.9, 2.6)]
    wsh, rgl = ((5.25, 1.1), (5.2, 2.65), (1, 0), 0.08), ((-5.25, 1.9), (-5.25, 2.7), (-1, 0), 0.25)
    hollow_cabin(body, bsp, W, 3.0, 3.08, 0.01, M, wsh, rgl, wsh_depth=0.9, rgl_depth=0.42)
    parts += cabin_seats(bsp, wsh, rgl, W, M)
    for i in range(10):
        x = -4.45 + 0.82 * i
        for y in (0.88, 0.42, -0.42, -0.88):
            parts.append(box('bseat', (0.1, 0.42, 0.5), (x, y, 1.62), M['interior'], bevel=0.03))
    # 側窓帯
    for s in (1, -1):
        parts.append(glass_side('gls', [(-4.9, 1.35), (4.4, 1.35), (4.4, 2.6), (-4.9, 2.6)], W, 3.0, 3.08, 0.01, gl, s))
        for x in [-4.9 + 1.32 * i for i in range(1, 8)]:
            parts.append(box('wpil', (0.08, 0.012, 1.26), (x, s * (W / 2 + 0.014), 1.97), cream))
    # 前扉・中扉
    parts.append(glass_side('door', [(4.45, 0.45), (5.05, 0.45), (5.05, 2.6), (4.45, 2.6)], W, 3.0, 3.08, 0.01, gl, -1))
    parts.append(glass_side('door', [(-0.4, 0.45), (0.6, 0.45), (0.6, 2.6), (-0.4, 2.6)], W, 3.0, 3.08, 0.01, gl, -1))
    parts.append(glass_quad('wsh', (5.25, 1.1), (5.2, 2.65), W, 3.0, 3.08, 0.01, gl, inset=0.08, outward=(1, 0)))
    parts.append(glass_quad('rgl', (-5.25, 1.9), (-5.25, 2.7), W, 3.0, 3.08, 0.01, gl, inset=0.25, outward=(-1, 0)))
    dest = mat('Dest', '#1a1206', rough=0.3, emit='#ff9a20', estr=1.5)
    parts.append(box('dest', (0.02, 1.6, 0.26), (5.255, 0, 2.82), dest))
    parts.append(box('sidedest', (1.1, 0.02, 0.22), (3.5, -(W / 2 + 0.012), 2.78), dest))
    parts += lamp_pair('head', 5.25, 0.62, 0.95, 0.04, 0.3, 0.14, M['head'])
    parts += lamp_pair('tail', -5.25, 0.95, 1.0, 0.04, 0.16, 0.42, M['tail'])
    parts.append(box('bumper', (0.12, 2.5, 0.28), (5.25, 0, 0.45), M['black']))
    parts.append(box('rbumper', (0.12, 2.5, 0.28), (-5.25, 0, 0.45), M['black']))
    parts.append(box('roofac', (2.4, 1.6, 0.25), (-1.5, 0, 3.2), mat('BusRoof', '#d9d6cf', rough=0.5), bevel=0.06))
    parts += mirrors(5.3, 2.4, W / 2 + 0.12, M, M['black'])
    parts += plates(5.32, 0.62, -5.33, 0.75, M)
    wheels = [wheel('wheel_FL', 3.45, 1.0, 0.5, 0.3, M), wheel('wheel_FR', 3.45, -1.0, 0.5, 0.3, M),
              wheel('wheel_RL', -2.5, 0.92, 0.5, 0.3, M, dual=True), wheel('wheel_RR', -2.5, -0.92, 0.5, 0.3, M, dual=True)]
    return finish(name, parts, wheels)


def bike(name='bike'):
    """原付スクーター。全長1.85m。乗り手はゲーム側で人物モデルを座らせる。"""
    M = MATS()
    paint = M['paint']
    parts = []
    # 前のレッグシールド
    shield = prism('shield', [(0.38, 0.3), (0.62, 0.3), (0.68, 1.02), (0.5, 1.06), (0.42, 0.62)], -0.22, 0.22, paint)
    add_mod(shield, 'BEVEL', width=0.03, segments=3)
    parts.append(shield)
    # 床と後部ボディ
    parts.append(box('floor', (0.6, 0.34, 0.06), (0.05, 0, 0.32), M['black'], bevel=0.01))
    rear = prism('rear', [(-0.75, 0.38), (-0.25, 0.38), (-0.15, 0.6), (-0.35, 0.78), (-0.8, 0.8), (-0.88, 0.6)], -0.17, 0.17, paint)
    add_mod(rear, 'BEVEL', width=0.04, segments=3)
    parts.append(rear)
    seat = prism('seat', [(-0.75, 0.78), (-0.15, 0.78), (-0.12, 0.84), (-0.3, 0.88), (-0.78, 0.88)], -0.15, 0.15, mat('Seat', '#1c1c1e', rough=0.6))
    add_mod(seat, 'BEVEL', width=0.03, segments=3)
    parts.append(seat)
    # フロントフォーク・ハンドル
    parts.append(cyl('fork', 0.025, 0.75, (0.62, 0, 0.62), M['chrome'], verts=10))
    parts[-1].rotation_euler = (0, math.radians(-20), 0)
    parts.append(cyl('bar', 0.02, 0.62, (0.52, 0, 1.08), M['trim'], verts=10, axis='Y'))
    parts.append(box('headcover', (0.2, 0.32, 0.14), (0.55, 0, 1.08), paint, bevel=0.04))
    parts.append(box('head', (0.04, 0.12, 0.08), (0.66, 0, 1.08), M['head'], bevel=0.01))
    parts.append(box('tail', (0.04, 0.12, 0.05), (-0.88, 0, 0.7), M['tail']))
    parts.append(box('fender', (0.4, 0.12, 0.05), (0.78, 0, 0.6), paint, bevel=0.02))
    parts.append(box('muffler', (0.45, 0.08, 0.08), (-0.6, -0.17, 0.32), M['chrome'], bevel=0.02))
    for s in (1, -1):
        parts.append(box('mir', (0.04, 0.08, 0.06), (0.5, s * 0.33, 1.22), M['chrome']))
    parts += plates(-0.9, 0.55, -0.9, 0.55, M)[:2]
    wheels = [wheel('wheel_F', 0.72, 0.0, 0.27, 0.09, M), wheel('wheel_R', -0.55, 0.0, 0.27, 0.1, M)]
    for w in wheels:
        w.location.y = 0
    return finish(name, parts, wheels)



def minivan(name='minivan'):
    """ミニバン（スライドドア、全長4.7m）。"""
    M = MATS()
    W, belt, top = 1.72, 1.05, 1.86
    prof = [(-2.35, 0.30), (2.30, 0.30), (2.36, 0.46), (2.34, 0.78), (2.16, 0.95), (1.55, 1.08), (1.42, 1.12),
            (0.55, 1.83), (-2.15, 1.86), (-2.33, 1.72), (-2.37, 0.55)]
    arches = [(1.45, 0.35), (-1.45, 0.35)]
    body = body_from_profile('body', prof, W, belt, top, 0.07, 0.42, M['paint'], arches, M['black'])
    parts = [body]
    gl = M['glass']
    sp = [(-2.1, 1.13), (1.3, 1.13), (0.6, 1.75), (-2.05, 1.77)]
    wsh, rgl = ((1.40, 1.13), (0.58, 1.77), (1, 1), 0.06), ((-2.34, 1.16), (-2.29, 1.70), (-1, 0), 0.06)
    hollow_cabin(body, sp, W, belt, top, 0.07, M, wsh, rgl)
    parts += cabin_seats(sp, wsh, rgl, W, M)
    parts += [glass_side('gls', sp, W, belt, top, 0.07, gl, 1), glass_side('gls', sp, W, belt, top, 0.07, gl, -1)]
    parts.append(glass_quad('wsh', (1.40, 1.13), (0.58, 1.77), W, belt, top, 0.07, gl, outward=(1, 1)))
    parts.append(glass_quad('rgl', (-2.34, 1.16), (-2.29, 1.70), W, belt, top, 0.07, gl, outward=(-1, 0)))
    for s in (1, -1):
        for x in (0.48, -0.75):
            parts.append(box('pil', (0.09, 0.012, 0.62), (x, s * (taper_y(1.44, W, belt, top, 0.07) + 0.012), 1.44), M['trim']))
        parts.append(box('slrail', (1.3, 0.02, 0.03), (-1.35, s * W / 2 * 0.995, 1.1), M['trim']))
    parts += door_lines([1.38, 0.46, -0.78], 0.38, 1.08, W, belt, M)
    parts += handles([0.75, -0.55], 0.95, W, M)
    parts += lamp_pair('head', 2.24, 0.82, 0.6, 0.16, 0.38, 0.14, M['head'], rot=0.35)
    parts += lamp_pair('tail', -2.35, 1.2, 0.72, 0.06, 0.14, 0.55, M['tail'])
    parts.append(box('grille', (0.06, 1.1, 0.22), (2.33, 0, 0.68), M['chrome'], bevel=0.01))
    parts += plates(2.37, 0.48, -2.37, 0.78, M)
    parts += mirrors(1.36, 1.18, W / 2, M, M['paint'])
    parts.append(box('under', (4.2, W - 0.25, 0.08), (0, 0, 0.24), M['black']))
    wheels = [wheel('wheel_FL', 1.45, 0.74, 0.32, 0.21, M), wheel('wheel_FR', 1.45, -0.74, 0.32, 0.21, M),
              wheel('wheel_RL', -1.45, 0.74, 0.32, 0.21, M), wheel('wheel_RR', -1.45, -0.74, 0.32, 0.21, M)]
    return finish(name, parts, wheels)


def keitruck(name='keitruck'):
    """軽トラック（キャブ＋平荷台、全長3.4m）。"""
    M = MATS()
    W = 1.47
    cab_prof = [(0.36, 0.36), (1.66, 0.36), (1.71, 0.52), (1.70, 0.96), (1.55, 1.06), (1.42, 1.09), (1.12, 1.78), (0.40, 1.80), (0.36, 1.62)]
    cab = body_from_profile('cab', cab_prof, W, 1.05, 1.80, 0.05, 0.3, M['paint'], [(1.05, 0.30)], M['black'])
    parts = [cab]
    gl = M['glass']
    parts.append(glass_quad('wsh', (1.42, 1.1), (1.13, 1.72), W, 1.05, 1.80, 0.05, gl, outward=(1, 1)))
    sp = [(0.55, 1.12), (1.3, 1.12), (1.1, 1.68), (0.55, 1.7)]
    wsh, rgl = ((1.42, 1.1), (1.13, 1.72), (1, 1), 0.06), ((0.37, 1.2), (0.39, 1.62), (-1, 0), 0.06)
    hollow_cabin(cab, sp, W, 1.05, 1.80, 0.05, M, wsh, rgl, rgl_depth=0.22)
    parts += cabin_seats(sp, wsh, rgl, W, M)
    parts += [glass_side('gls', sp, W, 1.05, 1.80, 0.05, gl, 1), glass_side('gls', sp, W, 1.05, 1.80, 0.05, gl, -1)]
    parts.append(glass_quad('rgl', (0.37, 1.2), (0.39, 1.62), W, 1.05, 1.80, 0.05, gl, outward=(-1, 0)))
    parts += lamp_pair('head', 1.68, 0.8, 0.5, 0.08, 0.26, 0.14, M['head'])
    parts.append(box('grille', (0.05, 0.6, 0.14), (1.71, 0, 0.68), M['trim'], bevel=0.01))
    parts += mirrors(1.38, 1.15, W / 2, M, M['trim'])
    # 平荷台とあおり
    bed = mat('Bed', '#8c9196', metal=0.4, rough=0.5)
    parts.append(box('bed', (2.0, W, 0.06), (-0.7, 0, 0.72), bed))
    for s in (1, -1):
        parts.append(box('gate', (2.0, 0.04, 0.3), (-0.7, s * (W / 2 - 0.02), 0.9), M['paint']))
    parts.append(box('tgate', (0.04, W, 0.3), (-1.7, 0, 0.9), M['paint']))
    parts.append(box('guard', (0.05, W, 0.75), (0.3, 0, 1.12), bed))
    for y in (-0.5, 0, 0.5):
        parts.append(box('gbar', (0.04, 0.04, 0.75), (0.3, y, 1.12), M['black']))
    parts.append(box('chassis', (3.2, 0.8, 0.2), (-0.1, 0, 0.5), M['black']))
    parts += lamp_pair('tail', -1.72, 0.62, 0.62, 0.05, 0.16, 0.14, M['tail'])
    parts += plates(1.72, 0.5, -1.73, 0.55, M)
    wheels = [wheel('wheel_FL', 1.05, 0.62, 0.28, 0.17, M), wheel('wheel_FR', 1.05, -0.62, 0.28, 0.17, M),
              wheel('wheel_RL', -1.0, 0.62, 0.28, 0.17, M), wheel('wheel_RR', -1.0, -0.62, 0.28, 0.17, M)]
    return finish(name, parts, wheels)


def van(name='van'):
    """ワンボックスの配送バン（ハイルーフ、全長4.7m）。"""
    M = MATS()
    W, belt, top = 1.70, 1.12, 2.08
    prof = [(-2.35, 0.30), (2.30, 0.30), (2.36, 0.46), (2.36, 0.96), (2.26, 1.08), (2.12, 1.12), (1.78, 1.96),
            (1.58, 2.06), (-2.30, 2.08), (-2.36, 1.96), (-2.38, 0.55)]
    arches = [(1.45, 0.35), (-1.42, 0.35)]
    body = body_from_profile('body', prof, W, belt, top, 0.04, 0.25, M['paint'], arches, M['black'])
    parts = [body]
    gl = M['glass']
    parts.append(glass_quad('wsh', (2.12, 1.14), (1.79, 1.95), W, belt, top, 0.04, gl, outward=(1, 1)))
    sp = [(1.0, 1.16), (2.0, 1.16), (1.75, 1.9), (1.0, 1.92)]
    wsh = ((2.12, 1.14), (1.79, 1.95), (1, 1), 0.06)
    hollow_cabin(body, sp, W, belt, top, 0.04, M, wsh, None)
    parts += cabin_seats(sp, wsh, ((1.0, 1.16), (1.0, 1.9)), W, M)
    parts += [glass_side('gls', sp, W, belt, top, 0.04, gl, 1), glass_side('gls', sp, W, belt, top, 0.04, gl, -1)]
    parts.append(glass_quad('rgl', (-2.36, 1.3), (-2.32, 1.9), W, belt, top, 0.04, gl, outward=(-1, 0)))
    parts += door_lines([2.05, 0.95, -0.6], 0.38, 1.95, W, belt, M)
    parts += lamp_pair('head', 2.33, 0.82, 0.6, 0.06, 0.3, 0.16, M['head'])
    parts += lamp_pair('tail', -2.37, 0.9, 0.74, 0.05, 0.14, 0.4, M['tail'])
    parts.append(box('grille', (0.06, 1.0, 0.2), (2.37, 0, 0.66), M['trim'], bevel=0.01))
    parts.append(box('bumper', (0.12, 1.72, 0.18), (2.36, 0, 0.42), M['black']))
    parts += plates(2.42, 0.42, -2.38, 0.62, M)
    parts += mirrors(2.0, 1.25, W / 2, M, M['trim'])
    parts.append(box('rack', (2.6, 1.4, 0.05), (-0.6, 0, 2.18), M['trim']))
    wheels = [wheel('wheel_FL', 1.45, 0.73, 0.32, 0.2, M), wheel('wheel_FR', 1.45, -0.73, 0.32, 0.2, M),
              wheel('wheel_RL', -1.42, 0.73, 0.32, 0.2, M), wheel('wheel_RR', -1.42, -0.73, 0.32, 0.2, M)]
    return finish(name, parts, wheels)


def build_all():
    reset()
    roots = [sedan('sedan'), kei('kei'), sedan('taxi', taxi=True), sedan('police', police=True), sports('sports'),
             truck('truck'), bus('bus'), bike('bike'), minivan('minivan'), keitruck('keitruck'), van('van')]
    return roots


def paint_preview(roots):
    cols = {'sedan': '#2a4a7a', 'kei': '#e8e4da', 'taxi': '#e8862c', 'police': None, 'sports': '#c8282a',
            'truck': '#3a6aa8', 'bus': '#e8862c', 'bike': '#c8282a'}
    # プレビュー用に並べる（書き出し前に元へ戻す）
    xs = {}
    slots = {'sedan': (-6, 4), 'kei': (0, 4), 'taxi': (6, 4), 'police': (12, 4),
             'sports': (-6, -1), 'bike': (0, -1), 'truck': (5.5, -1), 'bus': (-4, -7),
             'minivan': (6, -7), 'keitruck': (12, -1), 'van': (12, -7)}
    for r in roots:
        xs[r.name] = r.location.copy()
        r.location = (*slots[r.name], 0)
    m = bpy.data.materials.get('Paint')
    return xs


if __name__ == '__main__':
    roots = build_all()
    out = os.path.join(ASSETS, 'glb', 'vehicles.glb')
    export_glb(out, roots, uv=False)
    # プレビュー
    saved = paint_preview(roots)
    pm = bpy.data.materials['Paint']
    pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hex2lin('#9a2a2a'), 1)
    preview(os.path.join(PREV, 'vehicles.png'), target=(3, -1, 0.6), dist=30, elev=32, azim=-55, lens=45,
            res=(1400, 900), samples=64)
