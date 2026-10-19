#!/usr/bin/env python3
"""小道のデータを src/game.html に焼き込む（build/baked/alley_cuts.json・alley_data.json → ALLEY_CUTS・ALLEY_DATA の行）。

作り直す手順（開発サーバー build/devserver.py で /src/game.html を3D表示で開いて）:
  1. ALLEY_CUTS と ALLEY_DATA を空 [] にして読み込み直し、ページで
       await fetch('/build/gen_alleys.js').then(r => r.text()).then(t => (0, eval)(t));
       await fetch('/__save?name=alley_cuts', {method: 'POST', body: JSON.stringify(genCuts())});
     → python3 build/bake_alleys.py cuts
  2. 読み込み直して（建物が割られた状態で）
       await fetch('/__save?name=alley_data', {method: 'POST', body: JSON.stringify(genAlleys())});
     → python3 build/bake_alleys.py data
  建物の生成・ランドマーク・街具の配置を変えたら作り直す（古いデータは game.html 側で建物に掛かる物だけ捨てる）。
  小道を作り直したら、続けて街の焼き込み（build/bake_city.py の手順）も作り直す（小道のデータは街の焼き込みの指紋に入る）。
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'game.html')


def put(html, name, arr):
    txt = json.dumps(arr, separators=(',', ':'), ensure_ascii=False)
    pat = re.compile(r'^const %s=\[.*?\];$' % name, re.M)
    assert pat.search(html), name
    return pat.sub(lambda m: 'const %s=%s;' % (name, txt), html, count=1)


def main():
    which = sys.argv[1:] or ['cuts', 'data']
    html = io.open(SRC, encoding='utf-8').read()
    for w in which:
        f = os.path.join(ROOT, 'build', 'baked', 'alley_%s.json' % w)
        arr = json.load(open(f))
        html = put(html, 'ALLEY_' + w.upper(), arr)
        print(w, len(arr), 'entries')
    io.open(SRC, 'w', encoding='utf-8').write(html)


if __name__ == '__main__':
    main()
