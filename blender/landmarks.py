"""松山のランドマーク（landmarks.glb）。各ノードの原点 = ゲームのLMS座標、+X東、+Y北、Z上（m）。
マテリアル命名規約（ゲーム側で差し替え）:
  FAC_<種類>   … 外壁テクスチャ＋夜間の窓明かり（UV: 横=3.6m/1枚, 縦=2.8m/1階）
  TEX_<名前>   … タイル状テクスチャ（kawara/stonewall/plaster/concrete、UV=ワールドm/1.2〜6）
  NightGlow_*  … 夜に発光する窓・行灯
実行: Blender -b --factory-startup -P landmarks.py
"""
import bpy, bmesh, math, os, sys, glob
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

GOTHIC = None
MINCHO = None


def fonts():
    global GOTHIC, MINCHO
    g = glob.glob('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc')
    m = glob.glob('/System/Library/Fonts/ヒラギノ明朝 ProN.ttc')
    GOTHIC = bpy.data.fonts.load(g[0]) if g else None
    MINCHO = bpy.data.fonts.load(m[0]) if m else GOTHIC


# ---------- マテリアル ----------
def FAC(kind, preview_col='#c9c6bd'):
    m = mat('FAC_' + kind, preview_col, rough=0.7)
    p = os.path.join(TEX, f'fac_{kind}.jpg')
    if os.path.exists(p) and not m.node_tree.nodes.get('Image Texture'):
        b = m.node_tree.nodes['Principled BSDF']
        tn = m.node_tree.nodes.new('ShaderNodeTexImage')
        tn.image = bpy.data.images.load(p, check_existing=True)
        m.node_tree.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    return m


def TEXM(name, col, rough=0.8, metal=0.0):
    m = mat('TEX_' + name, col, rough=rough, metal=metal)
    p = os.path.join(TEX, f'{name}.jpg')
    if os.path.exists(p) and not m.node_tree.nodes.get('Image Texture'):
        b = m.node_tree.nodes['Principled BSDF']
        tn = m.node_tree.nodes.new('ShaderNodeTexImage')
        tn.image = bpy.data.images.load(p, check_existing=True)
        mix = m.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = (*hex2lin(col), 1)
        m.node_tree.links.new(tn.outputs['Color'], mix.inputs[6])
        m.node_tree.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def L():
    return dict(
        white=mat('LM_White', '#f1eee6', rough=0.75),
        black=mat('LM_BlackWood', '#26231f', rough=0.7),
        wood=mat('LM_Wood', '#8a6542', rough=0.65),
        darkwood=mat('LM_DarkWood', '#4a3424', rough=0.7),
        vermil=mat('LM_Vermilion', '#c8402a', rough=0.5),
        gold=mat('LM_Gold', '#d8b04a', metal=1.0, rough=0.25),
        copper=mat('LM_Copper', '#5f9c84', metal=0.4, rough=0.45),
        glass=mat('LM_Glass', '#2a3c4a', rough=0.05, spec=0.9),
        steel=mat('LM_Steel', '#8e959b', metal=0.8, rough=0.4),
        conc=TEXM('concrete', '#d4d1c8'),
        kawara=TEXM('kawara', '#ffffff', rough=0.55, metal=0.1),
        stone=TEXM('stonewall', '#ffffff', rough=0.9),
        plaster=TEXM('plaster', '#ffffff', rough=0.85),
        dark=mat('LM_Dark', '#1d2024', rough=0.6),
        glow=mat('NightGlow_Warm', '#3a3226', rough=0.3, emit='#ffcf8a', estr=0.0),
        glowr=mat('NightGlow_Red', '#6a1a12', rough=0.2, emit='#ff4030', estr=0.0),
        red=mat('LM_Red', '#c8322a', rough=0.45),
        green=mat('LM_Green', '#1e7a48', rough=0.45),
        blue=mat('LM_Blue', '#2a4f8e', rough=0.45),
        cream=mat('LM_Cream', '#e9dfc6', rough=0.7),
        roofgreen=mat('LM_RoofGreen', '#3e5a4e', rough=0.6),
        grass=mat('LM_Grass', '#5f8a45', rough=0.95),
    )


# ---------- UV ----------
def uv_project(o, sx, sy=None, z0=0.0, top=None):
    """箱投影UV。壁: u=水平/sx, v=(z-z0)/sy。上面: u=x/top, v=y/top。"""
    sy = sy or sx
    top = top or sx
    me = o.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    uv.name = 'UVMap'
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.72:
                u, w = v.x / top, v.y / top
            elif abs(n.x) >= abs(n.y):
                u, w = (v.y if n.x > 0 else -v.y) / sx, (v.z - z0) / sy
            else:
                u, w = (-v.x if n.y > 0 else v.x) / sx, (v.z - z0) / sy
            uv.data[li].uv = (u, w)


def uv_roof(o, tile=1.2):
    me = o.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if abs(n.x) > abs(n.y):
                uv.data[li].uv = (v.y / tile, v.x / tile)
            else:
                uv.data[li].uv = (v.x / tile, v.y / tile)


def bakexf(o):
    bpy.context.view_layer.update()
    bake(o)
    apply_xform(o)
    return o


