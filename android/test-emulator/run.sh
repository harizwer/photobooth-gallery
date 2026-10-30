#!/bin/bash
# Runs inside the Android 10 emulator job: installs the APK, opens it, and checks the page + Canon bridge.
set -x
mkdir -p out-emu
adb install -r app.apk
adb shell pm grant my.photobooth.booth android.permission.CAMERA
adb shell am start -n my.photobooth.booth/.MainActivity
sleep 30
adb exec-out screencap -p > out-emu/1-start.png
PID=$(adb shell pidof my.photobooth.booth | tr -d '\r')
echo "app pid: $PID"
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s localhost:9222/json > out-emu/targets.json
cat out-emu/targets.json
node android/test-emulator/cdp.js > out-emu/cdp.log 2>&1
cat out-emu/cdp.log
sleep 3
adb exec-out screencap -p > out-emu/2-after.png
adb logcat -d | grep -iE "canon|booth|AndroidRuntime|FATAL" | tail -300 > out-emu/logcat.txt
exit 0
