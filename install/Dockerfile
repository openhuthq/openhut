# syntax=docker/dockerfile:1.7
# Built from the repo root, two images (scripts/image.sh builds both). `--target runtime` is openhut-runtime: the thin
# per-commit layer (the tree and its node_modules) on top of BASE, a published base by digest or `--target runtime-base`
# built here (dind, gVisor, Claude Code, agent-browser, the bundled agent image), rebuilt a few times a year. It runs agentd
# and the link to the main install. `--target main` is openhut: Node, the Docker CLI and the tree, no Docker daemon; it runs
# the web app and the server, and starts its own openhut-runtime (RUNTIME_IMAGE, by digest) next to it.
ARG BASE=runtime-base
ARG AGENT_IMAGE
ARG ALPINE=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
ARG DIND=docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac

FROM --platform=$BUILDPLATFORM $ALPINE AS web
RUN apk add --no-cache nodejs npm >/dev/null
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY packages/runtime/package.json packages/runtime/
COPY packages/app/package.json packages/app/
RUN npm ci --no-audit --no-fund --loglevel=error >/dev/null
COPY packages/common packages/common
COPY packages/app packages/app
RUN npm run build -w @openhut/app >/dev/null

FROM --platform=$BUILDPLATFORM $ALPINE AS tree
ARG BUILD=dev
COPY package.json package-lock.json /opt/openhut/
COPY install /opt/openhut/install
COPY vendor /opt/openhut/vendor
COPY packages/common /opt/openhut/packages/common
COPY packages/runtime/package.json /opt/openhut/packages/runtime/
COPY packages/runtime/src /opt/openhut/packages/runtime/src
COPY packages/runtime/test/agentd /opt/openhut/packages/runtime/test/agentd
COPY packages/app/package.json /opt/openhut/packages/app/
COPY --from=web /src/packages/app/dist /opt/openhut/packages/app/dist
RUN printf '%s\n' "$BUILD" > /opt/openhut/BUILD && cd /opt/openhut && \
    find install vendor package-lock.json packages/runtime/package.json packages/common/package.json packages/common/src/tunnel packages/runtime/src/agentd -type f | \
    LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-64 > RUNTIME_HASH && chmod -R go-w /opt/openhut

FROM --platform=$BUILDPLATFORM $ALPINE AS agent
ARG TARGETARCH
ARG AGENT_IMAGE
RUN apk add --no-cache skopeo zstd >/dev/null
RUN <<EOF
set -eu
name="openhut/hermes-agent:${AGENT_IMAGE##*:}"
skopeo copy -q --override-os linux --override-arch "$TARGETARCH" "docker://$AGENT_IMAGE" "docker-archive:/agent.tar:$name"
zstd -q -T0 --rm /agent.tar
printf '%s\n' "$name" > /image
EOF

FROM --platform=$BUILDPLATFORM $AGENT_IMAGE AS hermes

FROM --platform=$BUILDPLATFORM $ALPINE AS bridge
RUN apk add --no-cache nodejs npm >/dev/null
COPY --from=hermes /opt/hermes/scripts/whatsapp-bridge /bridge
COPY --from=agent /image /bridge/.image
RUN <<EOF
set -eu
cd /bridge
npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null
node -e 'const c=require("crypto"),f=require("fs"),d=process.argv[1];f.writeFileSync(d+"/node_modules/.hermes-pkg-hash",c.createHash("sha256").update(f.readFileSync(d+"/package.json")).digest("hex").slice(0,16))' /bridge
chown -R root:root /bridge && chmod -R go-w,a+rX /bridge
EOF

FROM $DIND AS base
RUN apk add --no-cache nodejs npm iptables ip6tables iproute2 curl zstd tar su-exec flock util-linux-misc >/dev/null && \
    addgroup -S openhut && adduser -S -D -G openhut openhut

