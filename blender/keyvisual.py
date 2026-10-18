"""タイトル画面のキービジュアル（Cycles）。夕暮れの城山・松山城・主人公・スポーツカー。
出力: assets/tex/title.jpg
"""
import bpy, math, os, sys, random
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import landmarks as LM
import vehicles as VH
import nature_props as NP
import human as HU

reset()
LM.fonts()
sc = bpy.context.scene
R = random.Random(8)

# ---- 地面・道路 ----
asph = mat('KV_Asphalt', '#ffffff', rough=0.55, image=os.path.join(TEX, 'asphalt.jpg'))
side = mat('KV_Side', '#ffffff', rough=0.8, image=os.path.join(TEX, 'sidewalk.jpg'))
road = box('road', (400, 14, 0.1), (0, -4, -0.05), asph)
LM.uv_project(road, 3.6, 3.6, top=3.6)
walk = box('walk', (400, 5, 0.3), (0, 5.5, 0.0), side)
LM.uv_project(walk, 1.6, 1.6, top=1.6)
curb = box('curb', (400, 0.25, 0.32), (0, 2.9, 0.0), mat('KV_Curb', '#c9c6bd', rough=0.7))
lines = mat('KV_Line', '#f2f2ee', rough=0.5)
for x in range(-120, 120, 9):
    box('dash', (4.5, 0.15, 0.012), (x, -4, 0.005), lines)
box('edge', (400, 0.18, 0.012), (0, 1.9, 0.005), lines)
box('cw', (400, 0.18, 0.012), (0, -10, 0.005), lines)
gnd = box('gnd', (2000, 2000, 0.1), (0, 0, -0.12), mat('KV_Ground', '#7b8a5c', rough=0.95))

# ---- 城山と松山城 ----
hill_m = mat('KV_Hill', '#4f6e3a', rough=0.95)
hill = sphere('hill', 1.0, (0, 300, -40), hill_m, seg=96, rings=48, scale=(190, 130, 104))
castle = LM.castle()
castle.location = (6, 300, 63.0)
castle.scale = (1.7, 1.7, 1.7)
castle.rotation_euler = (0, 0, math.radians(8))
# 森
NP.leaf_texture('leaf_broad', 'broad', seed=5)
NP.leaf_texture('leaf_pine', 'pine', seed=6)
tb = NP.tree_broad('kv_broad', 9, 3.8, 8, 1)
tp = NP.tree_pine('kv_pine')
src = [tb, tp]
for i in range(420):
    a = R.uniform(0, math.tau)
    r = math.sqrt(R.random())
    x, y = math.cos(a) * 188 * r, 300 + math.sin(a) * 128 * r
    d = ((x / 190) ** 2 + ((y - 300) / 130) ** 2)
    if d > 0.97 or d < 0.16:
        continue
    z = -40 + 104 * math.sqrt(max(0, 1 - d))
    o = src[i % 2].copy()
    o.location = (x, y, z - 0.8)
    o.rotation_euler = (0, 0, R.uniform(0, math.tau))
    s = R.uniform(1.4, 2.1)
    o.scale = (s, s, s)
    sc.collection.objects.link(o)
tb.location = (60, 4000, 0)
tp.location = (70, 4000, 0)

# ---- 中景の街並み ----
for (x0, x1, y0, y1, fl, up, gr) in ((-70, -36, 18, 40, 7, 'office', 'gshop'), (-34, -12, 22, 36, 4, 'shop', 'gshop'),
                                       (22, 46, 18, 34, 6, 'glass', 'goffice'), (48, 80, 20, 44, 9, 'office', 'gshop'),
                                       (-110, -74, 30, 60, 5, 'mansion', 'goffice'), (84, 120, 30, 56, 4, 'mansion', 'goffice')):
    parts, top = LM.office_block('kvb', x0, y0, x1, y1, fl, upper=up, ground=gr)
# 街路樹・街灯・電柱
for x in (-40, -14, 14, 40):
    t = NP.tree_street('kv_st')
    t.location = (x, 6.5, 0.15)
for x in (-28, 26):
    l = NP.street_lamp()
    l.location = (x, 3.6, 0.15)
    l.rotation_euler = (0, 0, -math.pi / 2)
pole = NP.utility_pole()
pole.location = (-9, 7.5, 0.15)
lamp_on = bpy.data.materials.get('LampLight')
if lamp_on:
    lamp_on.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 6.0

# ---- 主役：スポーツカーと主人公 ----
car = VH.sports('kv_car')
kvp = mat('KV_Paint', '#ffc800', metal=0.35, rough=0.22, coat=1.0, coat_rough=0.03)
for ch in car.children:
    if ch.type == 'MESH':
        for i, m in enumerate(ch.data.materials):
            if m and m.name.startswith('Paint'):
                ch.data.materials[i] = kvp
                print('PAINTSLOT', ch.name, i)
car.location = (3.2, -6.8, 0)
car.rotation_euler = (0, 0, math.radians(212))
hroot, arm, hmesh, cap = HU.build(do_reset=False)
hroot.location = (-1.9, -6.2, 0)
hroot.rotation_euler = (0, 0, math.radians(-62))
bpy.data.materials['Shirt'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hex2lin('#2e6e46'), 1)
acts = {a.name: a for a in bpy.data.actions}
arm.animation_data.action = acts['idle']
try:
    arm.animation_data.action_slot = acts['idle'].slots[0]
except Exception:
    pass
for tr in arm.animation_data.nla_tracks:
    tr.mute = True
sc.frame_set(12)

# ---- 遠景の山並み ----
mtn = mat('KV_Mtn', '#5f7890', rough=1.0)
for i in range(9):
    c = cyl('mtn', R.uniform(160, 260), R.uniform(70, 130), (-900 + i * 230, 1300 + R.uniform(-100, 200), 20), mtn, verts=7, r2=8)

# ---- 空・太陽 ----
w = bpy.data.worlds.new('KVW')
sc.world = w
try:
    w.use_nodes = True
except Exception:
    pass
nt = w.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
sky = nt.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'MULTIPLE_SCATTERING'
sky.sun_elevation = math.radians(5)
sky.sun_rotation = math.radians(205)
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Strength'].default_value = 0.24
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs[0], out.inputs[0])

sd = bpy.data.lights.new('Sun', 'SUN')
sd.energy = 2.0
sd.color = (1.0, 0.86, 0.66)
sd.angle = math.radians(1.2)
sun = bpy.data.objects.new('Sun', sd)
sun.rotation_euler = (math.radians(83), 0, math.radians(205 - 180 + 90))
sc.collection.objects.link(sun)

# ---- カメラ ----
cd = bpy.data.cameras.new('Cam')
cd.lens = 28
cd.dof.use_dof = True
cd.dof.aperture_fstop = 4.0
cam = bpy.data.objects.new('Cam', cd)
sc.collection.objects.link(cam)
cam.location = (0.6, -15.5, 1.15)
tgt = Vector((0.4, 40, 13.0))
cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
cd.dof.focus_distance = 9.5
sc.camera = cam

sc.render.engine = 'CYCLES'
sc.cycles.samples = 192
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
    print('GPU', e)
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy'
sc.view_settings.exposure = 0.3
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 84
sc.render.filepath = os.path.join(TEX, 'title.jpg')
bpy.ops.render.render(write_still=True)
print('KEYVISUAL', sc.render.filepath, os.path.getsize(sc.render.filepath) // 1024, 'KB')
