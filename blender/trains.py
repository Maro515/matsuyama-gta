"""鉄道車両（坊っちゃん列車 機関車/客車・伊予鉄 路面電車/郊外電車・JR四国7000系風）。
+X が進行方向、原点はレール面の車体中心。灯火 HeadLight、客室窓 Window（夜に発光）。
実行: Blender -b --factory-startup -P trains.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from vehicles import split_paint


def M():
    return dict(
        black=mat('TBlack', '#141414', metal=0.3, rough=0.45),
        red=mat('TRed', '#9a1a14', rough=0.4),
        brass=mat('Brass', '#c9a24a', metal=1.0, rough=0.25),
        wood=mat('Wood', '#6a3e22', rough=0.55, coat=0.6),
        roofw=mat('RoofWhite', '#e9e6dc', rough=0.6),
        roofg=mat('RoofGrey', '#7d8186', rough=0.6),
        win=mat('Window', '#1d2a33', rough=0.08, emit='#ffe2b0', estr=0.0),
        head=mat('HeadLight', '#eef2f4', rough=0.1, emit='#fff6e0', estr=0.2),
        tail=mat('TailLight', '#7a0b0b', rough=0.2, emit='#ff2010', estr=0.2),
        steel=mat('TSteel', '#6d7276', metal=0.8, rough=0.45),
        orange=mat('IyoOrange', '#e8782a', rough=0.35, coat=0.5),
        cream=mat('IyoCream', '#f2ead6', rough=0.4, coat=0.4),
        stain=mat('Stainless', '#c8ced3', metal=0.9, rough=0.32),
        blue=mat('JRBlue', '#3b9ad8', rough=0.35),
    )


def bogie(x, gauge, m, r=0.43, n=2, pitch=1.9):
    o = []
    for k in range(n):
        xx = x + (k - (n - 1) / 2) * pitch
        for s in (1, -1):
            o.append(cyl('whl', r, 0.12, (xx, s * gauge / 2, r), m['black'], verts=18, axis='Y'))
    o.append(box('frame', (pitch * (n - 1) + 1.0, gauge + 0.3, 0.3), (x, 0, r + 0.1), m['steel']))
    return o


def side_windows(x0, x1, z0, z1, y, n, mwin, gap=0.18):
    o = []
    w = (x1 - x0 - gap * (n - 1)) / n
    for i in range(n):
        xc = x0 + w / 2 + i * (w + gap)
        for s in (1, -1):
            o.append(box('win', (w, 0.04, z1 - z0), (xc, s * y, (z0 + z1) / 2), mwin))
    return o


def botchan_loco():
    m = M()
    p = []
    p.append(box('deck', (6.2, 2.1, 0.25), (0, 0, 1.05), m['black']))
    p.append(box('buffer', (0.25, 2.3, 0.45), (3.1, 0, 0.95), m['red'], bevel=0.03))
    p.append(box('rbuffer', (0.25, 2.3, 0.45), (-3.1, 0, 0.95), m['red'], bevel=0.03))
    p.append(cyl('boiler', 0.72, 3.4, (0.9, 0, 2.0), m['black'], verts=24, axis='X'))
    p.append(cyl('smokebox', 0.76, 0.5, (2.55, 0, 2.0), m['black'], verts=24, axis='X'))
    p.append(cyl('door', 0.6, 0.06, (2.82, 0, 2.0), m['black'], verts=24, axis='X'))
    p.append(cyl('chimney', 0.2, 1.3, (2.3, 0, 3.15), m['black'], verts=16, r2=0.3))
    p.append(cyl('chimtop', 0.34, 0.16, (2.3, 0, 3.85), m['black'], verts=16))
    p.append(cyl('dome', 0.32, 0.5, (0.8, 0, 2.85), m['brass'], verts=16, r2=0.24))
    p.append(cyl('bell', 0.12, 0.3, (1.6, 0, 2.85), m['brass'], verts=12))
    for k in range(4):
        p.append(cyl('band', 0.735, 0.06, (-0.5 + k * 0.9, 0, 2.0), m['brass'], verts=24, axis='X'))
    # 運転室
    p.append(box('cab', (1.9, 2.1, 2.0), (-1.75, 0, 2.15), m['black'], bevel=0.04))
    p.append(box('cabroof', (2.3, 2.3, 0.12), (-1.75, 0, 3.2), m['black'], bevel=0.04))
    for s in (1, -1):
        p.append(box('cabwin', (0.7, 0.04, 0.6), (-1.6, s * 1.06, 2.55), m['win']))
    p.append(box('frontwin', (0.04, 0.5, 0.45), (-0.79, 0.55, 2.7), m['win']))
    p.append(box('frontwin', (0.04, 0.5, 0.45), (-0.79, -0.55, 2.7), m['win']))
    p.append(cyl('lamp', 0.16, 0.25, (2.85, 0, 2.95), m['head'], verts=14, axis='X'))
    # 動輪
    for xx in (1.4, -0.2):
        for s in (1, -1):
            p.append(cyl('drv', 0.6, 0.14, (xx, s * 0.98, 0.6), m['black'], verts=24, axis='Y'))
            p.append(cyl('hubr', 0.62, 0.06, (xx, s * 1.06, 0.6), m['red'], verts=24, axis='Y', r2=0.62))
    for s in (1, -1):
        p.append(box('rod', (1.7, 0.05, 0.08), (0.6, s * 1.12, 0.55), m['steel']))
        p.append(box('step', (0.5, 0.25, 0.06), (-2.6, s * 1.15, 0.9), m['black']))
    return join(p, 'botchan_loco', smooth_angle=40)


def botchan_coach():
    m = M()
    p = [box('frame', (7.4, 2.0, 0.25), (0, 0, 1.0), m['black'])]
    body = box('body', (6.2, 2.1, 1.75), (0, 0, 2.0), m['wood'], bevel=0.03)
    p.append(body)
    p.append(box('roof', (7.0, 2.3, 0.14), (0, 0, 2.95), m['roofw'], bevel=0.05))
    p.append(cyl('roofarc', 1.1, 6.6, (0, 0, 2.6), m['roofw'], verts=24, axis='X'))
    p += side_windows(-2.8, 2.8, 2.05, 2.65, 1.07, 7, m['win'], 0.12)
    for s in (1, -1):
        p.append(box('belt', (6.2, 0.03, 0.06), (0, s * 1.065, 1.85), m['brass']))
    # 両端のデッキと手すり
    for e in (1, -1):
        p.append(box('deck', (0.6, 2.0, 0.08), (e * 3.4, 0, 1.15), m['black']))
        for s in (1, -1):
            p.append(cyl('post', 0.03, 1.4, (e * 3.65, s * 0.9, 1.85), m['brass'], verts=8))
        p.append(cyl('rail', 0.025, 1.8, (e * 3.65, 0, 2.2), m['brass'], verts=8, axis='Y'))
    p += bogie(2.1, 1.067, m, 0.38, 1)
    p += bogie(-2.1, 1.067, m, 0.38, 1)
    return join(p, 'botchan_coach', smooth_angle=40)


def tram():
    """伊予鉄 市内電車（モハ50形風、全長12m）。下：みかん色、上：クリーム。"""
    m = M()
    L, W = 12.0, 2.3
    prof = [(-6.0, 0.45), (6.0, 0.45), (6.05, 0.9), (6.0, 2.7), (5.75, 3.15), (-5.75, 3.15), (-6.0, 2.7), (-6.05, 0.9)]
    from vehicles import body_from_profile
    body = body_from_profile('body', prof, W, 3.0, 3.15, 0.0, 0.9, m['orange'])
    split_paint(body, 1.55, m['cream'])
    p = [body]
    p += side_windows(-4.8, 4.5, 1.7, 2.6, W / 2 + 0.01, 8, m['win'])
    for e in (1, -1):
        p.append(box('fwin', (0.04, 1.5, 0.95), (e * 6.03, 0, 2.15), m['win']))
        p.append(box('dest', (0.04, 0.9, 0.22), (e * 6.03, 0, 2.85), mat('Dest', '#1a1206', rough=0.3, emit='#ff9a20', estr=1.5)))
        p.append(cyl('hl', 0.13, 0.06, (e * 6.06, 0, 1.25), m['head'] if e > 0 else m['tail'], verts=14, axis='X'))
    p.append(box('door', (0.9, 0.04, 2.0), (4.9, -(W / 2 + 0.01), 1.6), m['win']))
    p.append(box('door', (0.9, 0.04, 2.0), (-4.9, -(W / 2 + 0.01), 1.6), m['win']))
    p.append(box('roof', (11.6, 2.0, 0.12), (0, 0, 3.2), m['roofg'], bevel=0.05))
    # シングルアーム・パンタグラフ
    p.append(box('pbase', (1.2, 1.0, 0.12), (0, 0, 3.32), m['steel']))
    p.append(branch('parm', (0.4, 0, 3.38), (-0.35, 0, 4.1), 0.04, m['steel']))
    p.append(branch('parm2', (-0.35, 0, 4.1), (0.15, 0, 4.75), 0.035, m['steel']))
    p.append(box('pshoe', (0.12, 1.4, 0.05), (0.15, 0, 4.78), m['steel']))
    p += bogie(3.6, 1.067, m, 0.33, 2, 1.6)
    p += bogie(-3.6, 1.067, m, 0.33, 2, 1.6)
    return join(p, 'tram', smooth_angle=40)


def branch(name, a, b, r, m):
    d = Vector(b) - Vector(a)
    o = cyl(name, r, d.length, (0, 0, 0), m, verts=6)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.location = (Vector(a) + Vector(b)) / 2
    return o


def iyotetsu():
    """伊予鉄 郊外電車（全長18m、みかん色にクリームの帯）。"""
    m = M()
    L, W = 18.0, 2.75
    from vehicles import body_from_profile
    prof = [(-9.0, 1.0), (9.0, 1.0), (9.05, 1.3), (9.0, 3.4), (8.8, 3.85), (-8.8, 3.85), (-9.0, 3.4), (-9.05, 1.3)]
    body = body_from_profile('body', prof, W, 3.7, 3.85, 0.0, 0.5, m['orange'])
    split_paint(body, 3.25, m['roofg'])
    p = [body]
    for s in (1, -1):
        p.append(box('band', (18.0, 0.02, 0.22), (0, s * (W / 2 + 0.006), 1.75), m['cream']))
    p += side_windows(-7.6, 7.6, 2.05, 2.95, W / 2 + 0.012, 10, m['win'], 0.5)
    for x in (-5.2, 0, 5.2):
        for s in (1, -1):
            p.append(box('door', (1.3, 0.04, 2.0), (x, s * (W / 2 + 0.014), 2.15), m['stain']))
    for e in (1, -1):
        for y in (-0.75, 0, 0.75):
            p.append(box('fwin', (0.04, 0.6, 0.9), (e * 9.03, y, 2.55), m['win']))
        p.append(box('dest', (0.04, 1.0, 0.24), (e * 9.03, 0, 3.25), mat('Dest', '#1a1206', rough=0.3, emit='#ff9a20', estr=1.5)))
        for y in (-0.9, 0.9):
            p.append(cyl('hl', 0.12, 0.06, (e * 9.06, y, 1.55), m['head'] if e > 0 else m['tail'], verts=12, axis='X'))
    p.append(box('pbase', (1.4, 1.2, 0.12), (4.5, 0, 3.92), m['steel']))
    p.append(branch('parm', (4.9, 0, 3.98), (4.2, 0, 4.6), 0.04, m['steel']))
    p.append(branch('parm2', (4.2, 0, 4.6), (4.7, 0, 5.2), 0.035, m['steel']))
    p.append(box('pshoe', (0.12, 1.5, 0.05), (4.7, 0, 5.22), m['steel']))
    p.append(box('under', (13, 2.2, 0.5), (0, 0, 0.85), m['black']))
    p += bogie(6.3, 1.067, m, 0.43, 2, 2.1)
    p += bogie(-6.3, 1.067, m, 0.43, 2, 2.1)
    return join(p, 'iyotetsu', smooth_angle=40)


def jr():
    """JR四国7000系風（ステンレス＋水色帯、全長19.5m、丸みのある前頭部）。"""
    m = M()
    W = 2.85
    from vehicles import body_from_profile
    prof = [(-9.75, 1.0), (9.4, 1.0), (9.78, 1.4), (9.8, 2.2), (9.45, 3.4), (9.0, 3.9), (-9.6, 3.9), (-9.75, 3.5)]
    body = body_from_profile('body', prof, W, 3.6, 3.9, 0.05, 0.6, m['stain'])
    p = [body]
    for s in (1, -1):
        p.append(box('band', (19.0, 0.02, 0.18), (-0.1, s * (W / 2 + 0.006), 1.65), m['blue']))
        p.append(box('band2', (19.0, 0.02, 0.08), (-0.1, s * (W / 2 + 0.006), 3.15), m['blue']))
    p += side_windows(-8.4, 7.4, 2.05, 2.95, W / 2 + 0.012, 9, m['win'], 0.55)
    for x in (-4.5, 3.0):
        for s in (1, -1):
            p.append(box('door', (1.3, 0.04, 2.0), (x, s * (W / 2 + 0.014), 2.15), m['stain']))
    p.append(box('fwin', (0.04, 2.3, 1.0), (9.62, 0, 2.8), m['win'], rot=('Y', -0.45)))
    p.append(box('fblue', (0.05, 2.6, 0.35), (9.77, 0, 1.75), m['blue']))
    for y in (-0.95, 0.95):
        p.append(cyl('hl', 0.13, 0.06, (9.8, y, 2.05), m['head'], verts=12, axis='X'))
    p.append(box('pbase', (1.4, 1.2, 0.12), (-6.5, 0, 3.97), m['steel']))
    p.append(branch('parm', (-6.1, 0, 4.03), (-6.8, 0, 4.65), 0.04, m['steel']))
    p.append(branch('parm2', (-6.8, 0, 4.65), (-6.3, 0, 5.25), 0.035, m['steel']))
    p.append(box('pshoe', (0.12, 1.5, 0.05), (-6.3, 0, 5.27), m['steel']))
    p.append(box('under', (14, 2.2, 0.5), (0, 0, 0.85), m['black']))
    p += bogie(6.8, 1.067, m, 0.43, 2, 2.1)
    p += bogie(-6.8, 1.067, m, 0.43, 2, 2.1)
    return join(p, 'jr', smooth_angle=40)


if __name__ == '__main__':
    reset()
    roots = [botchan_loco(), botchan_coach(), tram(), iyotetsu(), jr()]
    export_glb(os.path.join(ASSETS, 'glb', 'trains.glb'), roots, uv=False)
    pos = [(-12, 6), (-4, 6), (8, 6), (-8, -2), (13, -6)]
    for o, (x, y) in zip(roots, pos):
        o.location = (x, y, 0)
    preview(os.path.join(PREV, 'trains.png'), target=(1, 0, 1.5), dist=40, elev=24, azim=-58, lens=45, res=(1400, 800), samples=56)
