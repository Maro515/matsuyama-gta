#!/bin/sh
# すべてのBlenderアセットを再生成する（約2分）
B=/Applications/Blender.app/Contents/MacOS/Blender
cd "$(dirname "$0")"
$B -b --factory-startup -P vehicles.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P human.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P trains.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P nature_props.py -- all 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P landmarks.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P street_props.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
# 書き出した GLB の頂点を量子化して小さくする（量子化済みのファイルは飛ばす）
(cd ../build && node compress_models.mjs | grep -E "KB|量子化済み")
