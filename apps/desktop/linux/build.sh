#!/usr/bin/env bash
# Builds Nib's .deb, .rpm and .AppImage in Docker, leaving the Mac's node_modules, dist and target/ alone.
#   apps/desktop/linux/build.sh            # the Docker host's own architecture (arm64 on Apple silicon)
#   apps/desktop/linux/build.sh amd64      # x86_64 under emulation (slow)
# Bundles land in apps/desktop/src-tauri/target-linux[-amd64]/release/bundle/.
set -euo pipefail

arch="${1:-$(docker version --format '{{.Server.Arch}}')}"
case "$arch" in
  arm64 | aarch64) arch=arm64 suffix="" ;;
  amd64 | x86_64) arch=amd64 suffix="-amd64" ;;
  *) echo "unknown architecture: $arch" >&2; exit 2 ;;
esac
if [ "$arch" = "$(docker version --format '{{.Server.Arch}}')" ]; then suffix=""; fi

repo="$(cd "$(dirname "$0")/../../.." && pwd)"
image="nib-linux-build:$arch"
target="apps/desktop/src-tauri/target-linux$suffix"

docker build --platform "linux/$arch" -t "$image" "$repo/apps/desktop/linux"

# named volumes shadow the Mac's platform-specific folders inside the bind-mounted repo; Cargo builds in a
# volume too, since linuxdeploy can't copy libraries into an AppDir on the bind mount (permission denied),
# and only the finished packages are copied out
docker run --rm --platform "linux/$arch" \
  -v "$repo:/src" \
  -v "nib-root-node-modules-$arch:/src/node_modules" \
  -v "nib-desktop-node-modules-$arch:/src/apps/desktop/node_modules" \
  -v "nib-desktop-dist-$arch:/src/apps/desktop/dist" \
  -v "nib-tauri-gen-$arch:/src/apps/desktop/src-tauri/gen" \
  -v "nib-cargo-registry-$arch:/usr/local/cargo/registry" \
  -v "nib-cargo-target-$arch:/target" \
  -e CARGO_TARGET_DIR=/target \
  -e OUT="/src/$target/release/bundle" \
  -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" \
  -e TAURI_SIGNING_PRIVATE_KEY -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  "$image" bash -euo pipefail -c '
    bun install --frozen-lockfile
    cd apps/desktop
    bun run tauri build '"${TAURI_ARGS:-}"'
    for kind in deb rpm appimage; do
      [ -d "/target/release/bundle/$kind" ] || continue
      mkdir -p "$OUT/$kind"
      find "/target/release/bundle/$kind" -maxdepth 1 -type f \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage*" \) \
        -exec cp -f {} "$OUT/$kind/" \;
    done
  '

echo
ls -lh "$repo/$target/release/bundle/"{deb,rpm,appimage}/ 2>/dev/null || true
