"""地面テクスチャ（numpyタイル生成）と外壁テクスチャ（Cycles正射影レンダ）を作る。
実行: Blender -b --factory-startup -P textures.py -- [ground|facade|all]
"""
import bpy, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

RNG = np.random.default_rng(515)


# ======================================================================
# タイル化ノイズ
# ======================================================================
def _interp_wrap(g, n):
    f = g.shape[0]
    x = np.arange(n) * f / n
    i0 = np.floor(x).astype(int) % f
    i1 = (i0 + 1) % f
    t = x - np.floor(x)
    t = t * t * (3 - 2 * t)
    a = g[i0][:, i0] * (1 - t)[None, :] + g[i0][:, i1] * t[None, :]
    b = g[i1][:, i0] * (1 - t)[None, :] + g[i1][:, i1] * t[None, :]
    return a * (1 - t)[:, None] + b * t[:, None]


def fbm(n, base=4, oct=5, gain=0.5, seed=None):
    rng = np.random.default_rng(seed) if seed is not None else RNG
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(oct):
        f = base * 2 ** o
        if f > n:
            break
        out += amp * _interp_wrap(rng.random((f, f)), n)
        tot += amp
        amp *= gain
    return out / tot


def grain(n, s=1.0):
    return RNG.standard_normal((n, n)) * s


def blur_wrap(a, r=1):
    out = a.copy()
    cnt = 1
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            out += np.roll(np.roll(a, dy, 0), dx, 1)
            cnt += 1
    return out / cnt