# ---------- 部品 ----------
def text3d(name, s, size, loc, facing, m, depth=0.06, font=None):
    """facing: 文字の正面が向く方向 '-Y','+Y','+X','-X'"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = s
    cu.font = font or GOTHIC
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    rz = {'-Y': 0, '+X': math.pi / 2, '+Y': math.pi, '-X': -math.pi / 2}[facing]
    o.rotation_euler = (math.pi / 2, 0, rz)
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


def vtext3d(name, s, size, loc, facing, m, depth=0.06, font=None):
    """縦書き（1文字ずつ下へ）。"""
    objs = []
    for i, ch in enumerate(s):
        objs.append(text3d(name, ch, size, (loc[0], loc[1], loc[2] - i * size * 1.05), facing, m, depth, font))
    return objs


def batter_box(name, x0, y0, x1, y1, z0, z1, inset, m):
    """石垣（上がすぼまる台形の箱）。"""
    bm = bmesh.new()
    b = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0))]
    t = [bm.verts.new(p) for p in ((x0 + inset, y0 + inset, z1), (x1 - inset, y0 + inset, z1), (x1 - inset, y1 - inset, z1), (x0 + inset, y1 - inset, z1))]
    bm.faces.new(t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((b[i], b[j], t[j], t[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_from_bm(name, bm, [m])
    uv_project(o, 3.0, 3.0)
    return o


def hip_roof(name, cx, cy, sx, sy, z, h, over, m, upturn=0.4, thick=0.35, fascia=None, ridge_ratio=0.45, gables=None):
    """寺社・城の屋根（反りのある寄棟＋入母屋の妻）。長手がX。"""
    swap = sy > sx
    if swap:
        sx, sy = sy, sx
    ax, ay = sx / 2 + over, sy / 2 + over
    rl = max(0.2, ax - ay) + (ax - (ax - ay)) * ridge_ratio * 0.0
    rl = max(0.3, ax * ridge_ratio + (ax - ay) * (1 - ridge_ratio))
    bm = bmesh.new()

    def V(x, y, zz):
        if swap:
            x, y = -y, x
        return bm.verts.new((cx + x, cy + y, zz))
    E = [V(-ax, -ay, z + upturn), V(ax, -ay, z + upturn), V(ax, ay, z + upturn), V(-ax, ay, z + upturn)]
    Mf, Mr, Mb, Ml = V(0, -ay, z), V(ax, 0, z + upturn * 0.25), V(0, ay, z), V(-ax, 0, z + upturn * 0.25)
    R1, R2 = V(-rl, 0, z + h), V(rl, 0, z + h)
    for f in ((E[0], Mf, R1), (Mf, E[1], R2), (Mf, R2, R1), (E[2], Mb, R2), (Mb, E[3], R1), (Mb, R1, R2),
              (E[1], Mr, R2), (Mr, E[2], R2), (E[3], Ml, R1), (Ml, E[0], R1)):
        bm.faces.new(f)
    # 軒裏と鼻隠し（厚み）
    down = [V(*(Vector(v.co) - Vector((cx, cy, 0))).to_tuple()) for v in []]
    perim = [E[0], Mf, E[1], Mr, E[2], Mb, E[3], Ml]
    low = []
    for v in perim:
        low.append(bm.verts.new((v.co.x, v.co.y, v.co.z - thick)))
    bm.faces.new(list(reversed(low)))
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((perim[i], low[i], low[j], perim[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_from_bm(name, bm, [m])
    if fascia is not None:
        o.data.materials.append(fascia)
        for p in o.data.polygons:
            if abs(p.normal.z) < 0.25:
                p.material_index = 1
    uv_roof(o)
    parts = [o]
    # 大棟
    if swap:
        rb = box(name + '_ridge', (0.55, 2 * rl + 0.4, 0.5), (cx, cy, z + h + 0.15), m)
    else:
        rb = box(name + '_ridge', (2 * rl + 0.4, 0.55, 0.5), (cx, cy, z + h + 0.15), m)
    parts.append(rb)
    if gables:  # 入母屋の妻（白壁の三角）
        gw, gh = ay * 0.9, h * 0.55
        for s in (-1, 1):
            bm2 = bmesh.new()
            if swap:
                pts = [(cx - gw * 0.9, cy + s * rl, z + h - gh), (cx + gw * 0.9, cy + s * rl, z + h - gh), (cx, cy + s * rl, z + h)]
            else:
                pts = [(cx + s * rl, cy - gw * 0.9, z + h - gh), (cx + s * rl, cy + gw * 0.9, z + h - gh), (cx + s * rl, cy, z + h)]
            vs = [bm2.verts.new(p) for p in pts]
            bm2.faces.new(vs)
            g = mesh_from_bm(name + '_gable', bm2, [gables])
            add_mod(g, 'SOLIDIFY', thickness=0.3)
            parts.append(g)
    return parts


def wall_block(name, x0, y0, x1, y1, z0, h, upper, lower=None, lower_ratio=0.0, windows=None, win_mat=None, win_h=0.9, win_w=1.0, gap=2.2, win_z=0.55):
    """城・社寺の壁（下見板＋漆喰）と格子窓。"""
    parts = []
    if lower and lower_ratio > 0:
        parts.append(box(name + '_lo', (x1 - x0, y1 - y0, h * lower_ratio), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + h * lower_ratio / 2), lower))
        parts.append(box(name + '_up', (x1 - x0, y1 - y0, h * (1 - lower_ratio)), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + h * lower_ratio + h * (1 - lower_ratio) / 2), upper))
    else:
        parts.append(box(name, (x1 - x0, y1 - y0, h), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + h / 2), upper))
    if win_mat:
        zc = z0 + h * win_z
        for (axis, c0, c1, fixed, sgn) in (('x', x0, x1, y0, -1), ('x', x0, x1, y1, 1), ('y', y0, y1, x0, -1), ('y', y0, y1, x1, 1)):
            n = max(1, int((c1 - c0 - 1.0) / gap))
            for i in range(n):
                c = c0 + (c1 - c0) * (i + 0.5) / n
                if axis == 'x':
                    parts.append(box(name + '_w', (win_w, 0.06, win_h), (c, fixed + sgn * 0.02, zc), win_mat))
                else:
                    parts.append(box(name + '_w', (0.06, win_w, win_h), (fixed + sgn * 0.02, c, zc), win_mat))
    return parts


def office_block(name, x0, y0, x1, y1, floors, upper='office', ground='goffice', gH=3.6, z0=0.0, parapet=True, M=None):
    parts = []
    g = box(name + '_g', (x1 - x0, y1 - y0, gH), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + gH / 2), FAC(ground))
    bakexf(g)
    uv_project(g, 3.6, gH, z0)
    u = box(name + '_u', (x1 - x0, y1 - y0, floors * 2.8), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + gH + floors * 1.4), FAC(upper))
    bakexf(u)
    uv_project(u, 3.6, 2.8, z0 + gH)
    parts += [g, u]
    top = z0 + gH + floors * 2.8
    if parapet:
        pm = M['conc'] if M else TEXM('concrete', '#d4d1c8')
        for (a, b, c, d) in ((x0, y0, x1, y0 + 0.3), (x0, y1 - 0.3, x1, y1), (x0, y0, x0 + 0.3, y1), (x1 - 0.3, y0, x1, y1)):
            pp = box(name + '_par', (c - a, d - b, 1.1), ((a + c) / 2, (b + d) / 2, top + 0.55), pm)
            parts.append(pp)
        parts.append(box(name + '_roof', (x1 - x0 - 0.4, y1 - y0 - 0.4, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, top + 0.05), pm))
    return parts, top


def finish_lm(name, parts, children=()):
    root = empty(name)
    for p in parts:
        if p.type == 'MESH':
            bakexf(p)
    o = join(parts, name + '_mesh', smooth_angle=30)
    parent(o, root)
    for c in children:
        parent(c, root)
    return root


# ======================================================================
# 松山城（連立式天守）
# ======================================================================
def castle():
    M = L()
    P = []
    # 本丸の石垣（台座）
    P.append(batter_box('honmaru', -30, -24, 30, 22, -3.0, 1.2, 1.5, M['stone']))
    P.append(box('honmaru_top', (57, 43, 0.2), (0, -1, 1.25), M['conc']))
    # 天守曲輪の高石垣
    P.append(batter_box('tenshu_base', -14, 2, 14, 20, 1.2, 6.0, 1.6, M['stone']))
    bz = 6.0
    # 大天守（三重）
    tx, ty = 4.0, 12.0
    tiers = [(13.0, 11.0, 4.6), (10.4, 8.8, 3.8), (8.0, 6.6, 3.6)]
    z = bz
    for i, (sx, sy, h) in enumerate(tiers):
        P += wall_block('t%d' % i, tx - sx / 2, ty - sy / 2, tx + sx / 2, ty + sy / 2, z, h, M['white'], M['black'], 0.42,
                        win_mat=M['dark'], win_h=0.9, win_w=0.75, gap=1.6, win_z=0.66)
        z += h
        last = i == len(tiers) - 1
        P += hip_roof('r%d' % i, tx, ty, sx + 0.6, sy + 0.6, z - 0.15, 2.6 if last else 1.5, 1.6 if i == 0 else 1.3,
                      M['kawara'], upturn=0.5, thick=0.35, fascia=M['white'], ridge_ratio=0.3 if not last else 0.55,
                      gables=M['white'] if (last or i == 1) else None)
        if not last:
            z += 0.0
    top = z + 2.6
    # 千鳥破風（二重目の正面）
    for s in (-1, 1):
        g = prism('chidori', [(-1.6, 0), (1.6, 0), (0, 1.5)], -0.4, 0.4, M['white'], axis='X')
        g.location = (tx + s * 5.6, ty, bz + tiers[0][2] + 0.4)
        g.rotation_euler = (0, 0, 0)
        P.append(g)
    # 鯱（金）
    for s in (-1, 1):
        sh = ico('shachi', 0.35, (tx + s * 2.4, ty, top + 0.55), M['gold'], sub=1, scale=(0.6, 0.5, 1.4))
        P.append(sh)
    # 小天守・隅櫓（四隅）と渡櫓（連立式の回廊）
    corners = [(-9, 5), (9, 5), (-9, 18), (9, 18)]
    for k, (cx, cy) in enumerate(corners):
        if (cx, cy) == (9, 18):
            continue  # 大天守がこの角を占める
        P += wall_block('y%d' % k, cx - 3, cy - 2.6, cx + 3, cy + 2.6, bz, 3.4, M['white'], M['black'], 0.42, win_mat=M['dark'], gap=1.8, win_z=0.65)
        P += hip_roof('yr%d' % k, cx, cy, 6.4, 5.6, bz + 3.3, 1.6, 1.1, M['kawara'], upturn=0.35, fascia=M['white'], gables=M['white'])
        P += wall_block('y2%d' % k, cx - 2.2, cy - 1.8, cx + 2.2, cy + 1.8, bz + 3.4, 2.8, M['white'], None, 0, win_mat=M['dark'], gap=1.5, win_z=0.55)
        P += hip_roof('yr2%d' % k, cx, cy, 4.6, 4.0, bz + 6.1, 1.7, 1.0, M['kawara'], upturn=0.35, fascia=M['white'], gables=M['white'])
    for (x0, y0, x1, y1) in ((-6, 3.2, 6, 6.8), (-10.8, 7.6, -7.2, 15.4), (7.2, 7.6, 10.8, 9.0)):
        P += wall_block('wat', x0, y0, x1, y1, bz, 3.0, M['white'], M['black'], 0.45, win_mat=M['dark'], gap=1.6, win_z=0.62)
        P += hip_roof('watr', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + 0.4, y1 - y0 + 0.4, bz + 2.9, 1.3, 0.9, M['kawara'], upturn=0.2, fascia=M['white'])
    # 本丸の土塀（瓦屋根つき）と櫓門
    def dobei(a, b):
        ax_, ay_ = a
        bx_, by_ = b
        L_ = math.hypot(bx_ - ax_, by_ - ay_)
        ang = math.atan2(by_ - ay_, bx_ - ax_)
        w = box('dobei', (L_, 0.6, 2.2), ((ax_ + bx_) / 2, (ay_ + by_) / 2, 1.35 + 1.1), M['white'], rot=('Z', ang))
        c = box('dobei_cap', (L_ + 0.2, 1.1, 0.25), ((ax_ + bx_) / 2, (ay_ + by_) / 2, 1.35 + 2.3), M['kawara'], rot=('Z', ang))
        return [w, c]
    ring = [(-28, -22), (-6, -22), (6, -22), (28, -22), (28, 20), (-28, 20), (-28, -22)]
    for a, b in zip(ring, ring[1:]):
        if a == (-6, -22):
            continue  # 正門の開口
        P += dobei(a, b)
    # 正門（櫓門）
    P += wall_block('gate', -6, -23.5, 6, -19.5, 4.2, 3.0, M['white'], M['black'], 0.4, win_mat=M['dark'], gap=1.8, win_z=0.6)
    for s in (-1, 1):
        P.append(box('gatepost', (1.2, 4.0, 4.2), (s * 5.4, -21.5, 1.35 + 2.1), M['darkwood']))
    P += hip_roof('gater', 0, -21.5, 13, 4.8, 7.1, 1.6, 1.2, M['kawara'], upturn=0.35, fascia=M['white'], gables=M['white'])
    return finish_lm('castle', P)


# ======================================================================
# 道後温泉本館
# ======================================================================
def dogo_honkan():
    M = L()
    P = []
    wood = M['wood']
    lattice = M['darkwood']
    glow = M['glow']
    P.append(box('plinth', (48, 40, 0.5), (0, 0, 0.25), M['conc']))
    # 神の湯本館（正面＝南、-Y）
    lv = [(-14, -18, 14, 4, 0.5, 4.4), (-12, -16, 12, 2, 4.9, 3.8), (-9, -13, 9, -1, 8.7, 3.6)]
    for i, (x0, y0, x1, y1, z0, h) in enumerate(lv):
        P += wall_block('hk%d' % i, x0, y0, x1, y1, z0, h, wood, None, 0, win_mat=glow, win_h=h * 0.5, win_w=1.5, gap=2.2, win_z=0.55)
        # 欄干つきの縁（2・3階）
        if i > 0:
            for (ax, ay, bx, by) in ((x0, y0 - 0.9, x1, y0 - 0.9), (x0, y1 + 0.9, x1, y1 + 0.9)):
                P.append(box('rail', (bx - ax, 0.1, 0.12), ((ax + bx) / 2, ay, z0 + 1.0), lattice))
                for xx in [ax + k * 0.6 for k in range(int((bx - ax) / 0.6) + 1)]:
                    P.append(box('bal', (0.06, 0.06, 0.9), (xx, ay, z0 + 0.5), lattice))
            P.append(box('deck', (x1 - x0 + 2, y1 - y0 + 2, 0.18), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + 0.05), lattice))
        P += hip_roof('hkr%d' % i, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + 1.0, y1 - y0 + 1.0, z0 + h - 0.1, 1.6 if i < 2 else 2.4,
                      1.6, M['kawara'], upturn=0.45, fascia=lattice, ridge_ratio=0.5, gables=M['white'] if i == 2 else None)
    # 振鷺閣（屋上の塔、赤いギヤマン）
    tz = 12.3 + 2.3
    P.append(box('shinro_base', (3.4, 3.4, 0.4), (0, -7, tz), lattice))
    P += wall_block('shinro', -1.5, -8.5, 1.5, -5.5, tz + 0.2, 2.2, lattice, None, 0, win_mat=M['glowr'], win_h=1.2, win_w=0.7, gap=0.9, win_z=0.55)
    P += hip_roof('shinro_r', 0, -7, 3.6, 3.6, tz + 2.4, 1.4, 0.6, M['kawara'], upturn=0.25, fascia=lattice, ridge_ratio=0.05)
    # 白鷺
    P.append(ico('heron_body', 0.3, (0, -7, tz + 4.1), M['white'], sub=2, scale=(1.4, 0.6, 0.8)))
    P.append(cyl('heron_neck', 0.06, 0.6, (0.35, -7, tz + 4.45), M['white'], verts=8))
    P.append(ico('heron_head', 0.12, (0.42, -7, tz + 4.8), M['white'], sub=1))
    for s in (-1, 1):
        w = box('heron_wing', (0.7, 0.9, 0.05), (-0.1, -7 + s * 0.45, tz + 4.25), M['white'], rot=('X', s * 0.5))
        P.append(w)
    # 正面の唐破風の玄関
    P.append(box('porch', (6.5, 4.0, 3.4), (0, -19.6, 0.5 + 1.7), wood))
    # 唐破風：半円筒を潰した曲線屋根を玄関の上へ
    arch = cyl('karahafu', 3.7, 5.0, (0, 0, 0), M['kawara'], verts=28, axis='Y', cap=True)
    bm = bmesh.new(); bm.from_mesh(arch.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bm.to_mesh(arch.data); bm.free()
    arch.scale = (1, 1, 0.42)
    arch.location = (0, -19.6, 3.9)
    P.append(arch)
    P.append(box('karahafu_gable', (6.6, 0.3, 1.4), (0, -22.0, 4.5), lattice))
    P.append(box('noren', (4.5, 0.08, 1.2), (0, -21.65, 2.9), mat('Noren', '#2a3a6a', rough=0.9)))
    P.append(text3d('noren_t', '道後温泉', 0.55, (0, -21.72, 2.85), '-Y', M['white'], font=MINCHO))
    # 後方の又新殿・霊の湯棟（2階建て）
    for (x0, y0, x1, y1) in ((-22, -4, -4, 18), (4, 6, 22, 18)):
        P += wall_block('wing', x0, y0, x1, y1, 0.5, 7.0, wood, None, 0, win_mat=glow, win_h=2.6, win_w=1.6, gap=2.4, win_z=0.6)
        P += hip_roof('wingr', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + 0.8, y1 - y0 + 0.8, 7.4, 2.8, 1.5, M['kawara'], upturn=0.4,
                      fascia=lattice, gables=M['white'])
    return finish_lm('dogo_honkan', P)


# ======================================================================
# 洋風駅舎（道後温泉駅・高浜駅）
# ======================================================================
def western_station(name, w=24, d=13, tower=True, sign='道後温泉駅'):
    M = L()
    P = []
    cream = M['cream']
    trim = mat('LM_Trim', '#2f5f52', rough=0.5)
    P.append(box('plinth', (w + 2, d + 2, 0.3), (0, 0, 0.15), M['conc']))
    P += wall_block('body', -w / 2, -d / 2, w / 2, d / 2, 0.3, 5.0, cream, None, 0, win_mat=M['glow'], win_h=2.2, win_w=1.2, gap=2.6, win_z=0.5)
    for s in (-1, 1):
        P.append(box('cornice', (w + 0.6, 0.4, 0.3), (0, s * (d / 2 + 0.1), 5.4), trim))
    P += hip_roof('roof', 0, 0, w + 0.6, d + 0.6, 5.3, 2.6, 0.8, mat('LM_SlateRoof', '#3c4a52', rough=0.5), upturn=0.0, fascia=trim, ridge_ratio=0.6)
    if tower:
        P.append(box('tower', (4.2, 4.2, 9.5), (0, -d / 2 + 2.0, 4.75 + 0.3), cream))
        P.append(box('tbelt', (4.5, 4.5, 0.3), (0, -d / 2 + 2.0, 8.4), trim))
        roof = cyl('troof', 3.2, 3.2, (0, -d / 2 + 2.0, 11.4), mat('LM_SlateRoof', '#3c4a52'), verts=4, r2=0.05)
        roof.rotation_euler = (0, 0, math.pi / 4)
        P.append(roof)
        for (fx, fy, f) in ((0, -d / 2 - 0.02, '-Y'), (2.12, -d / 2 + 2.0, '+X'), (-2.12, -d / 2 + 2.0, '-X')):
            c = cyl('clock', 0.9, 0.08, (fx, fy, 7.6), M['white'], verts=24, axis='Y' if f == '-Y' else 'X')
            P.append(c)
            off = (0, -0.06, 0) if f == '-Y' else ((0.06, 0, 0) if f == '+X' else (-0.06, 0, 0))
            P.append(box('hand', (0.06 if f == '-Y' else 0.04, 0.04 if f == '-Y' else 0.06, 0.6), (fx + off[0], fy + off[1], 7.85), M['dark']))
    P.append(box('canopy', (10, 3.0, 0.25), (0, -d / 2 - 1.6, 3.6), trim))
    for x in (-4.5, 4.5):
        P.append(cyl('col', 0.12, 3.4, (x, -d / 2 - 2.9, 2.0), trim, verts=10))
    P.append(text3d('sign', sign, 0.7, (0, -d / 2 - 0.12, 4.5), '-Y', M['dark'], font=MINCHO))
    return finish_lm(name, P)


# ======================================================================
# 萬翠荘（フランス風洋館）
# ======================================================================
def bansuiso():
    M = L()
    P = []
    ivory = mat('LM_Ivory', '#efe7d2', rough=0.6)
    slate = mat('LM_Mansard', '#3a3e44', rough=0.5)
    P.append(box('base', (24, 18, 0.6), (0, 0, 0.3), M['conc']))
    P += wall_block('body', -11, -8, 11, 8, 0.6, 7.6, ivory, None, 0, win_mat=M['glow'], win_h=2.0, win_w=1.0, gap=2.2, win_z=0.55)
    for z in (4.2, 8.2):
        P.append(box('band', (22.4, 16.4, 0.25), (0, 0, z), ivory))
    # マンサード屋根
    P += hip_roof('mans', 0, 0, 22.4, 16.4, 8.2, 3.4, 0.2, slate, upturn=0.0, fascia=ivory, ridge_ratio=0.7)
    for x in (-6, 0, 6):
        P.append(box('dormer', (1.6, 1.2, 1.6), (x, -6.8, 9.6), ivory))
        P.append(box('dwin', (0.9, 0.08, 1.0), (x, -7.42, 9.6), M['glow']))
    # 中央の塔屋と玄関ポーチ
    P.append(box('tower', (5, 5, 12.5), (0, -6.0, 6.25 + 0.6), ivory))
    P += hip_roof('troof', 0, -6.0, 5.4, 5.4, 13.3, 3.0, 0.3, slate, upturn=0.0, ridge_ratio=0.05)
    P.append(box('porch', (6, 3, 0.4), (0, -9.6, 3.6), ivory))
    for x in (-2.6, -0.9, 0.9, 2.6):
        P.append(cyl('col', 0.25, 3.0, (x, -10.6, 2.1), ivory, verts=12))
    return finish_lm('bansuiso', P)


# ======================================================================
# 高島屋＋くるりん（屋上観覧車）
# ======================================================================
def takashimaya():
    M = L()
    P, top = office_block('dept', -30, -23, 30, 23, 10, upper='office', ground='gshop', gH=5.0, M=M)
    # 縦のフィン（百貨店らしい壁面）
    for x in [-28 + 4 * i for i in range(15)]:
        P.append(box('fin', (0.5, 0.7, top - 6), (x, -23.3, 6 + (top - 6) / 2), M['cream']))
    P.append(box('sign', (16, 0.4, 3.0), (0, -23.5, top - 3.5), M['dark']))
    P.append(text3d('signt', '松山市駅', 2.0, (0, -23.75, top - 3.5), '-Y', M['white']))
    # 駅の大きなキャノピー
    P.append(box('canopy', (40, 7, 0.4), (0, -27, 5.6), M['steel']))
    # くるりん（直径30m、屋上東側）。車軸はX方向、回転はゲーム側
    hub_z = top + 18
    wheel_root = empty('kururin_wheel', (14, 6, hub_z))
    W = []
    R = 15.0
    ring = bpy.data.meshes.new('ring')
    W.append(cyl('hub', 1.2, 2.4, (14, 6, hub_z), M['white'], verts=16, axis='X'))
    for s in (-1, 1):
        t = bpy.data.objects.new('rim', None)
        rimo = None
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=48, radius=R)
        rimo = mesh_from_bm('rim', bm, [M['white']])
        rimo.rotation_euler = (0, math.pi / 2, 0)
        rimo.location = (14 + s * 1.2, 6, hub_z)
        add_mod(rimo, 'SKIN')
        sk = rimo.data.skin_vertices[0].data
        for v in sk:
            v.radius = (0.22, 0.22)
        W.append(rimo)
        for k in range(16):
            a = k / 16 * math.tau
            b = box('spoke', (0.12, 0.12, R), (14 + s * 1.2, 6 + math.cos(a) * R / 2, hub_z + math.sin(a) * R / 2), M['white'],
                    rot=('X', a - math.pi / 2))
            W.append(b)
    wheel = join(W, 'kururin_spokes', smooth_angle=50)
    set_origin(wheel, (14, 6, hub_z))
    parent(wheel, wheel_root)
    gcols = ['#e8402a', '#f0a020', '#3a8ad8', '#3aa860', '#d04aa0', '#f0d020']
    gons = []
    for k in range(32):
        a = k / 32 * math.tau
        px, py, pz = 14, 6 + math.cos(a) * R, hub_z + math.sin(a) * R
        gm = mat('Gon' + gcols[k % 6], gcols[k % 6], rough=0.35)
        g = box('gon', (1.6, 1.4, 1.6), (px, py, pz - 1.2), gm, bevel=0.25)
        gw = box('gonw', (1.62, 1.0, 0.6), (px, py, pz - 1.0), M['glass'])
        gg = join([g, gw], 'kururin_gon_%d' % k, smooth_angle=50)
        set_origin(gg, (px, py, pz))
        parent(gg, wheel_root)
        gons.append(gg)
    # 支柱
    for s in (-1, 1):
        for d in (-1, 1):
            P.append(branch3('leg', (14 + s * 2.8, 6 + d * 7, top), (14 + s * 1.4, 6, hub_z), 0.45, M['white']))
    root = finish_lm('takashimaya', P, [wheel_root])
    return root


def branch3(name, a, b, r, m):
    d = Vector(b) - Vector(a)
    o = cyl(name, r, d.length, (0, 0, 0), m, verts=8)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.location = (Vector(a) + Vector(b)) / 2
    return o


# ======================================================================
# JR松山駅（高架駅）
# ======================================================================
def jrstation():
    """JR松山駅の駅舎（西側の旧駅舎の位置）。線路は駅中心の東約49m で、2024年9月から高架
    （高架橋・島式ホーム2面4線・上屋・高架下の「JR松山駅だんだん通り」はゲーム側 buildViaduct で線路に沿って作る）。"""
    M = L()
    P, top = office_block('hall', -18, -24, 18, 24, 2, upper='glass', ground='goffice', gH=4.5, M=M)
    P.append(box('roofwhite', (38, 50, 0.6), (0, 0, top + 0.6), mat('LM_RoofWhite', '#eef0f0', rough=0.4)))
    P.append(box('canopyN', (24, 7, 0.35), (0, 27.5, 4.4), mat('LM_RoofWhite', '#eef0f0')))
    for x in (-10, 0, 10):
        P.append(cyl('col', 0.22, 4.2, (x, 30.5, 2.1), M['steel'], verts=10))
    P.append(box('signbd', (16, 0.4, 2.2), (0, 24.3, top - 2.0), M['blue']))
    P.append(text3d('signt', '松山駅', 1.5, (0, 24.55, top - 2.0), '+Y', M['white']))
    # 高架ホームへの連絡通路（駅舎の東面から高架橋の西側の高欄へ。床は高架のホームの高さ付近）
    P.append(box('link', (20.2, 6.0, 3.2), (28.0, 4, 9.6), mat('LM_RoofWhite', '#eef0f0', rough=0.4)))
    P.append(box('linkwin', (20.2, 6.1, 1.2), (28.0, 4, 9.8), M['glass']))
    return finish_lm('jrstation', P)


# ======================================================================
# 一般的な公共建築（市役所・県庁・病院・警察・学校など）
# ======================================================================
def simple_office(name, w, d, floors, upper='office', ground='goffice', sign=None, sign_col=None, extra=None):
    M = L()
    P, top = office_block(name, -w / 2, -d / 2, w / 2, d / 2, floors, upper=upper, ground=ground, M=M)
    if sign:
        P.append(text3d(name + '_sign', sign, 1.6, (0, -d / 2 - 0.15, top - 2.2), '-Y', sign_col or M['dark']))
    if extra:
        P += extra(M, top)
    return finish_lm(name, P)


def prefoffice():
    M = L()
    P = []
    stone = mat('LM_PrefStone', '#cfc6b2', rough=0.7)
    P += wall_block('body', -25, -13, 25, 13, 0, 15, stone, None, 0, win_mat=M['glow'], win_h=1.8, win_w=1.2, gap=2.4, win_z=0.3)
    P += wall_block('body2', -25, -13, 25, 13, 0, 15, stone, None, 0, win_mat=M['glow'], win_h=1.8, win_w=1.2, gap=2.4, win_z=0.7)
    P.append(box('cornice', (51, 27, 0.6), (0, 0, 15.2), stone))
    P.append(box('tower', (10, 10, 21), (0, -6, 10.5), stone))
    P += wall_block('towerw', -5, -11, 5, -1, 15, 6, stone, None, 0, win_mat=M['glow'], win_h=2.2, win_w=1.0, gap=2.0, win_z=0.5)
    dome = sphere('dome', 4.8, (0, -6, 21), M['copper'], seg=24, rings=12)
    bm = bmesh.new(); bm.from_mesh(dome.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bm.to_mesh(dome.data); bm.free()
    P.append(dome)
    P.append(cyl('lantern', 0.8, 2.0, (0, -6, 26.6), M['copper'], verts=12))
    P.append(text3d('sign', '愛媛県庁', 1.0, (0, -11.2, 16.4), '-Y', M['dark'], font=MINCHO))
    for x in (-3, -1, 1, 3):
        P.append(cyl('col', 0.4, 6.0, (x, -13.6, 3.0), stone, verts=12))
    P.append(box('porch', (9, 3, 0.8), (0, -14.2, 6.3), stone))
    return finish_lm('prefoffice', P)


def hospital():
    def extra(M, top):
        o = [box('cross_v', (1.2, 0.3, 4.0), (0, -25.3, top - 3), M['red']), box('cross_h', (4.0, 0.3, 1.2), (0, -25.3, top - 3), M['red'])]
        o.append(cyl('heli', 7, 0.2, (0, 10, top + 0.2), M['conc'], verts=32))
        o.append(text3d('H', 'H', 5, (0, 10, top + 0.35), '-Y', M['white']))
        o[-1].rotation_euler = (0, 0, 0)
        return o
    return simple_office('hospital', 56, 48, 8, upper='office', ground='goffice', extra=extra)


def police():
    def extra(M, top):
        return [box('band', (45, 0.3, 1.2), (0, -17.7, top - 5.5), M['blue']),
                text3d('k', '松山東警察署', 1.2, (0, -17.9, 4.6), '-Y', M['dark'])]
    return simple_office('police', 44, 34, 5, upper='office', ground='goffice', sign='警察', sign_col=None, extra=extra)


def school(name, w, d):
    def extra(M, top):
        c = cyl('clock', 1.4, 0.15, (0, -d / 2 - 0.1, top - 1.6), M['white'], verts=24, axis='Y')
        return [c, box('hand', (0.12, 0.05, 1.0), (0, -d / 2 - 0.2, top - 1.4), M['dark'])]
    return simple_office(name, w, d, 3, upper='office', ground='goffice', extra=extra)


def campus(name, w, d):
    M = L()
    P = []
    for (cx, cy, bw, bd, fl) in ((-w * 0.25, -d * 0.18, w * 0.4, d * 0.32, 4), (w * 0.22, d * 0.1, w * 0.42, d * 0.36, 5), (-w * 0.2, d * 0.3, w * 0.36, d * 0.24, 3)):
        q, _ = office_block(name, cx - bw / 2, cy - bd / 2, cx + bw / 2, cy + bd / 2, fl, upper='office', ground='goffice', M=M)
        P += q
    return finish_lm(name, P)


def mitsukoshi():
    def extra(M, top):
        return [box('band', (55.4, 29.4, 2.2), (0, 0, top - 1.2), M['green']),
                text3d('sign', '三越', 2.4, (0, -14.9, top - 1.2), '-Y', M['cream'], font=MINCHO)]
    return simple_office('mitsukoshi', 55, 29, 7, upper='shop', ground='gshop', extra=extra)


def iyogin():
    def extra(M, top):
        return [box('band', (40.4, 24.4, 2.0), (0, 0, top + 0.2), M['green']),
                text3d('sign', '伊予銀行', 1.6, (0, -12.4, top + 0.2), '-Y', M['white'])]
    return simple_office('iyogin', 40, 24, 9, upper='glass', ground='goffice', extra=extra)


def fujigran():
    def extra(M, top):
        return [box('signtower', (5, 5, 14), (34, -18, 7), M['red']),
                text3d('sign', 'フジ', 2.2, (34, -20.6, 10), '-Y', M['white']),
                text3d('sign2', 'フジグラン', 2.0, (0, -24.2, top - 2.0), '-Y', M['red'])]
    return simple_office('fujigran', 80, 48, 2, upper='shop', ground='gshop', extra=extra)


def cityhall():
    return simple_office('cityhall', 48, 28, 9, upper='office', ground='goffice', sign='松山市役所')


def shiki():
    return simple_office('shiki', 26, 19, 3, upper='glass', ground='goffice', sign='子規記念博物館')


def artmuseum():
    M = L()
    P, top = office_block('am', -16, -14, 4, 14, 2, upper='glass', ground='goffice', M=M)
    q, _ = office_block('am2', 2, -8, 16, 12, 1, upper='office', ground='goffice', M=M)
    P += q
    P.append(text3d('sign', '愛媛県美術館', 1.0, (-6, -14.15, 3.0), '-Y', M['dark']))
    return finish_lm('artmuseum', P)


def sakakumo():
    """坂の上の雲ミュージアム（三角形平面のコンクリート＋ガラス）。"""
    M = L()
    tri = [(-15, -11), (15, -11), (0, 12)]
    o = prism('tri', tri, 0, 13.5, M['conc'], axis='Z')
    uv_project(o, 3.0)
    P = [o]
    # ガラスのスロープ帯
    for z in (3.5, 7.5, 11.0):
        g = prism('glassband', [(x * 1.01, y * 1.01) for x, y in tri], z, z + 1.2, M['glass'], axis='Z')
        P.append(g)
    P.append(text3d('sign', '坂の上の雲ミュージアム', 0.8, (0, -11.2, 1.6), '-Y', M['dark'], font=MINCHO))
    return finish_lm('sakakumo', P)


def ishiteji():
    M = L()
    P = []
    wood = mat('LM_TempleWood', '#7a4a2c', rough=0.7)
    # 本堂
    P.append(box('plat', (16, 12, 1.0), (-8, 6, 0.5), M['stone']))
    P += wall_block('hondo', -14, 1, -2, 11, 1.0, 5.5, wood, None, 0, win_mat=M['darkwood'], win_h=3.4, win_w=2.4, gap=3.0, win_z=0.45)
    P += hip_roof('hondor', -8, 6, 13, 11, 6.4, 4.2, 2.4, M['kawara'], upturn=0.7, fascia=M['darkwood'], gables=M['white'])
    # 三重塔
    px, py = 14, 12
    P.append(box('ptbase', (6.5, 6.5, 1.0), (px, py, 0.5), M['stone']))
    z = 1.0
    for i, (s, h) in enumerate(((5.0, 4.0), (4.3, 3.4), (3.6, 3.2))):
        P.append(box('pt%d' % i, (s, s, h), (px, py, z + h / 2), M['vermil']))
        z += h
        P += hip_roof('ptr%d' % i, px, py, s + 0.4, s + 0.4, z - 0.1, 1.2, 1.7, M['kawara'], upturn=0.6, fascia=M['darkwood'], ridge_ratio=0.02)
        z += 0.6
    P.append(cyl('sorin', 0.18, 7.5, (px, py, z + 3.0), M['gold'], verts=10))
    for k in range(9):
        P.append(cyl('ring', 0.45, 0.12, (px, py, z + 0.6 + k * 0.55), M['gold'], verts=12))
    # 仁王門
    P += wall_block('niomon', -6, -18, 6, -12, 0, 4.5, M['vermil'], None, 0)
    P += hip_roof('niomonr', 0, -15, 13, 7, 4.4, 2.6, 1.6, M['kawara'], upturn=0.5, fascia=M['darkwood'], gables=M['white'])
    P.append(text3d('sign', '石手寺', 0.8, (0, -18.1, 3.6), '-Y', M['gold'], font=MINCHO))
    return finish_lm('ishiteji', P)


def shrine():
    M = L()
    P = []
    P.append(box('plat', (20, 14, 0.8), (0, 4, 0.4), M['stone']))
    P += wall_block('honden', -8, -1, 8, 9, 0.8, 4.5, M['wood'], None, 0, win_mat=M['darkwood'], win_h=2.6, win_w=2.0, gap=3.0)
    P += hip_roof('hondenr', 0, 4, 17, 11, 5.2, 3.6, 2.4, M['copper'], upturn=0.3, fascia=M['darkwood'], gables=M['white'])
    # 大鳥居（参道の南、ゲームの y+52u=南21m）
    ty = -21
    for s in (-1, 1):
        P.append(cyl('hashira', 0.42, 7.5, (s * 3.6, ty, 3.75), M['vermil'], verts=16))
    P.append(box('kasagi', (10.5, 0.8, 0.6), (0, ty, 7.6), M['dark'], rot=None))
    P.append(box('shimaki', (9.6, 0.7, 0.4), (0, ty, 7.1), M['vermil']))
    P.append(box('nuki', (8.8, 0.45, 0.5), (0, ty, 6.0), M['vermil']))
    P.append(box('gakuzuka', (0.9, 0.3, 1.3), (0, ty - 0.1, 6.6), M['dark']))
    P.append(box('sando', (3.5, 22, 0.08), (0, -11, 0.04), M['stone']))
    return finish_lm('shrine', P)



def isaniwa():
    """伊佐爾波神社（石垣の上の朱塗りの回廊と楼門、八幡造の本殿。西側に135段の石段＝ゲームでは26段）。
    敷地中心が原点。石垣の上面は 6m（ゲーム側 DECKS と合わせる）。+X=東、石段は西(-X)。"""
    M = L()
    P = []
    hiwada = mat('LM_Hiwada', '#5a3a28', rough=0.8)
    gravel = mat('LM_Gravel', '#cbc5b6', rough=0.95)
    granite = mat('LM_Granite', '#8d897f', rough=0.85)
    H = 6.0
    # 石垣（台形）と上面の玉砂利
    P.append(batter_box('ishigaki', -20, -16.8, 20, 16.8, 0, H, 0.6, M['stone']))
    P.append(box('deck', (38.6, 32.4, 0.06), (0, 0, H + 0.03), gravel))
    # 石段（西）: X -30.4 → -19.4 で 0 → 6m
    n, x0, x1, w = 26, -30.4, -19.4, 7.2
    dx, dz = (x1 - x0) / n, H / n
    for i in range(n):
        P.append(box('step', (dx + 0.02, w + 1.0, (i + 1) * dz), (x0 + dx * (i + 0.5), 0, (i + 1) * dz / 2), granite))
    ang = math.atan2(H, x1 - x0)
    L2 = math.hypot(H, x1 - x0)
    for sy in (-1, 1):   # 両側の石の手すり壁（斜め）
        P.append(box('rail', (L2 + 0.6, 0.5, 0.9), ((x0 + x1) / 2, sy * (w / 2 + 0.25), H / 2 + 0.55), granite, rot=('Y', -ang)))
    # 石段下の石鳥居
    tx = -31.9
    for sy in (-1, 1):
        P.append(cyl('thashira', 0.32, 5.0, (tx, sy * 2.6, 2.5), granite, verts=14))
    P.append(box('tkasagi', (0.6, 7.4, 0.45), (tx, 0, 5.15), granite))
    P.append(box('tnuki', (0.4, 6.2, 0.35), (tx, 0, 4.3), granite))
    # 楼門（回廊の西辺の中央。通り抜けられるよう柱だけ）
    gx0, gx1, gw = -17.0, -11.0, 5.2
    for (px, py) in ((gx0, -gw), (gx0, gw), (gx1, -gw), (gx1, gw), (gx0, -2.4), (gx0, 2.4), (gx1, -2.4), (gx1, 2.4)):
        P.append(cyl('rpost', 0.28, 4.6, (px, py, H + 2.3), M['vermil'], verts=12))
    P += hip_roof('rkoshi', (gx0 + gx1) / 2, 0, gx1 - gx0 + 0.6, 2 * gw + 0.6, H + 4.5, 0.9, 1.1, hiwada, upturn=0.35, fascia=M['darkwood'])
    P += wall_block('rupper', gx0 + 0.6, -gw + 0.6, gx1 - 0.6, gw - 0.6, H + 5.2, 2.6, M['vermil'], None, 0, win_mat=M['white'], win_h=1.2, win_w=1.4, gap=2.0)
    P += hip_roof('rroof', (gx0 + gx1) / 2, 0, gx1 - gx0 + 0.4, 2 * gw + 0.4, H + 7.9, 2.6, 1.5, hiwada, upturn=0.65, fascia=M['darkwood'], gables=M['white'])
    for sy in (-1, 1):   # 釣り灯籠（夜に灯る）
        P.append(box('tourou', (0.45, 0.45, 0.6), (gx0 - 0.5, sy * 1.6, H + 3.7), M['glow']))
    # 回廊（外側は白壁＋朱の柱、内側は柱だけ）。西辺は楼門の所が切れる
    cx0, cx1, cy0, cy1, cw, ch = -15.0, 15.0, -13.0, 13.0, 3.0, 3.2
    segs = [('x', cx0, cx1, cy0, -1), ('x', cx0, cx1, cy1, 1), ('y', cy0 + cw, cy1 - cw, cx1, 1),
            ('y', cy0 + cw, -gw, cx0, -1), ('y', gw, cy1 - cw, cx0, -1)]
    for (ax, a0, a1, fixed, sg) in segs:
        L3 = a1 - a0
        mid = (a0 + a1) / 2
        inner = fixed - sg * cw
        if ax == 'x':
            P.append(box('kwall', (L3, 0.3, ch), (mid, fixed - sg * 0.15, H + ch / 2), M['white']))
            P.append(box('kfloor', (L3, cw, 0.3), (mid, fixed - sg * cw / 2, H + 0.15), M['darkwood']))
            k = max(2, int(L3 / 2.6))
            for i in range(k + 1):
                xx = a0 + L3 * i / k
                P.append(box('kpo', (0.26, 0.26, ch), (xx, fixed - sg * 0.3, H + ch / 2), M['vermil']))
                P.append(cyl('kpi', 0.14, ch, (xx, inner + sg * 0.2, H + ch / 2), M['vermil'], verts=8))
            P += hip_roof('kroof', mid, fixed - sg * cw / 2, L3 + 0.6, cw + 0.4, H + ch, 1.3, 0.7, hiwada, upturn=0.15, thick=0.2, ridge_ratio=0.98)
        else:
            P.append(box('kwall', (0.3, L3, ch), (fixed - sg * 0.15, mid, H + ch / 2), M['white']))
            P.append(box('kfloor', (cw, L3, 0.3), (fixed - sg * cw / 2, mid, H + 0.15), M['darkwood']))
            k = max(2, int(L3 / 2.6))
            for i in range(k + 1):
                yy = a0 + L3 * i / k
                P.append(box('kpo', (0.26, 0.26, ch), (fixed - sg * 0.3, yy, H + ch / 2), M['vermil']))
                P.append(cyl('kpi', 0.14, ch, (inner + sg * 0.2, yy, H + ch / 2), M['vermil'], verts=8))
            P += hip_roof('kroof', fixed - sg * cw / 2, mid, cw + 0.4, L3 + 0.6, H + ch, 1.3, 0.7, hiwada, upturn=0.15, thick=0.2, ridge_ratio=0.98)
    # 申殿（拝殿）と八幡造の本殿（前後二棟の切妻を並べる）
    P.append(box('haiplat', (7, 9, 0.6), (-3, 0, H + 0.3), granite))
    P += wall_block('haiden', -6, -4, 0, 4, H + 0.6, 3.2, M['vermil'], None, 0, win_mat=M['gold'], win_h=0.5, win_w=1.6, gap=2.2, win_z=0.85)
    P += hip_roof('haidenr', -3, 0, 7.4, 9.4, H + 3.8, 2.2, 1.2, hiwada, upturn=0.5, fascia=M['darkwood'], gables=M['white'])
    P.append(box('honplat', (10, 12, 0.9), (8, 0, H + 0.45), granite))
    P += wall_block('honden', 3.5, -5, 12.5, 5, H + 0.9, 3.8, M['vermil'], None, 0, win_mat=M['gold'], win_h=0.6, win_w=1.8, gap=2.4, win_z=0.8)
    for xc in (5.8, 10.2):
        P += hip_roof('hondenr', xc, 0, 4.8, 11.0, H + 4.7, 2.4, 0.9, hiwada, upturn=0.45, fascia=M['darkwood'], gables=M['gold'])
    # 石灯籠（楼門の前）
    for sy in (-1, 1):
        for xx in (-18.6,):
            P.append(box('lbase', (0.8, 0.8, 0.5), (xx, sy * 4.2, H + 0.25), granite))
            P.append(cyl('lpole', 0.18, 1.2, (xx, sy * 4.2, H + 1.1), granite, verts=8))
            P.append(box('lfire', (0.6, 0.6, 0.5), (xx, sy * 4.2, H + 1.95), M['glow']))
            P.append(box('lroof', (1.0, 1.0, 0.25), (xx, sy * 4.2, H + 2.3), granite))
    P.append(text3d('sign', '伊佐爾波神社', 0.5, (gx0 - 0.35, 0, H + 6.0), '-X', M['gold'], font=MINCHO))
    return finish_lm('isaniwa', P)


def tsubaki():
    """椿神社（伊豫豆比古命神社）。北の大鳥居から石灯籠の並ぶ参道、楼門、銅板葺きの大きな拝殿、本殿。
    敷地中心が原点（±22m × ±18m）、参道は北(+Y)へ 44m まで。"""
    M = L()
    P = []
    granite = mat('LM_Granite', '#8d897f', rough=0.85)
    paving = mat('LM_Paving', '#bdb7aa', rough=0.9)
    gravel = mat('LM_Gravel', '#cbc5b6', rough=0.95)
    P.append(box('ground', (44, 36, 0.06), (0, 0, 0.03), gravel))
    P.append(box('sando', (6, 30, 0.08), (0, 30, 0.04), paving))
    P.append(box('sando2', (5, 16, 0.08), (0, 9, 0.05), paving))
    # 大鳥居（朱・両部鳥居風）
    ty = 42.5
    for sx in (-1, 1):
        P.append(cyl('ohashira', 0.6, 10.0, (sx * 4.6, ty, 5.0), M['vermil'], verts=18))
        P.append(cyl('ohakama', 0.85, 1.0, (sx * 4.6, ty, 0.5), M['dark'], verts=18))
        for sy in (-1, 1):   # 稚児柱
            P.append(cyl('chigo', 0.25, 3.2, (sx * 4.6, ty + sy * 1.1, 1.6), M['vermil'], verts=10))
    P.append(box('okasagi', (14.5, 1.3, 0.9), (0, ty, 10.3), M['dark']))
    P.append(box('oshimaki', (13.2, 1.1, 0.6), (0, ty, 9.6), M['vermil']))
    P.append(box('onuki', (12.0, 0.7, 0.7), (0, ty, 8.0), M['vermil']))
    P.append(box('ogaku', (1.4, 0.4, 1.9), (0, ty - 0.2, 8.85), M['dark']))
    # 参道の石灯籠（夜に灯る）
    for yy in (22, 28, 34):
        for sx in (-1, 1):
            x = sx * 4.6
            P.append(box('lbase', (1.0, 1.0, 0.6), (x, yy, 0.3), granite))
            P.append(cyl('lpole', 0.22, 1.5, (x, yy, 1.35), granite, verts=8))
            P.append(box('lfire', (0.75, 0.75, 0.6), (x, yy, 2.4), M['glow']))
            P.append(box('lroof', (1.3, 1.3, 0.3), (x, yy, 2.85), granite))
            P.append(cyl('lhoju', 0.18, 0.4, (x, yy, 3.2), granite, verts=8))
    # 玉垣（石の低い垣）: 北面の楼門の所は開ける
    for (a0, a1, fixed, ax) in ((-22, -6, 18, 'x'), (6, 22, 18, 'x'), (-22, 22, -18, 'x'), (-18, 18, -22, 'y'), (-18, 18, 22, 'y')):
        Lg = a1 - a0
        if ax == 'x':
            P.append(box('tamarail', (Lg, 0.3, 0.25), ((a0 + a1) / 2, fixed, 1.05), granite))
            P.append(box('tamabase', (Lg, 0.4, 0.3), ((a0 + a1) / 2, fixed, 0.15), granite))
            for i in range(int(Lg / 1.6) + 1):
                P.append(box('tamapost', (0.28, 0.28, 1.2), (a0 + i * Lg / int(Lg / 1.6), fixed, 0.6), granite))
        else:
            P.append(box('tamarail', (0.3, Lg, 0.25), (fixed, (a0 + a1) / 2, 1.05), granite))
            P.append(box('tamabase', (0.4, Lg, 0.3), (fixed, (a0 + a1) / 2, 0.15), granite))
            for i in range(int(Lg / 1.6) + 1):
                P.append(box('tamapost', (0.28, 0.28, 1.2), (fixed, a0 + i * Lg / int(Lg / 1.6), 0.6), granite))
    # 楼門（柱だけ＋二重の屋根）
    for (px, py) in ((-6, 16), (6, 16), (-6, 20), (6, 20), (-2.6, 16), (2.6, 16), (-2.6, 20), (2.6, 20)):
        P.append(cyl('rpost', 0.32, 5.0, (px, py, 2.5), M['vermil'], verts=12))
    P += hip_roof('rkoshi', 0, 18, 12.8, 4.8, 5.0, 1.0, 1.2, M['copper'], upturn=0.35, fascia=M['darkwood'])
    P += wall_block('rupper', -5.4, 16.6, 5.4, 19.4, 5.7, 2.8, M['vermil'], None, 0, win_mat=M['white'], win_h=1.3, win_w=1.5, gap=2.2)
    P += hip_roof('rroof', 0, 18, 12.4, 4.6, 8.5, 2.8, 1.7, M['copper'], upturn=0.7, fascia=M['darkwood'], gables=M['white'])
    P.append(text3d('sign', '伊豫豆比古命神社', 0.42, (0, 20.45, 7.2), '+Y', M['gold'], font=MINCHO))
    for sx in (-1, 1):
        P.append(box('tourou', (0.5, 0.5, 0.7), (sx * 1.6, 20.6, 4.1), M['glow']))
    # 拝殿（大きな入母屋・銅板葺き）
    P.append(box('haiplat', (24, 16, 0.8), (0, 1, 0.4), granite))
    P += wall_block('haiden', -11, -6, 11, 8, 0.8, 5.2, M['white'], None, 0, win_mat=M['darkwood'], win_h=3.4, win_w=2.6, gap=3.2, win_z=0.5)
    for (px, py) in [(x, y) for x in (-11, -5.5, 0, 5.5, 11) for y in (-6, 8)]:
        P.append(box('hpost', (0.5, 0.5, 5.2), (px, py + (0.15 if py > 0 else -0.15), 3.4), M['vermil']))
    P.append(box('hbeam', (22.4, 0.5, 0.5), (0, 8.2, 5.8), M['vermil']))
    P.append(box('saisen', (4.0, 1.2, 1.0), (0, 9.2, 1.3), M['darkwood']))
    P += hip_roof('haidenr', 0, 1, 24, 16, 6.2, 5.8, 2.8, M['copper'], upturn=0.75, fascia=M['darkwood'], gables=M['white'])
    P += hip_roof('kohai', 0, 10.4, 6.5, 3.6, 5.2, 1.6, 1.0, M['copper'], upturn=0.5, fascia=M['darkwood'])   # 向拝
    for sx in (-1, 1):
        P.append(box('kohaipost', (0.4, 0.4, 4.6), (sx * 3.0, 11.6, 3.1), M['vermil']))
    # 本殿（奥）
    P.append(box('honplat', (14, 9, 1.0), (0, -12.5, 0.5), granite))
    P += wall_block('honden', -6, -16, 6, -9, 1.0, 4.2, M['vermil'], None, 0, win_mat=M['gold'], win_h=0.6, win_w=1.8, gap=2.4, win_z=0.85)
    P += hip_roof('hondenr', 0, -12.5, 13, 8, 5.2, 3.6, 1.6, M['copper'], upturn=0.6, fascia=M['darkwood'], gables=M['gold'])
    # 授与所（東の脇）
    P += wall_block('juyo', 13, 4, 20, 11, 0, 3.4, M['white'], None, 0, win_mat=M['glow'], win_h=1.2, win_w=1.6, gap=2.2)
    P += hip_roof('juyor', 16.5, 7.5, 8, 8, 3.4, 2.2, 1.0, M['kawara'], upturn=0.3, fascia=M['darkwood'])
    return finish_lm('tsubaki', P)


def shibi(name, x, y, z, s, m):
    """鴟尾（大棟の両端の魚の尾びれ形の飾り）。s=+1 で +X 端（外へ反る）。"""
    parts = [box(name + '_b', (0.9, 0.5, 1.0), (x, y, z + 0.5), m)]
    parts.append(box(name + '_f', (0.5, 0.42, 1.5), (x + s * 0.35, y, z + 1.25), m, rot=('Y', s * 0.42)))
    parts.append(box(name + '_t', (0.42, 0.38, 0.7), (x + s * 0.85, y, z + 1.95), m, rot=('Y', s * 0.95)))
    return parts


def asuka():
    """道後温泉別館 飛鳥乃湯泉（2017年開業）と椿の湯、間の椿の中庭。
    原点＝敷地中心（ゲーム 7292,2197）。敷地 ±25.6m × ±13.6m、東(+X)が道後ハイカラ通り（アーケード）。
    飛鳥乃湯泉: 飛鳥時代の様式（石の基壇、朱の柱と白壁、緑の連子窓、裳階、大屋根の両端に鴟尾）、入口は東の中庭側。
    椿の湯: 白壁と焦げ茶の柱の入母屋、入口は東のアーケード側。"""
    M = L()
    P = []
    granite = mat('LM_Granite', '#8d897f', rough=0.85)
    paving = mat('LM_Paving', '#bdb7aa', rough=0.9)
    gravel = mat('LM_Gravel', '#cbc5b6', rough=0.95)
    renji = mat('LM_RenjiGreen', '#3f7a5c', rough=0.5)        # 連子窓の緑
    shibi_m = mat('LM_ShibiGold', '#b8913e', metal=0.8, rough=0.35)
    leaf = mat('LM_TsubakiLeaf', '#24452a', rough=0.7)
    flower = mat('LM_TsubakiRed', '#c4202e', rough=0.5)
    noren_a = mat('Noren_Asuka', '#5a2a4a', rough=0.9)
    noren_t = mat('Noren_Tsubaki', '#9a1f2c', rough=0.9)
    # 地面（中庭は玉砂利、通路は石畳）
    P.append(box('ground', (51.2, 27.2, 0.06), (0, 0, 0.03), gravel))
    P.append(box('path', (27.4, 3.0, 0.1), (11.9, 0.0, 0.05), paving))          # 飛鳥乃湯泉の入口から東へ
    P.append(box('path2', (3.6, 4.8, 0.1), (23.8, -3.9, 0.05), paving))         # 椿の湯の前へ
    # ---------- 飛鳥乃湯泉 ----------
    bx0, bx1, by0, by1 = -24.0, -2.4, -10.4, 10.4
    cx, cy = (bx0 + bx1) / 2, 0.0
    P.append(box('kidan', (bx1 - bx0 + 1.2, by1 - by0 + 1.2, 0.7), (cx, cy, 0.35), granite))   # 基壇
    for (sx, z0, h, x0, x1, y0, y1) in (('1', 0.7, 4.4, bx0 + 0.8, bx1 - 0.8, by0 + 0.8, by1 - 0.8),
                                        ('2', 6.4, 3.2, bx0 + 3.4, bx1 - 3.4, by0 + 3.4, by1 - 3.4)):
        P.append(box('akabe' + sx, (x1 - x0, y1 - y0, h), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + h / 2), M['white']))
        # 朱の柱（壁の外に半分出す）と頭貫・腰長押
        for (axis, c0, c1, fixed, sgn) in (('x', x0, x1, y0, -1), ('x', x0, x1, y1, 1), ('y', y0, y1, x0, -1), ('y', y0, y1, x1, 1)):
            n = max(2, int(round((c1 - c0) / 2.7)))
            for i in range(n + 1):
                c = c0 + (c1 - c0) * i / n
                pos = (c, fixed + sgn * 0.12, z0 + h / 2) if axis == 'x' else (fixed + sgn * 0.12, c, z0 + h / 2)
                P.append(cyl('hashira', 0.2, h, pos, M['vermil'], verts=10))
                if i < n:   # 柱間の連子窓（緑の格子、夜は障子が灯る）
                    cm = c + (c1 - c0) / n / 2
                    wsz = (c1 - c0) / n * 0.62
                    if axis == 'x':
                        P.append(box('shoji', (wsz, 0.05, h * 0.36), (cm, fixed + sgn * 0.03, z0 + h * 0.55), M['glow']))
                        for k in range(7):
                            P.append(box('renji', (0.07, 0.1, h * 0.36), (cm - wsz / 2 + wsz * (k + 0.5) / 7, fixed + sgn * 0.09, z0 + h * 0.55), renji))
                    else:
                        P.append(box('shoji', (0.05, wsz, h * 0.36), (fixed + sgn * 0.03, cm, z0 + h * 0.55), M['glow']))
                        for k in range(7):
                            P.append(box('renji', (0.1, 0.07, h * 0.36), (fixed + sgn * 0.09, cm - wsz / 2 + wsz * (k + 0.5) / 7, z0 + h * 0.55), renji))
            Lb = c1 - c0
            for zz, hh in ((z0 + h - 0.25, 0.4), (z0 + h * 0.25, 0.22)):
                if axis == 'x':
                    P.append(box('nuki', (Lb + 0.4, 0.34, hh), ((c0 + c1) / 2, fixed + sgn * 0.14, zz), M['vermil']))
                else:
                    P.append(box('nuki', (0.34, Lb + 0.4, hh), (fixed + sgn * 0.14, (c0 + c1) / 2, zz), M['vermil']))
    # 裳階（1階の屋根）と大屋根（寄棟）・鴟尾
    P += hip_roof('mokoshi', cx, cy, bx1 - bx0 - 1.2, by1 - by0 - 1.2, 5.1, 1.5, 1.5, M['kawara'], upturn=0.3, thick=0.3, fascia=M['vermil'], ridge_ratio=0.6)
    P += hip_roof('ooyane', cx, cy, bx1 - bx0 - 6.0, by1 - by0 - 6.0, 9.6, 4.0, 2.2, M['kawara'], upturn=0.5, fascia=M['vermil'], ridge_ratio=0.62)
    ax_, ay_ = (bx1 - bx0 - 6.0) / 2 + 2.2, (by1 - by0 - 6.0) / 2 + 2.2
    rl = max(0.3, ax_ * 0.62 + (ax_ - ay_) * 0.38)   # hip_roof の大棟の半長と同じ式
    for s in (-1, 1):
        P += shibi('shibi', cx + s * (rl + 0.1), cy, 9.6 + 4.0 + 0.35, s, shibi_m)
    # 入口（東面・中庭側）: 朱の柱の車寄せ＋暖簾＋扁額
    ex = bx1 + 0.6
    for (px, py) in ((ex + 2.6, -2.6), (ex + 2.6, 2.6), (ex, -2.6), (ex, 2.6)):
        P.append(cyl('ehashira', 0.22, 4.2, (px, py, 0.7 + 2.1), M['vermil'], verts=10))
    P += hip_roof('eroof', ex - 0.6, 0, 7.6, 6.0, 4.9, 1.7, 0.8, M['kawara'], upturn=0.35, thick=0.25, fascia=M['vermil'], gables=M['white'], ridge_ratio=0.9)   # 妻を東へ
    P.append(box('estep', (3.4, 6.4, 0.7), (ex + 1.3, 0, 0.35), granite))
    P.append(box('noren', (0.08, 3.6, 1.3), (bx1 - 0.7, 0, 3.6), noren_a))
    P.append(text3d('noren_t', '飛鳥乃湯泉', 0.42, (bx1 - 0.62, 0, 3.6), '+X', M['white'], font=MINCHO))
    P.append(box('gaku', (0.12, 4.6, 0.9), (ex + 2.75, 0, 5.05), M['darkwood']))
    P.append(text3d('gaku_t', '道後温泉別館', 0.42, (ex + 2.83, 0, 5.05), '+X', M['gold'], font=MINCHO))
    # ---------- 椿の湯 ----------
    tx0, tx1, ty0, ty1 = 9.0, 22.0, -12.6, -1.8
    tcx, tcy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    P.append(box('tplinth', (tx1 - tx0 + 0.8, ty1 - ty0 + 0.8, 0.4), (tcx, tcy, 0.2), granite))
    P += wall_block('tkabe', tx0, ty0, tx1, ty1, 0.4, 4.8, M['white'], M['darkwood'], 0.22, win_mat=M['glow'], win_h=1.3, win_w=1.6, gap=2.6, win_z=0.6)
    for (axis, c0, c1, fixed, sgn) in (('x', tx0, tx1, ty0, -1), ('x', tx0, tx1, ty1, 1), ('y', ty0, ty1, tx0, -1), ('y', ty0, ty1, tx1, 1)):
        n = max(2, int(round((c1 - c0) / 2.6)))
        for i in range(n + 1):
            c = c0 + (c1 - c0) * i / n
            pos = (c, fixed + sgn * 0.06, 2.8) if axis == 'x' else (fixed + sgn * 0.06, c, 2.8)
            P.append(box('tpost', (0.24, 0.24, 4.8), pos, M['darkwood']))
    P += hip_roof('troof', tcx, tcy, tx1 - tx0 + 0.6, ty1 - ty0 + 0.6, 5.2, 3.4, 1.6, M['kawara'], upturn=0.4, fascia=M['darkwood'], ridge_ratio=0.35)
    # 入口（東・アーケード側）: 唐破風風の切妻の車寄せ＋えんじの暖簾
    ez = tx1 + 0.2
    for py in (tcy - 2.4, tcy + 2.4):
        P.append(box('tepost', (0.3, 0.3, 3.8), (ez + 2.2, py, 2.3), M['darkwood']))
    P += hip_roof('teroof', ez - 0.6, tcy, 6.8, 5.6, 4.6, 1.6, 0.7, M['kawara'], upturn=0.45, thick=0.25, fascia=M['darkwood'], gables=M['white'], ridge_ratio=0.9)   # 妻をアーケードへ
    P.append(box('tnoren', (0.08, 3.4, 1.3), (tx1 + 0.06, tcy, 3.0), noren_t))
    P.append(text3d('tnoren_t', '椿の湯', 0.6, (tx1 + 0.14, tcy, 3.0), '+X', M['white'], font=MINCHO))
    P.append(box('tgaku', (0.12, 3.8, 0.8), (ez + 2.36, tcy, 4.55), M['darkwood']))
    P.append(text3d('tgaku_t', '道後温泉 椿の湯', 0.36, (ez + 2.44, tcy, 4.55), '+X', M['gold'], font=MINCHO))
    # ---------- 中庭の椿（聖徳太子の碑文にちなむ椿の森）と石灯籠・築地塀 ----------
    import random
    rnd = random.Random(1207)
    spots = [(x, y) for x in (3.6, 7.4, 11.2, 15.0, 18.8, 22.6) for y in (4.6, 8.4, 12.0)] + \
            [(x, y) for x in (2.6, 6.2) for y in (-11.4, -7.6, -4.0)]
    for (x, y) in spots:
        r = 0.9 + rnd.random() * 0.6
        P.append(ico('tsubaki', r, (x, y, r * 0.95), leaf, sub=2, scale=(1.0, 1.0, 1.15)))
        for k in range(6):
            a = rnd.random() * math.tau
            zz = r * (0.5 + rnd.random() * 0.9)
            rr = r * 0.92
            P.append(ico('hana', 0.14, (x + math.cos(a) * rr, y + math.sin(a) * rr, zz), flower, sub=1))
    for (x, y) in ((2.8, -3.0), (2.8, 3.0)):
        P.append(box('lbase', (0.8, 0.8, 0.5), (x, y, 0.25), granite))
        P.append(cyl('lpole', 0.18, 1.2, (x, y, 1.1), granite, verts=8))
        P.append(box('lfire', (0.6, 0.6, 0.5), (x, y, 1.95), M['glow']))
        P.append(box('lroof', (1.0, 1.0, 0.25), (x, y, 2.3), granite))
    for (a0, a1, fixed, ax) in ((-25.6, 25.6, -13.4, 'x'), (-25.6, 25.6, 13.4, 'x'), (-13.4, 13.4, -25.4, 'y')):
        Lw = a1 - a0
        if ax == 'x':
            P.append(box('tsuiji', (Lw, 0.6, 1.9), ((a0 + a1) / 2, fixed, 0.95), M['white']))
            P.append(box('tsuijir', (Lw + 0.2, 1.0, 0.25), ((a0 + a1) / 2, fixed, 2.0), M['kawara']))
        else:
            P.append(box('tsuiji', (0.6, Lw, 1.9), (fixed, (a0 + a1) / 2, 0.95), M['white']))
            P.append(box('tsuijir', (1.0, Lw + 0.2, 0.25), (fixed, (a0 + a1) / 2, 2.0), M['kawara']))
    return finish_lm('asuka', P)


def tsuiji(P, M, segs, h=1.9):
    """築地塀（白壁＋瓦の笠）。segs: (a0, a1, fixed, 'x'|'y')"""
    for (a0, a1, fixed, ax) in segs:
        Lw = a1 - a0
        if Lw <= 0.1:
            continue
        if ax == 'x':
            P.append(box('tsuiji', (Lw, 0.6, h), ((a0 + a1) / 2, fixed, h / 2), M['white']))
            P.append(box('tsuijir', (Lw + 0.2, 1.0, 0.25), ((a0 + a1) / 2, fixed, h + 0.1), M['kawara']))
        else:
            P.append(box('tsuiji', (0.6, Lw, h), (fixed, (a0 + a1) / 2, h / 2), M['white']))
            P.append(box('tsuijir', (1.0, Lw + 0.2, 0.25), (fixed, (a0 + a1) / 2, h + 0.1), M['kawara']))


def sanmon(P, M, x, y, w, facing_y=True, name=None):
    """寺の山門（4本柱の薬医門風＋切妻の瓦屋根）。facing_y: 門の通り抜けがY方向。"""
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = (x + sx * w / 2, y + sy * 0.9) if facing_y else (x + sx * 0.9, y + sy * w / 2)
            P.append(box('mpost', (0.32, 0.32, 3.6), (px, py, 1.8), M['darkwood']))
    sx_, sy_ = (w + 2.0, 3.6) if facing_y else (3.6, w + 2.0)
    P.extend(hip_roof('mroof', x, y, sx_, sy_, 3.6, 1.6, 0.8, M['kawara'], upturn=0.35, thick=0.25, fascia=M['darkwood'], gables=M['white'], ridge_ratio=0.9))
    P.append(box('mbeam', (w + 0.6, 0.3, 0.35) if facing_y else (0.3, w + 0.6, 0.35), (x, y, 3.4), M['darkwood']))


def shikido():
    """子規堂（正宗寺の境内、松山市駅の南・末広町）。子規が17歳まで暮らした家の復元と、
    境内に展示されている坊っちゃん列車の客車。原点＝敷地中心、北(+Y)の路地に山門。敷地 ±16m × ±11.2m。"""
    M = L()
    P = []
    paving = mat('LM_Paving', '#bdb7aa', rough=0.9)
    gravel = mat('LM_Gravel', '#cbc5b6', rough=0.95)
    granite = mat('LM_Granite', '#8d897f', rough=0.85)
    coach = mat('LM_CoachBrown', '#5a2e1c', rough=0.5, coat=0.3)
    leaf = mat('LM_PineLeaf', '#2f5434', rough=0.8)
    P.append(box('ground', (32, 22.4, 0.06), (0, 0, 0.03), gravel))
    P.append(box('sando', (3.0, 9.0, 0.1), (0, 6.6, 0.05), paving))
    sanmon(P, M, 0, 10.6, 3.6)
    tsuiji(P, M, [(-16, -2.6, 10.9, 'x'), (2.6, 16, 10.9, 'x'), (-16, 16, -10.9, 'x'), (-10.9, 10.9, -15.7, 'y'), (-10.9, 10.9, 15.7, 'y')])
    # 正宗寺 本堂
    P.append(box('hplat', (12.6, 10.6, 0.6), (-8.5, -3.0, 0.3), granite))
    P += wall_block('hondo', -14.2, -7.8, -2.8, 1.8, 0.6, 3.8, M['darkwood'], None, 0, win_mat=M['glow'], win_h=1.6, win_w=1.6, gap=2.4, win_z=0.5)
    P += hip_roof('hondor', -8.5, -3.0, 12.0, 10.2, 4.4, 3.2, 1.4, M['kawara'], upturn=0.45, fascia=M['darkwood'], gables=M['white'], ridge_ratio=0.5)
    # 子規堂（平屋の木造、焦げ茶の板壁と障子）
    P += wall_block('shiki', 2.0, -8.6, 12.0, -1.6, 0.4, 3.0, M['darkwood'], M['white'], 0.0, win_mat=M['glow'], win_h=1.5, win_w=1.4, gap=2.0, win_z=0.55)
    P += hip_roof('shikir', 7.0, -5.1, 10.8, 7.8, 3.4, 2.2, 1.0, M['kawara'], upturn=0.25, fascia=M['darkwood'], ridge_ratio=0.55)
    P.append(box('shiki_gaku', (2.6, 0.1, 0.6), (7.0, -1.45, 2.95), M['darkwood']))
    P.append(text3d('shiki_t', '子規堂', 0.42, (7.0, -1.38, 2.95), '+Y', M['white'], font=MINCHO))
    # 坊っちゃん列車の客車（マッチ箱のような小さな木造客車）
    for sx in (-1, 1):
        P.append(box('rail', (9.0, 0.08, 0.12), (8.0, 4.4 + sx * 0.53, 0.18), M['steel']))
    P.append(box('ballast', (9.4, 2.2, 0.12), (8.0, 4.4, 0.06), granite))
    P.append(box('cbody', (6.6, 2.0, 1.9), (8.0, 4.4, 1.45), coach))
    P.append(box('croof', (7.0, 2.3, 0.18), (8.0, 4.4, 2.5), M['dark']))
    for k in range(6):
        for sy in (-1, 1):
            P.append(box('cwin', (0.62, 0.05, 0.6), (5.3 + k * 1.08, 4.4 + sy * 1.02, 1.75), M['glass']))
    for sx in (-1, 1):
        for xx in (6.0, 10.0):
            P.append(cyl('cwheel', 0.38, 0.1, (xx, 4.4 + sx * 0.6, 0.45), M['black'] if 'black' in M else M['dark'], verts=14, axis='Y'))
    # 松
    for (x, y) in ((-13.5, 8.4), (13.5, 8.4), (-1.0, -9.4)):
        P.append(cyl('ptrunk', 0.22, 3.2, (x, y, 1.6), M['darkwood'], verts=8))
        P.append(ico('pine', 1.6, (x, y, 3.6), leaf, sub=2, scale=(1.3, 1.3, 0.7)))
    P.append(box('stone', (0.6, 0.4, 1.4), (-2.2, 7.6, 0.7), granite))
    return finish_lm('shikido', P)


def hogonji():
    """宝厳寺（道後湯月町、上人坂を上りきった所。時宗の開祖・一遍上人の生誕地）。
    原点＝敷地中心、南(-Y)に山門と上人坂。敷地 ±12m × ±12.8m。"""
    M = L()
    P = []
    paving = mat('LM_Paving', '#bdb7aa', rough=0.9)
    gravel = mat('LM_Gravel', '#cbc5b6', rough=0.95)
    granite = mat('LM_Granite', '#8d897f', rough=0.85)
    leaf = mat('LM_PineLeaf', '#2f5434', rough=0.8)
    P.append(box('ground', (24, 25.6, 0.06), (0, 0, 0.03), gravel))
    P.append(box('sando', (3.0, 14.0, 0.1), (0, -5.6, 0.05), paving))
    sanmon(P, M, 0, -12.0, 3.4)
    tsuiji(P, M, [(-12, -2.5, -12.5, 'x'), (2.5, 12, -12.5, 'x'), (-12, 12, 12.5, 'x'), (-12.5, 12.5, -11.7, 'y'), (-12.5, 12.5, 11.7, 'y')])
    # 本堂（入母屋・瓦、正面に向拝）
    P.append(box('hplat', (15.0, 11.0, 0.8), (0, 4.5, 0.4), granite))
    P += wall_block('hondo', -6.8, 0.0, 6.8, 9.6, 0.8, 4.2, M['wood'], None, 0, win_mat=M['glow'], win_h=2.0, win_w=1.8, gap=2.6, win_z=0.45)
    P += hip_roof('hondor', 0, 4.8, 13.6, 9.6, 5.0, 4.0, 1.8, M['kawara'], upturn=0.5, fascia=M['darkwood'], gables=M['white'], ridge_ratio=0.5)
    for sx in (-1, 1):
        P.append(box('kohai_p', (0.3, 0.3, 3.6), (sx * 2.2, -1.6, 2.6), M['darkwood']))
    P += hip_roof('kohai', 0, -0.9, 5.4, 3.6, 4.2, 1.4, 0.6, M['kawara'], upturn=0.35, thick=0.22, fascia=M['darkwood'])
    P.append(box('gaku', (2.4, 0.1, 0.7), (0, -0.05, 4.4), M['darkwood']))
    P.append(text3d('gaku_t', '宝厳寺', 0.42, (0, -0.12, 4.4), '-Y', M['gold'], font=MINCHO))
    # 一遍上人御誕生之地の石碑（縦書き）
    P.append(box('hibase', (1.4, 0.9, 0.4), (-4.2, -7.0, 0.2), granite))
    P.append(box('hi', (0.9, 0.45, 3.4), (-4.2, -7.0, 2.1), granite))
    P += vtext3d('hi_t', '一遍上人御誕生之地', 0.3, (-4.2, -7.24, 3.55), '-Y', M['dark'], depth=0.03, font=MINCHO)
    for (x, y) in ((-9.5, -9.5), (9.5, -9.5), (9.0, 10.0)):
        P.append(cyl('ptrunk', 0.24, 3.4, (x, y, 1.7), M['darkwood'], verts=8))
        P.append(ico('pine', 1.7, (x, y, 3.8), leaf, sub=2, scale=(1.3, 1.3, 0.7)))
    return finish_lm('hogonji', P)


def himegin():
    """ひめぎんホール（愛媛県県民文化会館、道後町。電停「南町（県民文化会館前）」の脇）。
    石張りの大きな箱と舞台の塔、西の道後線側にガラスの大きなエントランスホール。原点＝敷地中心、敷地 ±18m × ±16m。"""
    M = L()
    P = []
    paving = mat('LM_Paving', '#bdb7aa', rough=0.9)
    stone = mat('LM_StoneClad', '#cfc8ba', rough=0.7)
    stone2 = mat('LM_StoneClad2', '#b8b0a2', rough=0.75)
    P.append(box('plaza', (36, 32, 0.08), (0, 0, 0.04), paving))
    # 本体（低層部＋大ホールの舞台塔）
    P.append(box('body', (28, 26, 12.0), (2.0, 0, 6.0), stone))
    for z in (4.0, 8.0):
        P.append(box('band', (28.2, 26.2, 0.25), (2.0, 0, z), stone2))
    P.append(box('fly', (13, 15, 11.0), (7.0, 0, 17.5), stone))
    P.append(box('flycap', (13.4, 15.4, 0.5), (7.0, 0, 23.2), stone2))
    P.append(box('roof', (27.6, 25.6, 0.3), (2.0, 0, 12.15), stone2))
    # ガラスのエントランスホール（西）＋大庇
    P.append(box('atrium', (5.0, 20.0, 10.0), (-14.5, 0, 5.0), M['glass']))
    for y in [-10 + 2.5 * i for i in range(9)]:
        P.append(box('mullion', (0.2, 0.2, 10.0), (-17.05, y, 5.0), M['steel']))
    for z in (3.4, 6.8):
        P.append(box('transom', (0.2, 20.0, 0.15), (-17.05, 0, z), M['steel']))
    P.append(box('atrium_roof', (5.6, 20.6, 0.4), (-14.5, 0, 10.2), stone2))
    P.append(box('canopy', (3.0, 12.0, 0.3), (-18.4, 0, 4.2), stone2))
    P.append(box('glowlobby', (0.1, 19.0, 9.0), (-12.05, 0, 5.0), M['glow']))
    # 館名
    P.append(text3d('name', 'ひめぎんホール', 1.3, (-12.12, 0, 11.2), '-X', M['dark'], font=GOTHIC))
    # 館銘板（前庭の石の台）
    P.append(box('meiban', (0.5, 4.2, 1.2), (-17.2, -13.0, 0.6), stone2))
    P.append(text3d('name2', '愛媛県県民文化会館', 0.4, (-17.5, -13.0, 0.75), '-X', M['dark'], font=GOTHIC))
    return finish_lm('himegin', P)

def stadium():
    """坊っちゃんスタジアム（すり鉢状のスタンド＋照明塔＋スコアボード）。"""
    M = L()
    rx, ry = 50, 35
    seat = mat('LM_Seat', '#2f6aa8', rough=0.6)
    P = []
    bm = bmesh.new()
    N = 72
    rings = []
    for k in range(8):
        t = k / 7
        s = 1.0 + t * 0.32
        z = 1.0 + t * 12.0
        rings.append([bm.verts.new((math.cos(a) * rx * s, math.sin(a) * ry * s, z)) for a in [i / N * math.tau for i in range(N)]])
    outer_top = rings[-1]
    outer_bot = [bm.verts.new((v.co.x, v.co.y, 0.0)) for v in outer_top]
    inner_bot = [bm.verts.new((v.co.x, v.co.y, 0.0)) for v in rings[0]]
    for k in range(7):
        for i in range(N):
            j = (i + 1) % N
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((outer_bot[i], outer_bot[j], outer_top[j], outer_top[i]))
        bm.faces.new((inner_bot[j], inner_bot[i], rings[0][i], rings[0][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bowl = mesh_from_bm('bowl', bm, [seat, M['conc']])
    for p in bowl.data.polygons:
        if abs(p.normal.z) < 0.3:
            p.material_index = 1
    P.append(bowl)
    for (x, y) in ((rx * 1.25, ry * 1.25), (-rx * 1.25, ry * 1.25), (rx * 1.25, -ry * 1.25), (-rx * 1.25, -ry * 1.25)):
        P.append(cyl('lt', 0.7, 34, (x, y, 17), M['steel'], verts=10))
        P.append(box('ltp', (6, 1.2, 3.5), (x, y, 35), mat('NightGlow_Light', '#e8eef2', rough=0.3, emit='#ffffff', estr=0.0)))
    P.append(box('score', (20, 2.4, 10), (0, ry * 1.38, 13), M['dark']))
    P.append(text3d('sign', '坊っちゃんスタジアム', 1.6, (0, ry * 1.38 - 1.3, 8.0), '-Y', M['white']))
    return finish_lm('stadium', P)


def airport():
    M = L()
    P, top = office_block('term', -35, -22, 35, 22, 2, upper='glass', ground='goffice', gH=5.0, M=M)
    P.append(box('roofwave', (74, 46, 0.6), (0, 0, top + 0.6), mat('LM_RoofWhite', '#eef0f0', rough=0.4)))
    P.append(text3d('sign', '松山空港', 2.0, (0, -22.4, top - 1.5), '-Y', M['blue']))
    # 管制塔（東）
    P.append(cyl('tower', 2.2, 24, (40, 10, 12), M['conc'], verts=16))
    P.append(cyl('cab', 4.0, 3.5, (40, 10, 25.5), M['glass'], verts=12))
    P.append(cyl('cabroof', 4.3, 0.6, (40, 10, 27.5), M['white'], verts=12))
    # 搭乗橋
    for y in (-12, 0, 12):
        P.append(box('bridge', (14, 3, 3), (-42, y, 5.5), M['steel']))
    return finish_lm('airport', P)


def port(name, w, d, sign):
    M = L()
    P, top = office_block(name, -w / 2, -d / 2, w / 2, d / 2, 2, upper='glass', ground='goffice', M=M)
    P.append(box('tower', (6, 6, top + 6), (w / 2 - 4, -d / 2 + 4, (top + 6) / 2), M['white']))
    P.append(text3d('sign', sign, 1.4, (0, -d / 2 - 0.15, top - 1.5), '-Y', M['blue']))
    return finish_lm(name, P)


def ropeway():
    M = L()
    P, top = office_block('rw', -10, -8, 10, 8, 1, upper='office', ground='gshop', M=M)
    P.append(text3d('sign', 'ロープウェイ', 1.0, (0, -8.15, 3.2), '-Y', M['dark']))
    P.append(box('house', (6, 8, 4), (0, 6, top + 2), M['white']))
    gon_root = empty('ropeway_gondola', (0, 10, top + 6))
    g = box('gon', (2.4, 3.2, 2.2), (0, 10, top + 5), mat('LM_Gon', '#e86830', rough=0.4), bevel=0.3)
    gw = box('gonw', (2.42, 2.4, 0.8), (0, 10, top + 5.3), M['glass'])
    gg = join([g, gw], 'gondola_body', smooth_angle=40)
    parent(gg, gon_root)
    return finish_lm('ropeway', P, [gon_root])


def radiotower():
    M = L()
    P = []
    red, white = M['red'], M['white']
    P += office_block('rt', -7, -6, 7, 6, 1, upper='office', ground='goffice', M=M)[0]
    H = 60.0
    legs = [(-6, -6), (6, -6), (6, 6), (-6, 6)]
    for (x, y) in legs:
        P.append(branch3('leg', (x, y, 4), (x * 0.12, y * 0.12, H), 0.25, red))
    for k in range(12):
        z = 6 + k * (H - 8) / 12
        f = 1 - (z - 4) / (H - 4) * 0.88
        col = red if k % 2 else white
        for a, b in zip(legs, legs[1:] + legs[:1]):
            P.append(branch3('br', (a[0] * f, a[1] * f, z), (b[0] * f, b[1] * f, z), 0.1, col))
            P.append(branch3('dg', (a[0] * f, a[1] * f, z), (b[0] * f * 0.93, b[1] * f * 0.93, z + (H - 8) / 12), 0.07, col))
    P.append(cyl('ant', 0.15, 8, (0, 0, H + 4), white, verts=8))
    P.append(ico('beacon', 0.5, (0, 0, H + 8.2), mat('NightGlow_Red', '#6a1a12', rough=0.2, emit='#ff4030', estr=0.0), sub=1))
    return finish_lm('radiotower', P)


def parktower():
    M = L()
    P = [cyl('tw', 3.0, 14, (0, 0, 7), M['cream'], verts=12)]
    P.append(cyl('top', 3.6, 1.0, (0, 0, 14.5), M['cream'], verts=12))
    cone = cyl('cone', 3.8, 5, (0, 0, 17.5), M['roofgreen'], verts=12, r2=0.1)
    P.append(cone)
    return finish_lm('parktower', P)


# ======================================================================
def build():
    reset()
    fonts()
    roots = [castle(), dogo_honkan(), western_station('dogo_station', 24, 13, True, '道後温泉駅'),
             western_station('takahama_station', 22, 12, False, '高浜駅'), bansuiso(), takashimaya(), jrstation(),
             cityhall(), prefoffice(), shiki(), ishiteji(), campus('campus_a', 110, 70), campus('campus_b', 98, 56),
             hospital(), police(), shrine(), stadium(), parktower(), airport(), port('port', 28, 34, '三津浜港'),
             port('ferryterminal', 52, 34, '松山観光港'), ropeway(), mitsukoshi(), sakakumo(), artmuseum(), iyogin(),
             fujigran(), radiotower(), school('school_a', 62, 26), school('school_b', 62, 22), isaniwa(), tsubaki(), asuka(), shikido(), hogonji(), himegin()]
    return roots


if __name__ == '__main__':
    roots = build()
    path = os.path.join(ASSETS, 'glb', 'landmarks.glb')
    bpy.ops.object.select_all(action='DESELECT')
    export_glb(path, roots, images='NONE')
    only = argv_after()
    if not only:
        # プレビュー：代表的なものを並べて撮る
        show = {'castle': (0, 0), 'dogo_honkan': (75, 0), 'dogo_station': (130, 0), 'bansuiso': (165, 0), 'takashimaya': (0, -90),
                'prefoffice': (85, -80), 'ishiteji': (150, -75), 'shrine': (205, -70), 'radiotower': (240, 0),
                'isaniwa': (40, 70), 'tsubaki': (130, 70), 'asuka': (210, 70)}
        for r in roots:
            r.location = (*show[r.name], 0) if r.name in show else (0, 4000, 0)
        preview(os.path.join(PREV, 'landmarks.png'), target=(115, -40, 8), dist=230, elev=24, azim=-62, lens=45, res=(1600, 900), samples=64)
        for r in roots:
            r.location = (0, 4000, 0)
        for r in roots:
            if r.name == 'castle':
                r.location = (0, 0, 0)
        preview(os.path.join(PREV, 'castle.png'), target=(2, 8, 8), dist=62, elev=18, azim=-58, lens=45, res=(1200, 800), samples=64)
        for r in roots:
            r.location = (0, 4000, 0)
            if r.name == 'dogo_honkan':
                r.location = (0, 0, 0)
        preview(os.path.join(PREV, 'dogo.png'), target=(0, -2, 6), dist=70, elev=20, azim=-70, lens=45, res=(1200, 800), samples=64)
    if not only or 'asuka' in only:
        for r in roots:
            r.location = (0, 4000, 0)
            if r.name == 'asuka':
                r.location = (0, 0, 0)
        preview(os.path.join(PREV, 'asuka.png'), target=(0, 0, 4), dist=58, elev=24, azim=-35, lens=45, res=(1400, 800), samples=48)
    if not only or 'new3' in only:
        pos = {'shikido': (0, 0), 'hogonji': (45, 0), 'himegin': (100, 0)}
        for r in roots:
            r.location = (*pos[r.name], 0) if r.name in pos else (0, 4000, 0)
        preview(os.path.join(PREV, 'new3.png'), target=(50, 0, 4), dist=120, elev=26, azim=-115, lens=45, res=(1600, 800), samples=48)
