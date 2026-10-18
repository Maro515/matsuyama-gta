"""Blender headless asset helpers for GRAND THEFT MIKAN.

単位はメートル。Blender +X = 東（ゲームx+）, +Y = 北（ゲームy-）, +Z = 上。
glTF書き出しでY-upに変換されるため、three.js側では x=ゲームx, z=ゲームy となる。
乗り物・人物は +X 向き（前方）でモデリングする。
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
TEX = os.path.join(ASSETS, 'tex')
PREV = os.path.join(ASSETS, 'preview')
for d in (ASSETS, TEX, PREV):
    os.makedirs(d, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


# ---------- 色・マテリアル ----------
def hex2lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def mat(name, col='#cccccc', metal=0.0, rough=0.5, emit=None, estr=0.0, coat=0.0, alpha=1.0,
        coat_rough=0.05, spec=0.5, image=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*hex2lin(col), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    if emit:
        b.inputs['Emission Color'].default_value = (*hex2lin(emit), 1)
        b.inputs['Emission Strength'].default_value = estr
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if image:
        img = bpy.data.images.load(image, check_existing=True)
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    m.diffuse_color = (*hex2lin(col), 1)
    return m


# ---------- メッシュ生成 ----------
def _new_obj(name, me):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def mesh_from_bm(name, bm, mats=()):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return _new_obj(name, me)


def box(name, size, loc=(0, 0, 0), m=None, bevel=0.0, seg=2, rot=None):
    """size=(sx,sy,sz)。locは箱の中心。"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    o = mesh_from_bm(name, bm, [m] if m else [])
    if bevel > 0:
        md = o.modifiers.new('bev', 'BEVEL')
        md.width = bevel
        md.segments = seg
        md.limit_method = 'ANGLE'
    return o


