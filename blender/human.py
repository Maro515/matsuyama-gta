"""人物モデル（スキンモディファイアで人体を生成＋アーマチュア＋歩行/走行/待機/着座アニメ）。
+X が正面、Z 上、身長約1.73m。マテリアル: Skin/Hair/Shirt/Pants/Shoes/Eye/Cap/Leaf
実行: Blender -b --factory-startup -P human.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# 骨格の節点（名前: 座標）
J = {
    'pelvis': (0.0, 0.0, 0.96), 'spine': (0.005, 0.0, 1.10), 'chest': (0.012, 0.0, 1.30), 'neck': (0.012, 0.0, 1.47),
    'headb': (0.016, 0.0, 1.575),
    'hip.L': (0.0, 0.094, 0.92), 'knee.L': (0.025, 0.1, 0.52), 'ankle.L': (-0.01, 0.1, 0.095), 'toe.L': (0.16, 0.102, 0.035),
    'cla.L': (0.0, 0.11, 1.425), 'sho.L': (-0.005, 0.195, 1.405), 'elb.L': (-0.03, 0.245, 1.13), 'wri.L': (-0.0, 0.262, 0.885),
    'hand.L': (0.02, 0.268, 0.79),
}
for k in list(J):
    if k.endswith('.L'):
        x, y, z = J[k]
        J[k[:-2] + '.R'] = (x, -y, z)
EDGES = [('pelvis', 'spine'), ('spine', 'chest'), ('chest', 'neck'), ('neck', 'headb')]
for s in ('L', 'R'):
    EDGES += [('pelvis', 'hip.' + s), ('hip.' + s, 'knee.' + s), ('knee.' + s, 'ankle.' + s), ('ankle.' + s, 'toe.' + s),
              ('chest', 'cla.' + s), ('cla.' + s, 'sho.' + s), ('sho.' + s, 'elb.' + s), ('elb.' + s, 'wri.' + s),
              ('wri.' + s, 'hand.' + s)]
RAD = {'pelvis': (0.13, 0.13), 'spine': (0.12, 0.12), 'chest': (0.135, 0.135), 'neck': (0.052, 0.052), 'headb': (0.05, 0.05),
       'hip': (0.092, 0.092), 'knee': (0.06, 0.06), 'ankle': (0.042, 0.042), 'toe': (0.036, 0.045),
       'cla': (0.075, 0.075), 'sho': (0.06, 0.06), 'elb': (0.043, 0.043), 'wri': (0.031, 0.031), 'hand': (0.03, 0.038)}

BONES = [  # 名前, 始点, 終点, 親
    ('hips', (0, 0, 0.93), (0, 0, 1.08), None),
    ('spine', (0, 0, 1.08), (0.005, 0, 1.28), 'hips'),
    ('chest', (0.005, 0, 1.28), (0.01, 0, 1.46), 'spine'),
    ('neck', (0.01, 0, 1.46), (0.012, 0, 1.56), 'chest'),
    ('head', (0.012, 0, 1.56), (0.012, 0, 1.80), 'neck'),
]
for s, sg in (('L', 1), ('R', -1)):
    def P(n):
        return J[n + '.' + s]
    BONES += [
        ('thigh.' + s, P('hip'), P('knee'), 'hips'),
        ('shin.' + s, P('knee'), P('ankle'), 'thigh.' + s),
        ('foot.' + s, P('ankle'), P('toe'), 'shin.' + s),
        ('upperarm.' + s, P('sho'), P('elb'), 'chest'),
        ('forearm.' + s, P('elb'), P('wri'), 'upperarm.' + s),
        ('hand.' + s, P('wri'), P('hand'), 'forearm.' + s),
    ]


def body_mesh(M):
    bm = bmesh.new()
    names = list(J)
    vs = {n: bm.verts.new(J[n]) for n in names}
    for a, b in EDGES:
        bm.edges.new((vs[a], vs[b]))
    o = mesh_from_bm('body', bm)
    sk = o.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    layer = o.data.skin_vertices[0].data
    for i, n in enumerate(names):
        base = n.split('.')[0]
        layer[i].radius = RAD[base]
        if n == 'pelvis':
            layer[i].use_root = True
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    bake(o)
    # 胴は左右に広く、前後に薄い楕円断面へ
    for v in o.data.vertices:
        c = v.co
        if 0.86 < c.z < 1.46 and abs(c.y) < 0.2:
            c.x = (c.x - 0.01) * 0.78 + 0.01
            c.y *= 1.12
    # 部位でマテリアル分け（最も近い骨格線分で判定）
    me = o.data
    for m in (M['shirt'], M['pants'], M['shoes'], M['skin']):
        me.materials.append(m)
    segs = [(a, b, Vector(J[a]), Vector(J[b])) for a, b in EDGES]
    for p in me.polygons:
        c = p.center
        best, bd = None, 9
        for a, b, A, B in segs:
            ab = B - A
            t = max(0, min(1, (c - A).dot(ab) / ab.length_squared))
            d = (A + ab * t - c).length
            if d < bd:
                bd, best = d, (a, b, t)
        a, b, t = best
        idx = 0  # shirt
        if a.startswith(('hip', 'knee')) or (a == 'pelvis' and b.startswith('hip')):
            idx = 1
        if a in ('pelvis', 'spine') and b in ('spine', 'chest', 'hip.L', 'hip.R'):
            idx = 1 if c.z < 0.975 else 0
        if a.startswith('ankle') or (a.startswith('knee') and t > 0.92):
            idx = 2
        if a.startswith('wri') or (a.startswith('elb') and t > 0.93):
            idx = 3
        if (a == 'chest' and b == 'neck' and c.z > 1.45) or a == 'neck':
            idx = 3
        p.material_index = idx
    return o


def head_parts(M):
    objs = []
    hc = Vector((0.018, 0, 1.635))
    h = sphere('head', 1.0, hc, M['skin'], seg=32, rings=22, scale=(0.098, 0.082, 0.118))
    # あご・頬のふくらみを少し前へ
    for v in h.data.vertices:
        w = h.matrix_world @ v.co
        if v.co.x > 0.3 and v.co.z < 0.1:
            v.co.x += 0.06
    objs.append(h)
    # 鼻
    n = ico('nose', 0.018, (hc.x + 0.095, 0, hc.z - 0.01), M['skin'], sub=1, scale=(1.0, 0.8, 1.3))
    objs.append(n)
    # 耳
    for s in (1, -1):
        objs.append(sphere('ear', 0.022, (hc.x - 0.005, s * 0.082, hc.z), M['skin'], seg=10, rings=6, scale=(0.6, 0.35, 1.0)))
    # 目・眉
    for s in (1, -1):
        objs.append(sphere('eye', 0.011, (hc.x + 0.083, s * 0.032, hc.z + 0.012), M['eye'], seg=10, rings=6))
        objs.append(box('brow', (0.012, 0.034, 0.007), (hc.x + 0.088, s * 0.033, hc.z + 0.035), M['hair']))
    # 髪（頭頂〜後頭部）
    hair = sphere('hair', 1.0, (hc.x - 0.01, 0, hc.z + 0.012), M['hair'], seg=40, rings=28, scale=(0.109, 0.093, 0.125))
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    # 額は高く、うなじは低い傾斜面で切る（局所座標は単位球）
    n = Vector((-0.55, 0, 1)).normalized()
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0.0, 0, 0.12), plane_no=-n, clear_outer=True)
    # 側頭部（もみあげ）
    bm.to_mesh(hair.data)
    bm.free()
    objs.append(hair)
    return objs


def cap_parts(M):
    hc = Vector((0.018, 0, 1.635))
    cap = sphere('Cap', 1.0, (hc.x - 0.005, 0, hc.z + 0.03), M['cap'], seg=24, rings=12, scale=(0.112, 0.097, 0.11))
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.05], context='VERTS')
    bm.to_mesh(cap.data)
    bm.free()
    brim = cyl('brim', 0.075, 0.01, (hc.x + 0.1, 0, hc.z + 0.025), M['cap'], verts=16)
    brim.scale = (1.0, 1.2, 1)
    stem = cyl('stem', 0.008, 0.03, (hc.x - 0.005, 0, hc.z + 0.155), M['leaf'], verts=8)
    leaf = box('leaf', (0.05, 0.025, 0.004), (hc.x + 0.015, 0.01, hc.z + 0.165), M['leaf'], rot=('Y', -0.4))
    o = join([cap, brim, stem, leaf], 'Cap', smooth_angle=60)
    return o


def build_armature():
    ad = bpy.data.armatures.new('Rig')
    arm = bpy.data.objects.new('Rig', ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for (n, h, t, par) in BONES:
        b = ad.edit_bones.new(n)
        b.head = Vector(h)
        b.tail = Vector(t)
        b.roll = 0
        if par:
            b.parent = eb[par]
            b.use_connect = False
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def skin_weights(o, arm, head_names=()):
    """骨線分への距離から重み付け（左右の取り違えを防ぐ）。"""
    bones = [(b.name, (arm.matrix_world @ b.head_local), (arm.matrix_world @ b.tail_local)) for b in arm.data.bones]
    groups = {n: o.vertex_groups.new(name=n) for n, _, _ in bones}
    me = o.data
    head_set = set()
    for p in me.polygons:
        pass
    for v in me.vertices:
        c = o.matrix_world @ v.co
        cand = []
        for n, A, B in bones:
            if n.endswith('.L') and c.y < -0.03:
                continue
            if n.endswith('.R') and c.y > 0.03:
                continue
            ab = B - A
            t = max(0, min(1, (c - A).dot(ab) / ab.length_squared))
            d = (A + ab * t - c).length
            cand.append((d, n))
        cand.sort()
        top = cand[:2]
        if c.z > 1.52:
            top = [(0.0, 'head')]
        ws = [1 / ((d + 0.012) ** 4) for d, _ in top]
        s = sum(ws)
        for (d, n), w in zip(top, ws):
            if w / s > 0.02:
                groups[n].add([v.index], w / s, 'REPLACE')


def pose_key(arm, bone, frame, axis=None, ang=0.0, q=None, loc=None):
    pb = arm.pose.bones[bone]
    pb.rotation_mode = 'QUATERNION'
    rest = arm.data.bones[bone].matrix_local.to_quaternion()
    if q is None:
        q = Quaternion(Vector(axis), ang)
    pb.rotation_quaternion = rest.inverted() @ q @ rest
    pb.keyframe_insert('rotation_quaternion', frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert('location', frame=frame)


def make_action(arm, name, frames, fn):
    arm.animation_data_create()
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for f in range(0, frames + 1, 2 if frames > 20 else 1):
        fn(f, f / frames)
    act = arm.animation_data.action
    act.name = name
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 0, act)
    try:
        if act.slots:
            st.action_slot = act.slots[0]
    except Exception:
        pass
    st.extrapolation = 'HOLD'
    arm.animation_data.action = None
    return act


Y = (0, 1, 0)
Z = (0, 0, 1)
X = (1, 0, 0)


def anim_walk(arm, f, t, run=False):
    w = 2 * math.pi * t
    A = 0.72 if run else 0.4         # 太ももの振り
    K = 1.15 if run else 0.62        # 膝の曲げ
    AR = 0.62 if run else 0.36       # 腕振り
    EL = 1.25 if run else 0.32
    lean = 0.16 if run else 0.03
    bob = (0.045 if run else 0.022) * math.cos(2 * w)
    pose_key(arm, 'hips', f, Z, 0.07 * math.sin(w), loc=(0, bob, 0))
    pose_key(arm, 'spine', f, Y, lean)
    pose_key(arm, 'chest', f, Z, -0.12 * math.sin(w) * (1.3 if run else 1))
    pose_key(arm, 'neck', f, Y, -lean * 0.6)
    pose_key(arm, 'head', f, Z, 0.05 * math.sin(w))
    for s, ph in (('L', 0.0), ('R', math.pi)):
        a = math.sin(w + ph)               # +で脚が前
        swing = math.cos(w + ph)           # 遊脚（前へ振り出し中）で +
        pose_key(arm, 'thigh.' + s, f, Y, -A * a - (0.12 if run else 0.0))
        knee = 0.08 + K * max(0.0, swing) ** 1.4 + (0.18 if run else 0.0)
        pose_key(arm, 'shin.' + s, f, Y, knee)
        pose_key(arm, 'foot.' + s, f, Y, -0.25 * a + 0.15 * max(0.0, -swing))
        pose_key(arm, 'upperarm.' + s, f, Y, AR * a)
        pose_key(arm, 'forearm.' + s, f, Y, -EL - (0.12 * max(0, -a) if not run else 0))
        pose_key(arm, 'hand.' + s, f, X, 0)


def anim_idle(arm, f, t):
    w = 2 * math.pi * t
    pose_key(arm, 'hips', f, Z, 0, loc=(0, 0.004 * math.sin(w), 0))
    pose_key(arm, 'spine', f, Y, 0.01 * math.sin(w))
    pose_key(arm, 'chest', f, Y, 0.02 * math.sin(w))
    pose_key(arm, 'neck', f, Z, 0.08 * math.sin(w * 0.5))
    pose_key(arm, 'head', f, Y, 0.03 * math.sin(w))
    for s, sg in (('L', 1), ('R', -1)):
        pose_key(arm, 'thigh.' + s, f, X, sg * 0.03)
        pose_key(arm, 'shin.' + s, f, Y, 0.04)
        pose_key(arm, 'foot.' + s, f, Y, 0)
        pose_key(arm, 'upperarm.' + s, f, X, sg * (0.06 + 0.01 * math.sin(w)))
        pose_key(arm, 'forearm.' + s, f, Y, -0.18)
        pose_key(arm, 'hand.' + s, f, X, 0)


def anim_sit(arm, f, t):
    pose_key(arm, 'hips', f, Z, 0, loc=(0, -0.12, 0))
    pose_key(arm, 'spine', f, Y, 0.22)
    pose_key(arm, 'chest', f, Y, 0.08)
    pose_key(arm, 'neck', f, Y, -0.2)
    pose_key(arm, 'head', f, Y, -0.08)
    for s, sg in (('L', 1), ('R', -1)):
        pose_key(arm, 'thigh.' + s, f, Y, -1.38)
        pose_key(arm, 'shin.' + s, f, Y, 1.45)
        pose_key(arm, 'foot.' + s, f, Y, -0.1)
        pose_key(arm, 'upperarm.' + s, f, Y, -0.95)
        pose_key(arm, 'forearm.' + s, f, Y, -0.55)
        pose_key(arm, 'hand.' + s, f, X, 0)


def build():
    reset()
    M = dict(
        skin=mat('Skin', '#e8c8a0', rough=0.6, spec=0.35),
        hair=mat('Hair', '#2c2620', rough=0.55, spec=0.4),
        shirt=mat('Shirt', '#d9d4c8', rough=0.85),
        pants=mat('Pants', '#3c4250', rough=0.85),
        shoes=mat('Shoes', '#2a2522', rough=0.5),
        eye=mat('Eye', '#151515', rough=0.2),
        cap=mat('CapOrange', '#ff8c1e', rough=0.5),
        leaf=mat('Leaf', '#3f8a3a', rough=0.6),
    )
    body = body_mesh(M)
    hp = head_parts(M)
    mesh = join([body] + hp, 'Body', smooth_angle=75)
    cap = cap_parts(M)
    arm = build_armature()
    for o in (mesh, cap):
        skin_weights(o, arm)
        o.parent = arm
        md = o.modifiers.new('arm', 'ARMATURE')
        md.object = arm
    # アニメ
    make_action(arm, 'walk', 24, lambda f, t: anim_walk(arm, f, t))
    make_action(arm, 'run', 16, lambda f, t: anim_walk(arm, f, t, True))
    make_action(arm, 'idle', 48, lambda f, t: anim_idle(arm, f, t))
    make_action(arm, 'sit', 2, lambda f, t: anim_sit(arm, f, t))
    root = empty('Human')
    arm.parent = root
    return root, arm, mesh, cap


def preview_poses(root, arm):
    # 4体並べて各アニメの代表フレームを撮る
    import copy
    sc = bpy.context.scene
    acts = {a.name: a for a in bpy.data.actions}
    outs = []
    for i, (an, fr) in enumerate((('idle', 10), ('walk', 6), ('run', 4), ('sit', 1))):
        arm.animation_data.action = acts[an]
        try:
            arm.animation_data.action_slot = acts[an].slots[0]
        except Exception:
            pass
        for tr in arm.animation_data.nla_tracks:
            tr.mute = True
        sc.frame_set(fr)
        out = os.path.join(PREV, f'human_{an}.png')
        preview(out, target=(0, 0, 0.9), dist=3.2, elev=8, azim=-60, lens=50, res=(480, 640), samples=48)
        outs.append(out)
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    arm.animation_data.action = None
    return outs


if __name__ == '__main__':
    root, arm, mesh, cap = build()
    export_glb(os.path.join(ASSETS, 'glb', 'human.glb'), [root], anim=True, uv=False)
    preview_poses(root, arm)
