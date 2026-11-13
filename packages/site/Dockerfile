FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
COPY packages/site packages/site
RUN node packages/site/src/build.ts

FROM caddy:2.10-alpine
COPY packages/site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/site/dist /srv/site
COPY dist/install.sh dist/fastmonkey.tgz /srv/release/
EXPOSE 80
