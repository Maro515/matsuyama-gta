#!/usr/bin/env python3
"""街の焼き込みデータ（build/baked/city.json）を src/baked/city.js にする（2026-10-19）。

起動のたびに乱数で探していた街の配置（建物・木・みかん・生活道路・沿道の建物・用水路・河川敷・段々畑・小道の切り通し、
3D の登城道・ランドマークの当たり判定・街具の置き場所の判定）を記録したもの。ゲームは起動時にこれを読むだけにする。

作り直す手順（地図・建物・街具の生成、当たり判定、モデルを変えたら）:
  1. 開発サーバー（python3 build/devserver.py 8891）で /src/game.html?bake=rec を開き、3D の起動が終わるまで待つ。
     生成しながら記録した街が POST /__save?name=city で build/baked/city.json に保存される（コンソールに「city bake saved 200」）
  2. python3 build/bake_city.py   → src/baked/city.js を書き出す
  3. /src/game.html を開き直して確かめる: BAKE.play（建物など）と G3.bakeW.play（3D）が true、
     G3.street.stats.bake が {mode:'play', bad:null}。python3 build/assemble.py で1ファイル版にも入る
古い焼き込みは指紋（生成に関わるソースとモデルの内容のハッシュ）が合わないので使われず、生成に戻る（遅くなるだけで街は正しい）。
?bake=0 で焼き込みを使わずに生成できる（比べる時）。
"""
import io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'baked', 'city.json')
OUT = os.path.join(ROOT, 'src', 'baked', 'city.js')


def main():
    d = json.load(open(SRC))
    assert d.get('v') == 1 and d.get('game'), 'city.json の形式が違います'
    if not d.get('world'):
        print('注意: 3D の焼き込み（world）がありません（WebGL なしで記録した？）。建物などだけ焼き込みます')
    txt = json.dumps(d, separators=(',', ':'), ensure_ascii=False)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write('// 生成物: python3 build/bake_city.py（元は ?bake=rec で記録した build/baked/city.json）。手で編集しない\n')
        f.write('window.CITY_BAKE=' + txt + ';\n')
    g = d['game']
    print('src/baked/city.js', round(os.path.getsize(OUT) / 1024), 'KB',
          '| 建物', len(g.get('zone', [])) + len(g.get('infill', [])), '生活道路', len(g.get('lanes', [])),
          '| 判定の記録', (d.get('world') or {}).get('street', {}).get('n', 0), 'ビット')


if __name__ == '__main__':
    main()