def save_rgb(name, rgb, fmt='JPEG', quality=88):
    """rgb: (n,m,3) sRGB 0..1 。画像の上端が v=1 側になるよう反転して保存。"""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb[::-1], 0, 1)
    img.pixels.foreach_set(px.ravel())
    ext = 'jpg' if fmt == 'JPEG' else 'png'
    path = os.path.join(TEX, f'{name}.{ext}')
    img.filepath_raw = path
    img.file_format = fmt
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()
    print('TEX', path, os.path.getsize(path) // 1024, 'KB')
    bpy.data.images.remove(img)


def col(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def tint(lum, c0, c1=None):
    c0 = col(c0)
    c1 = col(c1) if c1 else c0
    l = lum[..., None]
    return c0 * (1 - l) * 0 + (c0 * l if c1 is None else (c0 * (1 - l) + c1 * l))


# ======================================================================
# 地面系テクスチャ
# ======================================================================
def asphalt(n=512):
    base = 0.30 + 0.06 * (fbm(n, 4, 5) - 0.5) + 0.05 * (fbm(n, 32, 3) - 0.5)
    g = grain(n, 0.035)
    agg = (RNG.random((n, n)) > 0.985) * RNG.uniform(0.08, 0.22, (n, n))   # 骨材の白い粒
    dark = (RNG.random((n, n)) > 0.990) * -0.08
    v = base + g + agg + dark
    # ひび割れ（ランダムウォーク）
    for _ in range(5):
        y, x = RNG.integers(0, n, 2)
        a = RNG.uniform(0, 2 * math.pi)
        for _s in range(RNG.integers(60, 200)):
            a += RNG.normal(0, 0.35)
            y = int(y + math.sin(a) * 1.5) % n
            x = int(x + math.cos(a) * 1.5) % n
            v[y, x] -= 0.09
            v[(y + 1) % n, x] -= 0.04
    # 油染み
    stain = fbm(n, 2, 3)
    v -= np.clip(stain - 0.62, 0, 1) * 0.35
    v = blur_wrap(v, 1) * 0.35 + v * 0.65
    rgb = np.stack([v * 0.98, v * 1.0, v * 1.04], -1)
    save_rgb('asphalt', rgb)


def sidewalk(n=512):
    """インターロッキングブロック（半目地）。1タイル=1.6m四方を想定。"""
    bw, bh = 64, 32  # px
    rgb = np.zeros((n, n, 3))
    yy, xx = np.mgrid[0:n, 0:n]
    row = yy // bh
    off = (row % 2) * (bw // 2)
    bx = ((xx + off) // bw) % (n // bw)
    by = row
    bid = (by * 31 + bx * 17) % 997
    pal = np.array([col('#a9a49b'), col('#b8b2a7'), col('#9c978f'), col('#b3a596'), col('#a7a29a')])
    rng2 = np.random.default_rng(7)
    choice = rng2.integers(0, len(pal), 997)
    shade = rng2.uniform(0.92, 1.06, 997)
    rgb[:] = pal[choice[bid]] * shade[bid][..., None]
    lx = (xx + off) % bw
    ly = yy % bh
    # ベベル陰影
    edge = np.minimum.reduce([lx, bw - 1 - lx, ly, bh - 1 - ly])
    bev = np.clip(edge / 3.0, 0, 1)
    hl = ((lx < 3) | (ly < 3)) & (edge < 3)
    rgb *= (0.78 + 0.22 * bev)[..., None]
    rgb[hl] *= 1.08
    grout = (lx < 1) | (ly < 1)
    rgb[grout] = col('#5e5a54')
    v = 1 + grain(n, 0.03) + 0.06 * (fbm(n, 8, 4) - 0.5)
    rgb *= v[..., None]
    save_rgb('sidewalk', rgb)


def tactile(n=256):
    """点字ブロック（黄色）。"""
    rgb = np.zeros((n, n, 3)) + col('#e0b22c')
    yy, xx = np.mgrid[0:n, 0:n]
    cx = (xx % 32) - 16
    cy = (yy % 32) - 16
    d = np.sqrt(cx ** 2 + cy ** 2)
    dot = d < 7
    rgb[dot] *= 1.12
    rgb[(d >= 7) & (d < 9)] *= 0.8
    rgb *= (1 + grain(n, 0.03))[..., None]
    g = (xx % 128 < 1) | (yy % 128 < 1)
    rgb[g] *= 0.6
    save_rgb('tactile', rgb)


def grass(n=512):
    l = 0.5 + 0.35 * (fbm(n, 4, 6) - 0.5) + 0.25 * (fbm(n, 64, 2) - 0.5)
    blades = blur_wrap(RNG.random((n, n)), 1)
    l = l + (blades - 0.5) * 0.35
    c0, c1, c2 = col('#4f6b33'), col('#7a9a4a'), col('#9aa45a')
    l = np.clip(l, 0, 1)[..., None]
    dry = np.clip(fbm(n, 2, 3) - 0.55, 0, 1)[..., None] * 1.8
    rgb = c0 * (1 - l) + c1 * l
    rgb = rgb * (1 - dry) + c2 * dry
    save_rgb('grass', rgb)


def soil(n=512):
    """畑（畝）。v方向に畝が走る。"""
    yy, xx = np.mgrid[0:n, 0:n]
    furrow = 0.5 + 0.5 * np.cos(xx / n * 2 * math.pi * 16)
    l = 0.45 + 0.25 * furrow + 0.2 * (fbm(n, 8, 5) - 0.5) + grain(n, 0.05)
    clods = (RNG.random((n, n)) > 0.97) * 0.15
    l = np.clip(l + clods, 0, 1)[..., None]
    rgb = col('#5a4232') * (1 - l) + col('#9a7a58') * l
    # 畝の頂に作物
    crop = (furrow > 0.75) & (fbm(n, 32, 3) > 0.45)
    rgb[crop] = rgb[crop] * 0.35 + col('#6c8f3e') * 0.65
    save_rgb('soil', rgb)


def paddy(n=512):
    yy, xx = np.mgrid[0:n, 0:n]
    rows = 0.5 + 0.5 * np.cos(xx / n * 2 * math.pi * 24)
    l = 0.5 + 0.3 * rows + 0.2 * (fbm(n, 16, 4) - 0.5) + grain(n, 0.04)
    l = np.clip(l, 0, 1)[..., None]
    rgb = col('#4d6e3a') * (1 - l) + col('#93b45c') * l
    water = rows < 0.15
    rgb[water] = rgb[water] * 0.5 + col('#5b6f6a') * 0.5
    save_rgb('paddy', rgb)


def sand(n=256):
    l = 0.6 + 0.2 * (fbm(n, 8, 5) - 0.5) + grain(n, 0.06)
    l = np.clip(l, 0, 1)[..., None]
    rgb = col('#b8a27a') * (1 - l) + col('#e6d6ae') * l
    save_rgb('sand', rgb)


def concrete(n=512):
    l = 0.66 + 0.12 * (fbm(n, 4, 6) - 0.5) + grain(n, 0.025)
    l -= np.clip(fbm(n, 2, 4) - 0.6, 0, 1) * 0.3
    yy, xx = np.mgrid[0:n, 0:n]
    joint = (xx % 256 < 2) | (yy % 256 < 2)
    l[joint] -= 0.12
    rgb = np.stack([l, l * 0.99, l * 0.97], -1)
    save_rgb('concrete', rgb)


def gravel(n=256):
    rgb = np.zeros((n, n, 3)) + col('#6f6a62')
    for _ in range(2400):
        y, x = RNG.integers(0, n, 2)
        r = RNG.integers(2, 5)
        c = col('#8f8a80') * RNG.uniform(0.7, 1.3)
        ys = (np.arange(y - r, y + r + 1)) % n
        xs = (np.arange(x - r, x + r + 1)) % n
        rgb[np.ix_(ys, xs)] = rgb[np.ix_(ys, xs)] * 0.3 + c * 0.7
    rgb *= (1 + grain(n, 0.05))[..., None]
    save_rgb('gravel', rgb)


def kawara(n=256):
    """いぶし瓦（桟瓦）。u方向に波、v方向に段。1タイル=瓦4列×4段。"""
    yy, xx = np.mgrid[0:n, 0:n]
    u = (xx / n * 4) % 1.0
    v = (yy / n * 4) % 1.0
    wave = 0.5 + 0.5 * np.sin(u * 2 * math.pi)
    lap = np.clip(v / 0.85, 0, 1) ** 0.5
    l = 0.26 + 0.30 * wave * (0.55 + 0.45 * lap) + 0.04 * (fbm(n, 8, 3) - 0.5) + grain(n, 0.018)
    l = np.where(v > 0.9, l * 0.5, l)
    rgb = np.stack([l * 0.93, l * 0.97, l * 1.05], -1)
    save_rgb('kawara', rgb)


def stonewall(n=512):
    """石垣（打込接ぎ）。段積みの切石を少しずつ不揃いに。"""
    rgb = np.zeros((n, n, 3))
    yy, xx = np.mgrid[0:n, 0:n]
    rng2 = np.random.default_rng(11)
    y = 0
    rows = []
    while y < n:
        h = int(rng2.integers(34, 58))
        if n - y - h < 30:
            h = n - y
        rows.append((y, h))
        y += h
    for (y0, h) in rows:
        x = int(rng2.integers(0, 60))
        widths = []
        while True:
            w = int(rng2.integers(50, 110))
            widths.append(w)
            if sum(widths) >= n:
                break
        widths[-1] -= sum(widths) - n
        x0 = x
        for w in widths:
            tone = rng2.uniform(0.78, 1.15)
            hue = rng2.uniform(-0.04, 0.04)
            c = np.array([0.56 + hue, 0.54, 0.50 - hue]) * tone
            xs = (np.arange(x0, x0 + w)) % n
            ys = np.arange(y0, min(n, y0 + h))
            ly = (ys - y0)[:, None]
            lx = (np.arange(w))[None, :]
            # 面の丸み（中央が明るく、縁が暗い）
            ex = np.minimum(lx, w - 1 - lx) / 10.0
            ey = np.minimum(ly, len(ys) - 1 - ly) / 8.0
            bev = np.clip(np.minimum(ex, ey), 0, 1) ** 0.6
            light = 0.62 + 0.38 * bev - 0.08 * (ly / max(1, len(ys)))
            block = c[None, None, :] * light[..., None]
            rgb[np.ix_(ys, xs)] = block
            x0 += w
    gap = 0.18
    rgb = rgb * (1 + 0.10 * (fbm(n, 16, 4) - 0.5) + grain(n, 0.035))[..., None]
    dark = rgb.sum(-1) < 0.05
    rgb[dark] = gap
    save_rgb('stonewall', rgb)


def plaster(n=256):
    l = 0.92 + 0.04 * (fbm(n, 4, 5) - 0.5) + grain(n, 0.01)
    rgb = np.stack([l, l * 0.99, l * 0.96], -1)
    save_rgb('plaster', rgb)


def water_normal(n=512):
    h = fbm(n, 4, 6, 0.55) + 0.6 * fbm(n, 16, 4, 0.5)
    gy, gx = np.gradient(np.pad(h, 1, mode='wrap'))
    gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
    s = 6.0
    nx, ny, nz = -gx * s, -gy * s, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / L * 0.5 + 0.5, ny / L * 0.5 + 0.5, nz / L * 0.5 + 0.5], -1)
    save_rgb('water_n', rgb, 'JPEG', 92)


def detail(n=256):
    l = 0.5 + 0.5 * (fbm(n, 8, 5) - 0.5) + grain(n, 0.08)
    save_rgb('detail', np.stack([l, l, l], -1))


def clouds(n=512):
    c = fbm(n, 3, 7, 0.55)
    c = np.clip((c - 0.42) * 2.6, 0, 1)
    rgb = np.stack([c, c, c], -1)
    save_rgb('clouds', rgb)


def ground_all():
    asphalt(); sidewalk(); tactile(); grass(); soil(); paddy(); sand(); concrete()
    gravel(); kawara(); stonewall(); plaster(); water_normal(); detail(); clouds()


# ======================================================================
# 外壁モジュール（Blenderで立体モデリング→Cycles正射影レンダ）
# 各モジュールは X:[0,W] Z:[0,H] の範囲、外壁面は y=0、カメラは -Y 側。
# ======================================================================
def M(name, c, **kw):
    return mat('F_' + name, c, **kw)


def win_unit(x0, x1, z0, z1, depth=0.14, frame='#b9bcbf', glass='#30404e', split=2, tag='WIN', interior='#6a5e50',
             curtain=None):
    """窓（凹み＋サッシ＋ガラス＋室内）。tagは夜間マスク識別子。"""
    objs = []
    fm = M('frame' + frame, frame, metal=0.6, rough=0.35)
    gm = M('glass' + glass, glass, rough=0.04, spec=0.8)
    w, h = x1 - x0, z1 - z0
    # 室内（暗い壁）＋ガラス
    objs.append(box(tag + '_room', (w, 0.02, h), ((x0 + x1) / 2, depth + 0.9, (z0 + z1) / 2), M('room' + interior, interior, rough=0.9)))
    if curtain:
        cm = M('curtain' + curtain, curtain, rough=0.95)
        objs.append(box('curt', (w * 0.42, 0.02, h * 0.96), (x0 + w * 0.21, depth + 0.4, (z0 + z1) / 2), cm))
        objs.append(box('curt', (w * 0.3, 0.02, h * 0.96), (x1 - w * 0.15, depth + 0.4, (z0 + z1) / 2), cm))
    g = box(tag + '_glass', (w, 0.01, h), ((x0 + x1) / 2, depth, (z0 + z1) / 2), gm)
    objs.append(g)
    # 窓枠
    t = 0.05
    objs += [box('fr', (w + t * 2, 0.06, t), ((x0 + x1) / 2, depth - 0.02, z0 - t / 2), fm),
             box('fr', (w + t * 2, 0.06, t), ((x0 + x1) / 2, depth - 0.02, z1 + t / 2), fm),
             box('fr', (t, 0.06, h), (x0 - t / 2, depth - 0.02, (z0 + z1) / 2), fm),
             box('fr', (t, 0.06, h), (x1 + t / 2, depth - 0.02, (z0 + z1) / 2), fm)]
    for k in range(1, split):
        xm = x0 + w * k / split
        objs.append(box('mull', (0.04, 0.07, h), (xm, depth - 0.02, (z0 + z1) / 2), fm))
    # 窓の凹み側面（外壁の厚み）
    return objs


def wall_with_holes(W, H, holes, m, thick=0.14):
    """外壁パネル（穴あき）。holes=[(x0,x1,z0,z1)] 。板をグリッド分割して穴部分を抜く。"""
    xs = sorted({0, W} | {h[0] for h in holes} | {h[1] for h in holes})
    zs = sorted({0, H} | {h[2] for h in holes} | {h[3] for h in holes})
    objs = []
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(h[0] <= cx <= h[1] and h[2] <= cz <= h[3] for h in holes):
                continue
            objs.append(box('wall', (xs[i + 1] - xs[i], thick, zs[j + 1] - zs[j]), (cx, thick / 2, cz), m))
    # 穴の側面（見込み）
    jm = m
    for (x0, x1, z0, z1) in holes:
        objs += [box('jamb', (x1 - x0, thick, 0.01), ((x0 + x1) / 2, thick / 2, z0), jm),
                 box('jamb', (x1 - x0, thick, 0.01), ((x0 + x1) / 2, thick / 2, z1), jm),
                 box('jamb', (0.01, thick, z1 - z0), (x0, thick / 2, (z0 + z1) / 2), jm),
                 box('jamb', (0.01, thick, z1 - z0), (x1, thick / 2, (z0 + z1) / 2), jm)]
    return objs


def facade_office(W=3.6, H=2.8):
    wm = M('office_wall', '#c9c6bd', rough=0.7)
    holes = [(0.25, W / 2 - 0.12, 0.85, 2.45), (W / 2 + 0.12, W - 0.25, 0.85, 2.45)]
    o = wall_with_holes(W, H, holes, wm)
    o += win_unit(*holes[0], tag='WINA', glass='#2b3a48', interior='#5c5650')
    o += win_unit(*holes[1], tag='WINB', glass='#2b3a48', interior='#5c5650')
    # スパンドレルの水平ライン
    o.append(box('band', (W, 0.04, 0.08), (W / 2, -0.02, 0.06), M('office_band', '#a9a69e', rough=0.6)))
    return o


def facade_glass(W=3.6, H=2.8):
    """カーテンウォール（全面ガラス）。"""
    o = []
    fm = M('cw_frame', '#9aa3ab', metal=0.7, rough=0.3)
    o.append(box('spandrel', (W, 0.1, 0.7), (W / 2, 0.05, 0.35), M('cw_span', '#41505c', metal=0.3, rough=0.25)))
    o += win_unit(0.02, W / 2 - 0.02, 0.72, H - 0.02, depth=0.02, frame='#9aa3ab', glass='#3a5a74', tag='WINA', interior='#50565c')
    o += win_unit(W / 2 + 0.02, W - 0.02, 0.72, H - 0.02, depth=0.02, frame='#9aa3ab', glass='#3a5a74', tag='WINB', interior='#50565c')
    o.append(box('mul', (0.08, 0.12, H), (0.0, -0.03, H / 2), fm))
    o.append(box('mul', (0.08, 0.12, H), (W, -0.03, H / 2), fm))
    o.append(box('mul', (0.06, 0.1, H), (W / 2, -0.03, H / 2), fm))
    return o


def facade_mansion(W=3.6, H=2.8):
    wm = M('mansion_wall', '#e6e0d4', rough=0.75)
    holes = [(0.3, W - 0.3, 0.12, 2.2)]
    o = wall_with_holes(W, H, holes, wm)
    o += win_unit(*holes[0], depth=0.14, tag='WINA', glass='#3a4652', interior='#6a5c4c', curtain='#e9e2cf', split=2)
    # バルコニー床スラブ＋手摺壁
    slab_m = M('mansion_slab', '#d8d2c6', rough=0.8)
    o.append(box('slab', (W, 1.05, 0.16), (W / 2, -0.52, 0.0), slab_m))
    rail = M('mansion_rail', '#b8bec4', metal=0.2, rough=0.4, alpha=1.0)
    o.append(box('railwall', (W, 0.06, 0.95), (W / 2, -1.02, 0.55), M('mansion_rail_panel', '#cfd3d6', rough=0.5)))
    o.append(box('railtop', (W, 0.1, 0.06), (W / 2, -1.02, 1.05), rail))
    # 隔て板の柱
    o.append(box('div', (0.08, 1.05, 2.8), (0.04, -0.52, 1.4), wm))
    o.append(box('div', (0.08, 1.05, 2.8), (W - 0.04, -0.52, 1.4), wm))
    # エアコン室外機
    o.append(box('ac', (0.78, 0.28, 0.55), (W - 0.65, -0.3, 0.45), M('ac', '#e8e8e6', rough=0.5)))
    o.append(cyl('acfan', 0.2, 0.02, (W - 0.7, -0.45, 0.45), M('acfan', '#4a4c50'), axis='Y'))
    # 洗濯物ポール
    o.append(cyl('pole', 0.015, W - 0.4, (W / 2, -0.85, 1.9), rail, axis='X', verts=6))
    return o


def facade_shop(W=3.0, H=2.8):
    """雑居ビルの上階（タイル壁）。"""
    wm = M('shop_wall', '#cbb69a', rough=0.65)
    holes = [(0.35, W - 0.35, 0.8, 2.3)]
    o = wall_with_holes(W, H, holes, wm)
    o += win_unit(*holes[0], tag='WINA', glass='#34424e', interior='#6c6458', split=3)
    # タイル目地（細い横溝）
    jm = M('shop_joint', '#a8957c', rough=0.8)
    for z in np.arange(0.2, H, 0.28):
        if 0.8 < z < 2.3:
            continue
        o.append(box('tj', (W, 0.01, 0.02), (W / 2, -0.004, z), jm))
    o.append(box('sill', (W - 0.5, 0.12, 0.06), (W / 2, -0.05, 0.77), M('sill', '#d9d6d0')))
    return o


def facade_house(W=3.6, H=2.8):
    """木造住宅（窯業系サイディング）。"""
    wm = M('house_wall', '#ece6da', rough=0.85)
    holes = [(0.7, 2.6, 0.9, 2.15)]
    o = wall_with_holes(W, H, holes, wm, thick=0.1)
    o += win_unit(*holes[0], depth=0.1, frame='#5b5b5b', tag='WINA', glass='#3e4a54', interior='#7a6a54', curtain='#efe6d0')
    # 横張りサイディングの段
    sm = M('house_siding', '#ddd6c8', rough=0.85)
    for z in np.arange(0.18, H, 0.2):
        if 0.85 < z < 2.2 and 0.65 < 1.0:
            for (a, b) in ((0, 0.7), (2.6, W)):
                o.append(box('sd', (b - a, 0.012, 0.015), ((a + b) / 2, -0.004, z), sm))
        else:
            o.append(box('sd', (W, 0.012, 0.015), (W / 2, -0.004, z), sm))
    # シャッターボックス＋面格子
    o.append(box('shbox', (2.0, 0.22, 0.22), (1.65, -0.11, 2.3), M('shutter', '#7c7c78', metal=0.3, rough=0.5)))
    gm = M('grille', '#8a8e92', metal=0.6, rough=0.4)
    for x in np.arange(0.85, 2.6, 0.22):
        o.append(box('gr', (0.025, 0.03, 1.2), (x, -0.08, 1.52), gm))
    o.append(box('hood', (2.1, 0.3, 0.05), (1.65, -0.14, 2.42), M('hood', '#6a6c6e')))
    return o


def facade_hotel(W=3.6, H=2.8):
    """道後の旅館（障子の和室）。"""
    wm = M('hotel_wall', '#d9cdb5', rough=0.8)
    holes = [(0.25, W - 0.25, 0.45, 2.3)]
    o = wall_with_holes(W, H, holes, wm)
    o += win_unit(*holes[0], depth=0.16, frame='#4a3a2c', glass='#5a5a50', tag='WINA', interior='#d8c9a2', split=4)
    sh = M('shoji', '#f1e9d2', rough=0.95)
    o.append(box('shoji', (W - 0.5, 0.02, 1.8), (W / 2, 0.5, 1.37), sh))
    lat = M('shoji_lat', '#7a6448', rough=0.8)
    for x in np.arange(0.25 + 0.3, W - 0.25, 0.3):
        o.append(box('sl', (0.02, 0.02, 1.8), (x, 0.48, 1.37), lat))
    for z in np.arange(0.6, 2.3, 0.3):
        o.append(box('sl', (W - 0.5, 0.02, 0.02), (W / 2, 0.48, z), lat))
    # 手摺（木製）
    o.append(box('rail', (W, 0.08, 0.06), (W / 2, -0.25, 1.05), lat))
    for x in np.arange(0.1, W, 0.3):
        o.append(box('rp', (0.04, 0.04, 0.6), (x, -0.25, 0.75), lat))
    o.append(box('rslab', (W, 0.35, 0.08), (W / 2, -0.15, 0.42), M('hotel_slab', '#bfae90')))
    return o


def ground_shop(W=3.6, H=3.2):
    """路面店（ガラスのショーウィンドウ＋入口＋看板帯）。"""
    o = []
    fm = M('gs_frame', '#3c3f43', metal=0.5, rough=0.4)
    o.append(box('pier', (0.25, 0.3, H), (0.125, 0.05, H / 2), M('gs_pier', '#b9b2a6', rough=0.6)))
    o.append(box('pier', (0.25, 0.3, H), (W - 0.125, 0.05, H / 2), M('gs_pier', '#b9b2a6', rough=0.6)))
    o.append(box('fascia', (W, 0.35, 0.65), (W / 2, -0.05, H - 0.32), M('gs_fascia', '#efefe9', rough=0.5)))
    o.append(box('kick', (W, 0.2, 0.25), (W / 2, 0.1, 0.125), M('gs_kick', '#55585c', rough=0.5)))
    o += win_unit(0.25, W - 0.25, 0.25, H - 0.65, depth=0.12, frame='#3c3f43', glass='#4a5a64', tag='WINA',
                  interior='#c9b48c', split=3)
    # 店内の陳列棚
    for x in (0.6, 1.5, 2.4):
        o.append(box('shelf', (0.5, 0.4, 1.2), (x, 1.6, 0.6), M('shelf', '#8a6a48', rough=0.7)))
    # 日よけテント
    aw = M('awning', '#b84a3a', rough=0.8)
    o.append(box('awning', (W - 0.3, 0.9, 0.05), (W / 2, -0.45, H - 0.75), aw, rot=('X', math.radians(-22))))
    return o


def ground_office(W=3.6, H=3.2):
    st = M('go_stone', '#8f8a84', rough=0.45, spec=0.5)
    hole = (0.35, W - 0.35, 0.08, H - 0.45)
    o = wall_with_holes(W, H, [hole], st, thick=0.2)
    o += win_unit(*hole, depth=0.2, frame='#2e3134', glass='#2e3e4a', tag='WINA', interior='#8a8478', split=2)
    o.append(box('plinth', (W, 0.06, 0.08), (W / 2, -0.03, 0.04), M('go_plinth', '#5c5a56', rough=0.5)))
    return o


def ground_house(W=3.6, H=2.8):
    wm = M('house_wall', '#ece6da', rough=0.85)
    holes = [(0.4, 1.3, 0.05, 2.1), (1.9, 3.2, 0.8, 1.9)]
    o = wall_with_holes(W, H, holes, wm, thick=0.1)
    o.append(box('door', (0.88, 0.04, 2.04), (0.85, 0.09, 1.07), M('door', '#6b4a32', rough=0.6)))
    o.append(box('knob', (0.04, 0.06, 0.04), (1.18, 0.04, 1.0), M('knob', '#c8b070', metal=0.9, rough=0.3)))
    o += win_unit(*holes[1], depth=0.1, frame='#5b5b5b', tag='WINA', glass='#3e4a54', interior='#7a6a54', curtain='#efe6d0')
    o.append(box('step', (1.2, 0.5, 0.15), (0.85, -0.25, 0.075), M('step', '#b5b0a8')))
    o.append(box('canopy', (1.3, 0.7, 0.06), (0.85, -0.3, 2.35), M('canopy', '#5c5e60')))
    o.append(box('meter', (0.3, 0.12, 0.4), (3.35, -0.06, 1.3), M('meter', '#d0d0cc')))
    return o



def facade_machiya(W=3.6, H=2.8):
    """町家の2階（下半分は焼杉の板張り、上は生成りの漆喰。木の出格子窓＋障子）。"""
    wood = M('machiya_wood', '#3a2c22', rough=0.75)
    pl = M('machiya_plaster', '#ddd2bc', rough=0.9)
    hole = (0.55, W - 0.55, 0.75, 1.95)
    o = []
    # 焼杉板（縦張り・目板）
    for k in range(int(round(W / 0.24))):
        x = 0.12 + k * 0.24
        o.append(box('yakisugi', (0.235, 0.06, 0.75), (x, 0.03, 0.375), M('machiya_sugi', '#2a2420' if k % 3 else '#33291f', rough=0.85)))
        o.append(box('meita', (0.03, 0.08, 0.75), (x + 0.12, 0.0, 0.375), wood))
    wl = wall_with_holes(W, H - 0.75, [(hole[0], hole[1], 0, hole[3] - 0.75)], pl, thick=0.1)
    for ob in wl:   # wall_with_holes は z=0 起点なので板張りの上へ持ち上げる
        ob.location.z += 0.75
    o += wl
    # 障子（夜は灯る）と出格子
    o.append(box('WINA_shoji', (hole[1] - hole[0], 0.02, hole[3] - hole[2]), ((hole[0] + hole[1]) / 2, 0.35, (hole[2] + hole[3]) / 2), M('machiya_paper', '#e6dcc4', rough=0.95)))
    lat = M('machiya_lattice', '#6a4c34', rough=0.8)
    for x in np.arange(hole[0] + 0.06, hole[1], 0.11):
        o.append(box('koshi', (0.045, 0.06, hole[3] - hole[2]), (x, -0.12, (hole[2] + hole[3]) / 2), lat))
    o += [box('dgk', (hole[1] - hole[0] + 0.16, 0.24, 0.08), ((hole[0] + hole[1]) / 2, -0.06, hole[2] - 0.04), lat),
          box('dgk', (hole[1] - hole[0] + 0.16, 0.24, 0.08), ((hole[0] + hole[1]) / 2, -0.06, hole[3] + 0.04), lat),
          box('dgk', (0.08, 0.24, hole[3] - hole[2]), (hole[0] - 0.04, -0.06, (hole[2] + hole[3]) / 2), lat),
          box('dgk', (0.08, 0.24, hole[3] - hole[2]), (hole[1] + 0.04, -0.06, (hole[2] + hole[3]) / 2), lat)]
    # 柱・軒桁
    o += [box('post', (0.16, 0.12, H), (0.08, -0.04, H / 2), wood), box('post', (0.16, 0.12, H), (W - 0.08, -0.04, H / 2), wood),
          box('keta', (W, 0.16, 0.22), (W / 2, -0.06, H - 0.11), wood), box('nuki', (W, 0.1, 0.08), (W / 2, -0.03, 0.75), wood)]
    return o


def ground_machiya(W=3.6, H=3.0):
    """町家の一階（木の格子戸・出格子・のれん掛け）。"""
    o = []
    wood = M('machiya_wood', '#3a2c22', rough=0.75)
    dark = M('machiya_dark', '#1e1814', rough=0.8)
    o.append(box('back', (W, 0.05, H), (W / 2, 0.5, H / 2), M('machiya_inside', '#6a5440', rough=0.9)))
    o.append(box('WINA_glow', (W - 0.3, 0.02, H - 0.6), (W / 2, 0.45, H / 2 - 0.1), M('machiya_paper', '#e8dcc0', rough=0.95)))
    # 格子（細い縦桟）
    for x in np.arange(0.08, W, 0.07):
        o.append(box('koshi', (0.035, 0.05, H - 0.35), (x, 0.0, (H - 0.35) / 2 + 0.05), wood))
    for z in (0.35, 1.2, H - 0.45):
        o.append(box('yoko', (W, 0.06, 0.06), (W / 2, -0.01, z), wood))
    o += [box('post', (0.18, 0.18, H), (0.09, -0.03, H / 2), dark), box('post', (0.18, 0.18, H), (W - 0.09, -0.03, H / 2), dark),
          box('beam', (W, 0.2, 0.3), (W / 2, -0.04, H - 0.15), dark), box('sill', (W, 0.25, 0.1), (W / 2, -0.04, 0.05), M('machiya_stone', '#8a857c'))]
    return o


def wh_ribs(W, H, holes):
    """波板（縦リブ）。holes=[(x0,x1,z0,z1)] の範囲は抜く。"""
    o = []
    sh = M('wh_sheet', '#b8bcbc', metal=0.35, rough=0.55)
    sh2 = M('wh_sheet2', '#a6aaab', metal=0.35, rough=0.6)
    for k in range(int(round(W / 0.15))):
        x = 0.075 + k * 0.15
        cut = sorted([(h[2], h[3]) for h in holes if h[0] - 0.05 < x < h[1] + 0.05])
        segs, z = [], 0.0
        for (c0, c1) in cut:
            if c0 > z:
                segs.append((z, c0))
            z = max(z, c1)
        if z < H:
            segs.append((z, H))
        for (z0, z1) in segs:
            o.append(box('rib', (0.075, 0.06 if k % 2 else 0.02, z1 - z0), (x, 0.03 if k % 2 else 0.0, (z0 + z1) / 2), sh if k % 2 else sh2))
    return o


def wh_window(x0, x1, z0, z1):
    o = [box('WINA_glass', (x1 - x0, 0.01, z1 - z0), ((x0 + x1) / 2, 0.06, (z0 + z1) / 2), M('wh_glass', '#4a5866', rough=0.08, spec=0.8)),
         box('wh_room', (x1 - x0, 0.02, z1 - z0), ((x0 + x1) / 2, 0.9, (z0 + z1) / 2), M('wh_in', '#8a8478', rough=0.9))]
    fm = M('wh_wframe', '#8a8e90', metal=0.6, rough=0.35)
    t = 0.06
    o += [box('fr', (x1 - x0 + 2 * t, 0.1, t), ((x0 + x1) / 2, -0.01, z0 - t / 2), fm),
          box('fr', (x1 - x0 + 2 * t, 0.1, t), ((x0 + x1) / 2, -0.01, z1 + t / 2), fm),
          box('fr', (t, 0.1, z1 - z0), (x0 - t / 2, -0.01, (z0 + z1) / 2), fm),
          box('fr', (t, 0.1, z1 - z0), (x1 + t / 2, -0.01, (z0 + z1) / 2), fm)]
    n = max(1, int(round((x1 - x0) / 0.8)))
    for k in range(1, n):
        o.append(box('mull', (0.04, 0.08, z1 - z0), (x0 + (x1 - x0) * k / n, 0.0, (z0 + z1) / 2), fm))
    return o


def facade_warehouse(W=3.6, H=2.8):
    """倉庫・工場（波形スレート/鋼板の外壁、高窓）。"""
    hole = (0.5, W - 0.5, 1.8, 2.45)
    o = wh_ribs(W, H, [hole]) + wh_window(*hole)
    o.append(box('rust', (0.4, 0.07, 0.35), (W * 0.3, -0.01, 0.2), M('wh_rust', '#8a6a52', rough=0.9)))
    return o


def ground_warehouse(W=7.2, H=3.2):
    """倉庫の一階（波板の壁＋巻き上げシャッター＋通用口）。"""
    sx0, sx1 = 0.5, 4.1
    sc = (sx0 + sx1) / 2
    holes = [(sx0 - 0.1, sx1 + 0.1, 0, H - 0.3), (4.85, 5.75, 0, 2.05), (6.2, 6.9, 1.2, 1.9)]
    o = wh_ribs(W, H, holes)
    sm = M('wh_shutter', '#9ca2a6', metal=0.5, rough=0.45)
    o.append(box('frame', (sx1 - sx0 + 0.2, 0.1, H - 0.3), (sc, -0.02, (H - 0.3) / 2), M('wh_frame', '#6a6e70', metal=0.5)))
    for z in np.arange(0.06, H - 0.5, 0.09):
        o.append(box('slat', (sx1 - sx0, 0.04, 0.07), (sc, -0.08, z), sm))
    o.append(box('box', (sx1 - sx0 + 0.2, 0.3, 0.3), (sc, -0.15, H - 0.45), M('wh_box', '#7e8486', metal=0.5)))
    o.append(box('WINA_lamp', (0.3, 0.06, 0.12), (sc, -0.32, H - 0.2), M('wh_lamp', '#f0e8d0')))
    # 通用口（鉄扉）と小窓
    o.append(box('doorframe', (1.0, 0.08, 2.1), (5.3, 0.02, 1.05), M('wh_frame', '#6a6e70', metal=0.5)))
    o.append(box('door', (0.9, 0.08, 2.0), (5.3, -0.03, 1.0), M('wh_door', '#7a8a96', metal=0.4, rough=0.5)))
    o.append(box('knob', (0.08, 0.06, 0.08), (5.65, -0.09, 1.0), M('wh_knob', '#d0d0c8', metal=0.8)))
    o += wh_window(6.2, 6.9, 1.2, 1.9)
    o.append(box('rust', (0.5, 0.07, 0.4), (4.5, -0.01, 0.25), M('wh_rust', '#8a6a52', rough=0.9)))
    return o


def facade_danchi(W=3.6, H=2.8):
    """団地（打ち放し風の壁＋鉄の手すりのバルコニー＋アルミサッシ）。"""
    wm = M('danchi_wall', '#d0cdc4', rough=0.85)
    holes = [(0.25, W - 0.25, 0.1, 2.15)]
    o = wall_with_holes(W, H, holes, wm)
    o += win_unit(*holes[0], depth=0.14, frame='#b0b4b8', glass='#3c4854', tag='WINA', interior='#6e6252', curtain='#d8d0b8', split=2)
    o.append(box('slab', (W, 1.0, 0.14), (W / 2, -0.5, 0.0), M('danchi_slab', '#c4c0b6', rough=0.85)))
    st = M('danchi_steel', '#6e8296', metal=0.5, rough=0.45)
    o.append(box('rtop', (W, 0.06, 0.06), (W / 2, -0.98, 1.05), st))
    for x in np.arange(0.06, W, 0.12):
        o.append(box('rb', (0.025, 0.025, 0.95), (x, -0.98, 0.55), st))
    o.append(box('div', (0.06, 1.0, 2.6), (0.03, -0.5, 1.3), wm))
    return o


FACADES = [
    # name, builder, W, H, px幅
    ('office', facade_office, 3.6, 2.8),
    ('glass', facade_glass, 3.6, 2.8),
    ('mansion', facade_mansion, 3.6, 2.8),
    ('shop', facade_shop, 3.0, 2.8),
    ('house', facade_house, 3.6, 2.8),
    ('hotel', facade_hotel, 3.6, 2.8),
    ('gshop', ground_shop, 3.6, 3.2),
    ('goffice', ground_office, 3.6, 3.2),
    ('ghouse', ground_house, 3.6, 2.8),
    ('machiya', facade_machiya, 3.6, 2.8),
    ('gmachiya', ground_machiya, 3.6, 3.0),
    ('warehouse', facade_warehouse, 3.6, 2.8),
    ('gwarehouse', ground_warehouse, 7.2, 3.2),
    ('danchi', facade_danchi, 3.6, 2.8),
]


def setup_world_sky():
    sc = bpy.context.scene
    w = bpy.data.worlds.new('SkyW')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    cr = ramp.color_ramp
    cr.elements[0].position = 0.45
    cr.elements[0].color = (*hex2lin('#6e6a60'), 1)
    cr.elements[1].position = 0.5
    cr.elements[1].color = (*hex2lin('#e6ecf0'), 1)
    e = cr.elements.new(0.9)
    e.color = (*hex2lin('#7fa3c8'), 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs[0])


def render_facade(name, builder, W, H, pxw=512):
    reset()
    sc = bpy.context.scene
    objs = builder(W, H)
    setup_world_sky()
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = 3.0
    ld.angle = math.radians(4)
    ls = bpy.data.objects.new('Sun', ld)
    ls.rotation_euler = (math.radians(52), 0, math.radians(-28))  # 左上前方から
    sc.collection.objects.link(ls)
    cd = bpy.data.cameras.new('Cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = max(W, H)
    cam = bpy.data.objects.new('Cam', cd)
    cam.location = (W / 2, -20, H / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.clip_end = 100
    pxh = int(round(pxw * H / W))
    sc.render.resolution_x, sc.render.resolution_y = pxw, pxh
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as ex:
        print('GPU fallback', ex)
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 90
    sc.render.filepath = os.path.join(TEX, f'fac_{name}.jpg')
    bpy.ops.render.render(write_still=True)
    print('FACADE', sc.render.filepath)
    # 夜間マスク: WINA→赤, WINB→緑, それ以外→黒
    red = mat('_mR', '#000000', emit='#ff0000', estr=1.0)
    grn = mat('_mG', '#000000', emit='#00ff00', estr=1.0)
    blk = mat('_mK', '#000000', rough=1.0)
    for o in sc.objects:
        if o.type != 'MESH':
            continue
        m = red if o.name.startswith('WINA') else grn if o.name.startswith('WINB') else blk
        o.data.materials.clear()
        o.data.materials.append(m)
    sc.world = None
    bpy.data.objects.remove(ls, do_unlink=True)
    sc.cycles.samples = 4
    sc.cycles.use_denoising = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.filepath = os.path.join(TEX, f'fac_{name}_m.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    what = (argv_after() or ['all'])[0]
    if what in ('ground', 'all'):
        reset()
        ground_all()
    if what.startswith('fac:'):   # 例: fac:warehouse,gwarehouse
        for (n, b, W, H) in FACADES:
            if n in what[4:].split(','):
                render_facade(n, b, W, H, 512 if W >= 3.5 else 448)
    if what in ('facade', 'all', 'newfac'):
        for (n, b, W, H) in FACADES:
            if what == 'newfac' and n not in ('machiya', 'gmachiya', 'warehouse', 'gwarehouse', 'danchi'):
                continue
            render_facade(n, b, W, H, 512 if W >= 3.5 else 448)