def cyl(name, r, depth, loc=(0, 0, 0), m=None, verts=16, axis='Z', r2=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return mesh_from_bm(name, bm, [m] if m else [])


def sphere(name, r, loc=(0, 0, 0), m=None, seg=16, rings=10, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    o = mesh_from_bm(name, bm, [m] if m else [])
    o.data.shade_smooth()
    return o


def ico(name, r, loc=(0, 0, 0), m=None, sub=2, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    o = mesh_from_bm(name, bm, [m] if m else [])
    o.data.shade_smooth()
    return o


def prism(name, pts, y0, y1, m=None, axis='Y'):
    """XZ平面の多角形（反時計回り）を Y 方向 [y0,y1] に押し出す。axis='X'なら YZ平面を X方向へ。"""
    bm = bmesh.new()
    n = len(pts)
    if axis == 'Y':
        a = [bm.verts.new((p[0], y0, p[1])) for p in pts]
        b = [bm.verts.new((p[0], y1, p[1])) for p in pts]
    elif axis == 'X':
        a = [bm.verts.new((y0, p[0], p[1])) for p in pts]
        b = [bm.verts.new((y1, p[0], p[1])) for p in pts]
    else:  # 'Z': XY平面を Z方向へ
        a = [bm.verts.new((p[0], p[1], y0)) for p in pts]
        b = [bm.verts.new((p[0], p[1], y1)) for p in pts]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, [m] if m else [])


def loft_rect(name, sections, m=None, cap=True):
    """sections: [(x, w_half, z0, z1), ...] X方向に並ぶ矩形断面をロフト。"""
    bm = bmesh.new()
    rings = []
    for (x, hw, z0, z1) in sections:
        rings.append([bm.verts.new((x, -hw, z0)), bm.verts.new((x, hw, z0)),
                      bm.verts.new((x, hw, z1)), bm.verts.new((x, -hw, z1))])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            l = (k + 1) % 4
            bm.faces.new((a[k], a[l], b[l], b[k]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, [m] if m else [])


def add_mod(o, kind, **kw):
    md = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(md, k, v)
    return md


def bake(o):
    """モディファイアを適用した新メッシュに置き換える。"""
    if not o.modifiers:
        return o
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear()
    old = o.data
    o.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return o


def apply_xform(o):
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)


def join(objs, name, smooth_angle=None):
    bpy.context.view_layer.update()   # 直前に設定した回転・位置を matrix_world に反映
    objs = [bake(o) for o in objs if o]
    bpy.context.view_layer.update()
    for o in objs:
        apply_xform(o)
        # UVマップ名をそろえないと結合時に汎用属性へ化ける
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
        else:
            o.data.uv_layers[0].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    if smooth_angle is not None:
        o.data.shade_smooth()
        o.data.set_sharp_from_angle(angle=math.radians(smooth_angle))
    else:
        o.data.shade_flat()
    return o


def parent(child, par, keep=True):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = par
    if keep:
        child.matrix_world = mw


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


def set_origin(o, pt):
    """メッシュ原点を pt（ワールド座標）へ移す。"""
    d = Vector(pt) - o.location
    o.data.transform(Matrix.Translation(-d))
    o.location = Vector(pt)


def decimate(o, ratio):
    add_mod(o, 'DECIMATE', ratio=ratio)
    bake(o)


# ---------- 書き出し ----------
def export_glb(path, objs=None, anim=False, anim_mode='NLA_TRACKS', uv=True, images='AUTO'):
    bpy.ops.object.select_all(action='DESELECT')
    if objs is not None:
        def sel(o):
            o.select_set(True)
            for c in o.children:
                sel(c)
        for o in objs:
            sel(o)
    kw = dict(filepath=path, export_format='GLB', use_selection=objs is not None,
              export_apply=True, export_yup=True, export_texcoords=uv, export_normals=True,
              export_materials='EXPORT', export_cameras=False, export_lights=False,
              export_animations=anim, export_extras=True, export_image_format=images)
    kw.update(export_meshopt_compression_enable=True)   # EXT_meshopt_compression（three側でデコード）
    if anim:
        kw.update(export_animation_mode=anim_mode, export_skins=True, export_def_bones=True,
                  export_leaf_bone=False, export_optimize_animation_size=True)
    bpy.ops.export_scene.gltf(**kw)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# ---------- プレビュー撮影 ----------
def preview(path, target=(0, 0, 0), dist=8.0, elev=22, azim=-35, lens=50, res=(960, 640),
            engine='CYCLES', samples=48, sun_elev=40, sun_azim=-60, ground=True, ortho=None,
            world='#a9c1d8', strength=1.0, film_transparent=False, exposure=0.0):
    sc = bpy.context.scene
    try:
        sc.render.engine = engine
    except Exception:
        sc.render.engine = 'BLENDER_EEVEE'
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.transparent_max_bounces = 64
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            sc.cycles.device = 'GPU'
        except Exception as e:
            print('GPU setup failed', e)
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = film_transparent
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = exposure
    # world
    w = bpy.data.worlds.new('W')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*hex2lin(world), 1)
    bg.inputs['Strength'].default_value = strength
    # sun
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = 3.2
    ld.angle = math.radians(2.5)
    ls = bpy.data.objects.new('Sun', ld)
    ls.rotation_euler = (math.radians(90 - sun_elev), 0, math.radians(sun_azim))
    sc.collection.objects.link(ls)
    if ground:
        gm = mat('_ground', '#8d8f88', rough=0.9)
        g = box('_ground', (400, 400, 0.02), (target[0], target[1], -0.01), gm)
    # camera
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    cam = bpy.data.objects.new('Cam', cd)
    sc.collection.objects.link(cam)
    t = Vector(target)
    e, a = math.radians(elev), math.radians(azim)
    cam.location = t + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    d = (t - cam.location)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', path)
    # 後片付け（書き出し対象に混ざらないように）
    for o in [ls, cam] + ([g] if ground else []):
        bpy.data.objects.remove(o, do_unlink=True)


def argv_after():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
