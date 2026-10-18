#!/usr/bin/env python3
"""src/game.html と r3d/*.js・vendor・assets を1ファイルの index.html にまとめる。
使い方: python3 build/assemble.py
"""
import base64, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'game.html')
OUT = os.path.join(ROOT, 'index.html')
MIME = {'.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary'}


def js_safe(code):
    return code.replace('</script', '<\\/script')


def block(name, html, repl):
    pat = re.compile(r'<!--BUILD:%s-->.*?<!--/BUILD:%s-->' % (name, name), re.S)
    assert pat.search(html), name
    return pat.sub(lambda m: repl, html)


def main():
    html = io.open(SRC, encoding='utf-8').read()
    vendor = io.open(os.path.join(ROOT, 'vendor', 'three-bundle.js'), encoding='utf-8').read()
    html = block('VENDOR', html, '<script>' + js_safe(vendor) + '</script>')
    data = {}
    # 描画コードから参照されているファイルだけを同梱する
    refs = ''.join(io.open(os.path.join(ROOT, 'src', 'r3d', f), encoding='utf-8').read()
                   for f in os.listdir(os.path.join(ROOT, 'src', 'r3d')) if f.endswith('.js'))
    for sub in ('tex', 'glb'):
        d = os.path.join(ROOT, 'assets', sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            ext = os.path.splitext(f)[1].lower()
            if ext not in MIME:
                continue
            if sub == 'tex' and ('tex/' + f) not in refs and not (f.startswith('fac_') and "'tex/fac_'" in refs):
                continue
            b = open(os.path.join(d, f), 'rb').read()
            data[sub + '/' + f] = 'data:%s;base64,%s' % (MIME[ext], base64.b64encode(b).decode())
    entries = ',\n'.join('%r:%r' % (k, v) for k, v in data.items())
    html = block('ASSETS', html, '<script>window.ASSET_DATA={\n' + entries + '\n};</script>')
    r3 = []
    for f in re.findall(r'<script src="(r3d/[^"]+)"></script>', html):
        r3.append(io.open(os.path.join(ROOT, 'src', f), encoding='utf-8').read())
    html = block('R3D', html, '\n'.join('<script>\n' + js_safe(c) + '\n</script>' for c in r3))
    io.open(OUT, 'w', encoding='utf-8').write(html)
    print('index.html', round(os.path.getsize(OUT) / 1024 / 1024, 2), 'MB', '| assets:', len(data))


if __name__ == '__main__':
    main()
