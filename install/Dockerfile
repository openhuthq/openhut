# syntax=docker/dockerfile:1.7
ARG AGENT_IMAGE
ARG ALPINE=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
ARG DIND=docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac

FROM --platform=$BUILDPLATFORM $ALPINE AS tree
RUN --mount=type=bind,source=openhut.tgz,target=/tmp/openhut.tgz mkdir -p /opt/openhut && \
    tar -xzf /tmp/openhut.tgz -C /opt/openhut && chown -R root:root /opt/openhut && chmod -R go-w /opt/openhut

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
RUN apk add --no-cache nodejs npm iptables ip6tables iproute2 curl zstd tar su-exec flock >/dev/null && \
    addgroup -S openhut && adduser -S -D -G openhut openhut

FROM base AS downloads
ARG TARGETARCH
ARG GVISOR=20261109.0
ARG GVISOR_SHA512_amd64=0a0041fd862f4ea3042a9db8d41c742f48a01f909699adc2a0256e46d85e53f97b82b9fd154b3dce636f62b8d557677639f91c77d13f3f875ff9fa535275393c
ARG GVISOR_SHA512_arm64=a0b5d911512ef5fe70e833821e653a90c4d06c7027246ee49423f1d2fe2b2a509389a637797248958b90e49a069bb079ecde860efe1871b1d980ec0fe17e18ac
ARG CLAUDE=2.1.311
ARG CLAUDE_SHA256_amd64=86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada
ARG CLAUDE_SHA256_arm64=2e2496c9a8065df93acb0fca2d341f59a6b8777649b2e025ab8c9bcd5eef61f3
ARG AGENT_BROWSER=0.43.0
ARG AGENT_BROWSER_SHA512_amd64=598f2fcb649a6b7a11b7a5c49b3e1269ed56e6a4bd4e361c6d7e8813e7716fcb3600f7cbf57c908cc1c2ea3059ae1c2a0c122f51e4cc093fcfd9cab75cb3d207
ARG AGENT_BROWSER_SHA512_arm64=f030b6df82c69570a7f00d985c693ac28cb5b938f27b1bed1ddfd33901cbad5dac7d43190fae3b1d31c427217edb3d49d68477e0b681e63a8727d7744440be0b
COPY --from=tree /opt/openhut/install/native-runtime.json /tmp/native-runtime.json
RUN set -eu; grep -q "\"version\": \"$CLAUDE\"" /tmp/native-runtime.json || { echo "Claude Code $CLAUDE isn't native-runtime.json's version" >&2; exit 1; }
RUN <<EOF
set -eu
case "$TARGETARCH" in amd64) A=x86_64 N=x64 ;; arm64) A=aarch64 N=arm64 ;; *) exit 1 ;; esac
eval "G=\$GVISOR_SHA512_$TARGETARCH C=\$CLAUDE_SHA256_$TARGETARCH B=\$AGENT_BROWSER_SHA512_$TARGETARCH"
fetch() { curl -fsSL --retry 4 --retry-all-errors "$1" -o "$2"; }
fetch "https://storage.googleapis.com/gvisor/releases/release/$GVISOR/$A/gvisor.tar.zstd" /tmp/gvisor.tar.zstd
printf '%s  %s\n' "$G" /tmp/gvisor.tar.zstd | sha512sum -c - >/dev/null
mkdir -p /out/usr/local/bin /out/opt/openhut/bin && tar --zstd -xf /tmp/gvisor.tar.zstd -C /out/usr/local/bin --no-same-owner
fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$N/claude" /out/opt/openhut/bin/claude
printf '%s  %s\n' "$C" /out/opt/openhut/bin/claude | sha256sum -c - >/dev/null
fetch "https://registry.npmjs.org/@agent-browser/cli-linux-$N-gnu/-/cli-linux-$N-gnu-$AGENT_BROWSER.tgz" /tmp/agent-browser.tgz
printf '%s  %s\n' "$B" /tmp/agent-browser.tgz | sha512sum -c - >/dev/null
tar -xzf /tmp/agent-browser.tgz -C /tmp package/bin/agent-browser && mv /tmp/package/bin/agent-browser /out/opt/openhut/bin/agent-browser
chown -R root:root /out && chmod 0755 /out/opt/openhut/bin/* /out/usr/local/bin/*
EOF

FROM base AS deps
COPY --from=tree /opt/openhut/package.json /opt/openhut/package-lock.json /opt/openhut/
COPY --from=tree /opt/openhut/packages/runtime/package.json /opt/openhut/packages/runtime/
COPY --from=tree /opt/openhut/packages/common/package.json /opt/openhut/packages/common/
COPY --from=tree /opt/openhut/packages/app/package.json /opt/openhut/packages/app/
COPY --from=tree /opt/openhut/packages/desktop/package.json /opt/openhut/packages/desktop/
COPY --from=tree /opt/openhut/packages/e2e/package.json /opt/openhut/packages/e2e/
COPY --from=tree /opt/openhut/packages/docs/package.json /opt/openhut/packages/docs/
COPY --from=tree /opt/openhut/packages/phone/package.json /opt/openhut/packages/phone/
RUN cd /opt/openhut && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && \
    chown -R root:root node_modules && chmod -R go-w node_modules

FROM base
COPY --from=downloads /out/ /
COPY --from=agent /agent.tar.zst /image /opt/openhut-agent/
COPY --from=bridge /bridge /var/lib/openhut/whatsapp-bridge
COPY --from=deps /opt/openhut/node_modules /opt/openhut/node_modules
COPY --from=tree /opt/openhut /opt/openhut
RUN mkdir -p /etc/docker && echo '{"runtimes":{"runsc":{"path":"/usr/local/bin/runsc"}}}' > /etc/docker/daemon.json && \
    ln -s /data/etc /etc/openhut && ln -s /data/log /var/log/openhut && ln -s /run/agentd-etc /etc/agentd
ENV OPENHUT_HOST=0.0.0.0 OPENHUT_RUNTIME=image DOCKER_TLS_CERTDIR=
EXPOSE 8787
ENTRYPOINT ["/opt/openhut/install/image-start.sh"]
