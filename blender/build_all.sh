#!/bin/sh
# すべてのBlenderアセットを再生成する（約2分）
B=/Applications/Blender.app/Contents/MacOS/Blender
cd "$(dirname "$0")"
$B -b --factory-startup -P vehicles.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P human.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P trains.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P nature_props.py -- all 2>&1 | grep -E "EXPORTED|Error|Traceback"
$B -b --factory-startup -P landmarks.py 2>&1 | grep -E "EXPORTED|Error|Traceback"
