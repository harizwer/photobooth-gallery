#!/bin/sh
# Tests the Canon USB code on a computer, against a pretend Canon (no Android needed).
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
src=app/src/main/java/my/photobooth/booth
javac -d "$out" $src/UsbLink.java $src/Ptp.java $src/CanonEos.java $src/CanonService.java test-jvm/FakeCanonTest.java
java -cp "$out" my.photobooth.booth.FakeCanonTest