FROM base AS downloads
ARG TARGETARCH
ARG GVISOR=20261109.0
ARG GVISOR_SHA512_amd64=0a0041fd862f4ea3042a9db8d41c742f48a01f909699adc2a0256e46d85e53f97b82b9fd154b3dce636f62b8d557677639f91c77d13f3f875ff9fa535275393c
ARG GVISOR_SHA512_arm64=a0b5d911512ef5fe70e833821e653a90c4d06c7027246ee49423f1d2fe2b2a509389a637797248958b90e49a069bb079ecde860efe1871b1d980ec0fe17e18ac
ARG CLAUDE=2.1.311
ARG CLAUDE_SHA256_amd64=86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada
ARG CLAUDE_SHA256_arm64=2e2496c9a8065df93acb0fca2d341f59a6b8777649b2e025ab8c9bcd5eef61f3
ARG CLAUDE_MUSL_SHA256_amd64=cd40dd327145ee47aa0deacd571801c1d782388f709d71242eee6b91de8ed11f
ARG CLAUDE_MUSL_SHA256_arm64=172150e3f9ea07e8e2e2e29862d7d9a25f5c234d8e909e4063df237665bf09b9
ARG AGENT_BROWSER=0.43.0
ARG AGENT_BROWSER_SHA512_amd64=598f2fcb649a6b7a11b7a5c49b3e1269ed56e6a4bd4e361c6d7e8813e7716fcb3600f7cbf57c908cc1c2ea3059ae1c2a0c122f51e4cc093fcfd9cab75cb3d207
ARG AGENT_BROWSER_SHA512_arm64=f030b6df82c69570a7f00d985c693ac28cb5b938f27b1bed1ddfd33901cbad5dac7d43190fae3b1d31c427217edb3d49d68477e0b681e63a8727d7744440be0b
ARG CADDY=2.11.9
ARG CADDY_SHA512_amd64=0e85544340290a16ce4bfb76fe7d65e9de1bf3a6e67f5ccfff30b30d27ea4c73e078077b7bf3e58ae60b6b12e44327705287059c775bca5782e8ee85ea7edd75
ARG CADDY_SHA512_arm64=9e5e76d7888542924de2c25353ae87c5f77e2a22c5b1198633cae13688922282e05383d142599205c88d8d80eee5e967d291214d7abce4835329a191b20dd6e0
RUN <<EOF
set -eu
case "$TARGETARCH" in amd64) A=x86_64 N=x64 ;; arm64) A=aarch64 N=arm64 ;; *) exit 1 ;; esac
eval "G=\$GVISOR_SHA512_$TARGETARCH C=\$CLAUDE_SHA256_$TARGETARCH M=\$CLAUDE_MUSL_SHA256_$TARGETARCH B=\$AGENT_BROWSER_SHA512_$TARGETARCH Y=\$CADDY_SHA512_$TARGETARCH"
fetch() { curl -fsSL --retry 4 --retry-all-errors "$1" -o "$2"; }
fetch "https://storage.googleapis.com/gvisor/releases/release/$GVISOR/$A/gvisor.tar.zstd" /tmp/gvisor.tar.zstd
printf '%s  %s\n' "$G" /tmp/gvisor.tar.zstd | sha512sum -c - >/dev/null
mkdir -p /out/usr/local/bin /out/opt/openhut/bin && tar --zstd -xf /tmp/gvisor.tar.zstd -C /out/usr/local/bin --no-same-owner
fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$N/claude" /out/opt/openhut/bin/claude
printf '%s  %s\n' "$C" /out/opt/openhut/bin/claude | sha256sum -c - >/dev/null
fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$N-musl/claude" /out/opt/openhut/bin/claude-musl
printf '%s  %s\n' "$M" /out/opt/openhut/bin/claude-musl | sha256sum -c - >/dev/null
fetch "https://registry.npmjs.org/@agent-browser/cli-linux-$N-gnu/-/cli-linux-$N-gnu-$AGENT_BROWSER.tgz" /tmp/agent-browser.tgz
printf '%s  %s\n' "$B" /tmp/agent-browser.tgz | sha512sum -c - >/dev/null
tar -xzf /tmp/agent-browser.tgz -C /tmp package/bin/agent-browser && mv /tmp/package/bin/agent-browser /out/opt/openhut/bin/agent-browser
fetch "https://github.com/caddyserver/caddy/releases/download/v$CADDY/caddy_${CADDY}_linux_$TARGETARCH.tar.gz" /tmp/caddy.tgz
printf '%s  %s\n' "$Y" /tmp/caddy.tgz | sha512sum -c - >/dev/null
tar -xzf /tmp/caddy.tgz -C /out/usr/local/bin caddy
chown -R root:root /out && chmod 0755 /out/opt/openhut/bin/* /out/usr/local/bin/*
EOF

FROM base AS runtime-base
COPY --from=downloads /out/ /
COPY --from=agent /agent.tar.zst /image /opt/openhut-agent/
COPY --from=bridge /bridge /var/lib/openhut/whatsapp-bridge
RUN mkdir -p /etc/docker && echo '{"runtimes":{"runsc":{"path":"/usr/local/bin/runsc"}}}' > /etc/docker/daemon.json && \
    ln -s /data/log /var/log/openhut && ln -s /run/agentd-etc /etc/agentd
ENV DOCKER_TLS_CERTDIR=
ENTRYPOINT ["/opt/openhut/install/runtime-start.sh"]

FROM ${BASE} AS deps
COPY --from=tree /opt/openhut/package.json /opt/openhut/package-lock.json /opt/openhut/
COPY --from=tree /opt/openhut/packages/runtime/package.json /opt/openhut/packages/runtime/
COPY --from=tree /opt/openhut/packages/common/package.json /opt/openhut/packages/common/
COPY --from=tree /opt/openhut/packages/app/package.json /opt/openhut/packages/app/
RUN cd /opt/openhut && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && \
    chown -R root:root node_modules && chmod -R go-w node_modules

FROM ${BASE} AS runtime
COPY --from=deps /opt/openhut/node_modules /opt/openhut/node_modules
COPY --from=tree /opt/openhut /opt/openhut

FROM $ALPINE AS main
ARG RUNTIME_IMAGE
RUN apk add --no-cache nodejs docker-cli curl su-exec flock util-linux-misc >/dev/null && \
    addgroup -S openhut && adduser -S -D -G openhut openhut
# The seat sign-in runs claude here, on Alpine, so it takes the musl build.
COPY --from=downloads /out/opt/openhut/bin/claude-musl /opt/openhut/bin/claude-musl
COPY --from=downloads /out/usr/local/bin/caddy /usr/local/bin/caddy
COPY --from=deps /opt/openhut/node_modules /opt/openhut/node_modules
COPY --from=tree /opt/openhut /opt/openhut
COPY install/updater.sh /usr/local/lib/openhut-updater.sh
RUN test -n "$RUNTIME_IMAGE" && printf '%s\n' "$RUNTIME_IMAGE" > /opt/openhut/RUNTIME_IMAGE && ln -sf /opt/openhut/install/openhut /usr/local/bin/openhut
ENV OPENHUT_HOST=0.0.0.0 OPENHUT_CLAUDE=/opt/openhut/bin/claude-musl NODE_OPTIONS=--no-node-snapshot
EXPOSE 80 443 8787
ENTRYPOINT ["/opt/openhut/install/main-start.sh"]
