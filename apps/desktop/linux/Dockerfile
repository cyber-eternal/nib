# Linux build image for Nib (Tauri 2). Native arch by default: arm64 on Apple Silicon, amd64 with --platform.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl wget file git unzip xz-utils pkg-config \
      libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
      librsvg2-dev libayatana-appindicator3-dev libxdo-dev \
      patchelf xdg-utils desktop-file-utils squashfs-tools libfuse2t64 rpm \
  && rm -rf /var/lib/apt/lists/*

# Vite's PostCSS needs require(esm), which Ubuntu's Node 18 lacks
ARG NODE_MAJOR=22
RUN arch="$(dpkg --print-architecture | sed 's/amd64/x64/')" \
  && base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x" \
  && file="$(curl -fsSL "$base/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-${arch}.tar.xz" | head -1)" \
  && curl -fsSL "$base/$file" | tar -xJ -C /usr/local --strip-components=1 \
  && node --version

ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:/root/.bun/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustc --version

# the bun that wrote bun.lockb, as in the release workflow
ARG BUN_VERSION=bun-v1.0.1
RUN curl -fsSL https://bun.sh/install | bash -s "${BUN_VERSION}" && bun --version

# linuxdeploy and appimagetool are AppImages themselves, and containers have no FUSE; linuxdeploy's
# bundled strip is too old for the .relr.dyn sections Ubuntu 24.04 libraries carry
ENV APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1

WORKDIR /src
