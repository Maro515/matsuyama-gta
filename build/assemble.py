#!/usr/bin/env python3
"""src/game.html と r3d/*.js・vendor・assets を1ファイルの index.html にまとめる。
使い方: python3 build/assemble.py
"""
import base64, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'game.html')
OUT = os.path.join(ROOT, 'index.html')
MIME = {'.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
        '.js': 'text/javascript', '.wasm': 'application/wasm'}


def js_safe(code):
    return code.replace('</script', '<\\/script')


def block(name, html, repl):
    pat = re.compile(r'<!--BUILD:%s-->.*?<!--/BUILD:%s-->' % (name, name), re.S)
    assert pat.search(html), name
    return pat.sub(lambda m: repl, html)


def fp_hash(s):
    """game.html の fpHash と同じ 64bit ハッシュ（UTF-16 の符号単位ごと）"""
    M = 0xffffffff
    u = s.encode('utf-16-le')
    n = len(u) // 2
    h1, h2 = (0xdeadbeef ^ n) & M, (0x41c6ce57 ^ n) & M
    for i in range(0, len(u), 2):
        c = u[i] | (u[i + 1] << 8)
        h1 = ((h1 ^ c) * 2654435761) & M
        h2 = ((h2 ^ c) * 1597334677) & M
    h1 = (((h1 ^ (h1 >> 16)) * 2246822507) & M) ^ (((h2 ^ (h2 >> 13)) * 3266489909) & M)
    h2 = (((h2 ^ (h2 >> 16)) * 2246822507) & M) ^ (((h1 ^ (h1 >> 13)) * 3266489909) & M)
    return '%08x%08x' % (h2, h1)


def bake_status(html, baked_js):
    """焼き込みが今の game.html（生成の部分）に合っているか。3D の方はページの中で確かめる"""
    if not baked_js:
        return 'なし（起動時に生成）'
    i = html.index("<script>\n'use strict';") + len('<script>')
    src = html[i:html.index('</script>', i)]
    end = src.find('/* ---------- セーブ ---------- */')
    fp = fp_hash(src[:end] if end > 0 else src)
    m = re.search(r'"game":\{"fp":"([0-9a-f]{16})"', baked_js)
    if m and m.group(1) == fp:
        return 'OK'
    return '古い（起動時に生成する。build/bake_city.py の手順で作り直す）'


def main():
    html = io.open(SRC, encoding='utf-8').read()
    vendor = io.open(os.path.join(ROOT, 'vendor', 'three-bundle.js'), encoding='utf-8').read()
    bk = os.path.join(ROOT, 'src', 'baked', 'city.js')
    baked = io.open(bk, encoding='utf-8').read() if os.path.exists(bk) else ''
    status = bake_status(html, baked)
    html = block('VENDOR', html, '<script>' + js_safe(vendor) + '</script>')
    html = block('BAKED', html, '<script>' + js_safe(baked) + '</script>' if baked else '')
    data = {}
    # 描画コードから参照されているファイルだけを同梱する
    refs = ''.join(io.open(os.path.join(ROOT, 'src', 'r3d', f), encoding='utf-8').read()
                   for f in os.listdir(os.path.join(ROOT, 'src', 'r3d')) if f.endswith('.js'))
    ktx = "'.ktx2'" in refs   # 描画コードが画像テクスチャを KTX2 で読むか
    for sub in ('tex', 'glb', 'basis'):
        d = os.path.join(ROOT, 'assets', sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            ext = os.path.splitext(f)[1].lower()
            if ext not in MIME:
                continue
            if sub == 'basis' and not ktx:
                continue
            if sub == 'tex':
                # KTX2 を使う時は、KTX2 のある画像の元ファイル（jpg/png）は同梱しない（タイトル画像・水の法線などは元のまま）
                base = os.path.splitext(f)[0]
                has_ktx = os.path.exists(os.path.join(d, base + '.ktx2'))
                if ktx and ext in ('.jpg', '.png') and has_ktx:
                    continue
                if not ktx and ext == '.ktx2':
                    continue
                used = ('tex/' + f) in refs or ('tex/' + base + '.') in refs or (f.startswith('fac_') and "'tex/fac_'" in refs)
                if not used:
                    continue
            b = open(os.path.join(d, f), 'rb').read()
            data[sub + '/' + f] = 'data:%s;base64,%s' % (MIME[ext], base64.b64encode(b).decode())
    entries = ',\n'.join('%r:%r' % (k, v) for k, v in data.items())
    html = block('ASSETS', html, '<script id="assetdata">window.ASSET_DATA={\n' + entries + '\n};</script>')
    r3 = []
    for f in re.findall(r'<script src="(r3d/[^"]+)"></script>', html):
        r3.append(io.open(os.path.join(ROOT, 'src', f), encoding='utf-8').read())
    html = block('R3D', html, '\n'.join('<script>\n' + js_safe(c) + '\n</script>' for c in r3))
    io.open(OUT, 'w', encoding='utf-8').write(html)
    print('index.html', round(os.path.getsize(OUT) / 1024 / 1024, 2), 'MB', '| assets:', len(data), '| 街の焼き込み:', status)


if __name__ == '__main__':
    main()
