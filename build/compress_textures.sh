#!/bin/sh
# 画像テクスチャを KTX2（Basis Universal ETC1S＋ミップマップ）に変換する。
# GPU に圧縮のまま載るので、RGBA のままより GPU メモリが 1/4〜1/8 になる。
# 元の JPG/PNG（Blender の textures.py などが作る）はそのまま残し、横に .ktx2 を書き出す。
# 使い方: sh build/compress_textures.sh   （要: brew install basis_universal）
set -e
cd "$(dirname "$0")/.."
command -v basisu >/dev/null || { echo "basisu がありません: brew install basis_universal"; exit 1; }
n=0
for f in assets/tex/*.jpg assets/tex/*.png; do
  b=$(basename "$f"); b="${b%.*}"
  case "$b" in
    title|water_n|leaf_*|*_m) continue ;;   # タイトル画面・水の法線・窓のマスク（R と G に別の窓を入れるので ETC1S だと混ざる）・GLB に埋め込む葉は元のまま
  esac
  lin=""
  case "$b" in detail) lin="-linear" ;; esac   # 色ではないデータ（明暗の細部）
  out="assets/tex/$b.ktx2"
  # 元画像のほうが新しい時だけ作り直す
  if [ ! -f "$out" ] || [ "$f" -nt "$out" ]; then
    basisu -ktx2 -etc1s -quality 90 -effort 5 -mipmap -y_flip $lin "$f" -output_file "$out" >/dev/null
    n=$((n + 1))
  fi
done
echo "KTX2: $n 枚を変換"
ls -la assets/tex/*.ktx2 | awk '{s+=$5} END {print "合計", int(s/1024), "KB"}'
