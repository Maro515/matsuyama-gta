# GRAND THEFT MIKAN 〜松山〜

愛媛県松山市を簡略再現したマップを自由に走り回る、見下ろし型のGTA風ブラウザゲーム（単一HTML・依存ゼロ）。

▶ プレイ: https://maro515.github.io/matsuyama-gta/

- 松山城・道後温泉・大街道・銀天街・伊予鉄市内電車（坊っちゃん列車）・JR松山駅・三津浜港・松山空港などを再現
- ミッション7本＋配達ギグ、みかん収集、手配度＆パトカー追跡、昼夜サイクル
- 操作: WASD/矢印移動、E乗車/降車、Shiftダッシュ、Spaceブレーキ、M全域マップ（スマホ/iPadはタッチ操作対応）

※フィクションのパロディゲームです。地図は簡略化した再現です。

## 開発

- 編集するのは `src/`（`src/game.html` と `src/r3d/*.js`）と `assets/`。開発中は `python3 build/devserver.py 8891` を起動して http://localhost:8891/src/game.html を開く（組み立て不要）
- 1ファイル版: `python3 build/assemble.py` で `index.html` を作る（素材を全部埋め込むので、ダブルクリックでオフラインでも動く）。生成物なのでリポジトリには入れない
- 公開: main に push すると GitHub Actions（`.github/workflows/pages.yml`）が同じ手順で組み立てて GitHub Pages に出す
- 素材を作り直したら: 3D モデルは `sh blender/build_all.sh`（最後に頂点の量子化まで行う）、画像は `sh build/compress_textures.sh`（KTX2 化）
- 街の配置（建物・木・路地・街具など）は焼き込みデータ `src/baked/city.js` から読む（起動時に乱数で探さない）。地図・生成・当たり判定・モデルを変えたら、開発サーバーで `/src/game.html?bake=rec` を開いて起動を待ち、`python3 build/bake_city.py` で作り直す（古いままでも起動時の生成に戻るだけで街は正しい。`?bake=0` は焼き込みを使わない）
