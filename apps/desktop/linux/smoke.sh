#!/usr/bin/env bash
# Installs the built .deb in a clean Ubuntu 24.04 container and runs Nib under Xvfb:
# a plain launch, a second launch with examples/demo.nibd (single instance hands it to the first),
# and a cold launch with the file. Screenshots and logs go to $OUT (default: a temp folder);
# the second-launch screenshot is copied to apps/desktop/linux/smoke.png (smoke-<arch>.png when emulated).
set -euo pipefail

arch="${1:-$(docker version --format '{{.Server.Arch}}')}"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
suffix=""
[ "$arch" = "$(docker version --format '{{.Server.Arch}}')" ] || suffix="-$arch"
deb="$(ls "$repo"/apps/desktop/src-tauri/target-linux$suffix/release/bundle/deb/*.deb | head -1)"
out="${OUT:-$(mktemp -d)}"
mkdir -p "$out"

docker run --rm --platform "linux/$arch" \
  -v "$deb:/pkg/nib.deb:ro" \
  -v "$repo/examples:/examples:ro" \
  -v "$out:/out" \
  ubuntu:24.04 bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq /pkg/nib.deb xvfb xauth imagemagick xdotool dbus-x11 >/dev/null
    dpkg -s nib | grep -E "^(Package|Version|Depends):" > /out/package.txt
    grep -E "^(Exec|MimeType|Categories)=" /usr/share/applications/Nib.desktop >> /out/package.txt
    xdg-mime query filetype /examples/demo.nibd >> /out/package.txt 2>&1 || true
    xdg-mime query default application/vnd.nib+json >> /out/package.txt 2>&1 || true
    cp /examples/demo.nibd /tmp/demo.nibd
    cat > /tmp/run.sh <<"INNER"
set -u
export WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
title() { xdotool search --onlyvisible --name . getwindowname 2>/dev/null | sort -u | paste -sd "|" ; }
nib >/out/first.log 2>&1 &
first=$!
sleep 15
import -window root /out/empty.png
echo "first launch title: $(title)" >> /out/result.txt
start=$(date +%s)
timeout 20 nib /tmp/demo.nibd >/out/second.log 2>&1; code=$?
echo "second launch exited with $code after $(( $(date +%s) - start ))s" >> /out/result.txt
sleep 6
import -window root /out/handoff.png
echo "after hand-off title: $(title)" >> /out/result.txt
kill -0 $first 2>/dev/null && echo "first instance still running" >> /out/result.txt
kill $first; wait $first 2>/dev/null
nib /tmp/demo.nibd >/out/cold.log 2>&1 &
cold=$!
sleep 15
import -window root /out/cold.png
echo "cold launch with file title: $(title)" >> /out/result.txt
kill $cold; wait $cold 2>/dev/null
true
INNER
    xvfb-run -a -s "-screen 0 1440x900x24" dbus-run-session -- bash /tmp/run.sh
  '

cp "$out/handoff.png" "$repo/apps/desktop/linux/smoke$suffix.png"
echo "artifacts in $out"
cat "$out/package.txt" "$out/result.txt"
for log in first second cold; do
  echo "--- $log.log"; cat "$out/$log.log"
done
