# Deploying OpenHut

## openhut.dev (the installer site)
- Pushing to `main` runs `.github/workflows/deploy.yml`: typecheck and unit tests, then `scripts/release.sh` and
  `npm -w @openhut/site run deploy`, then a check that openhut.dev serves an `install.sh` whose checksum matches
  the tarball it serves. Rerun it by hand with `gh workflow run deploy.yml`.
- The repo secret `CLOUDFLARE_API_TOKEN` is the account token "openhut-site GitHub Actions deploy": Workers Scripts
  write and Account Settings read on the moabuaboud@gmail.com account, Workers Routes write on openhut.dev only.
- DNS for openhut.dev and www is managed by the Worker's custom domains; the zone holds no other records. Wrangler's
  OAuth login can deploy but can't edit DNS, so a record in the way has to be deleted in the dashboard. It can delete a Worker's custom domains, though: `DELETE /accounts/<id>/workers/domains/<id>` with the `oauth_token` from wrangler's config (how fastmonkey.dev was taken down, 2026-11-15).

## monkey.activepieces.dev (the internal instance)
- Hetzner server `hermes-agents` (project MISC, Helsinki, CPX42, Ubuntu 26.04). Its only firewall,
  `hermes-tailnet-only`, allows inbound ICMP and nothing else, so everything, SSH included, goes over Tailscale
  (activepieces.com tailnet, machine `hermes-agents`, 100.104.248.107, key expiry disabled so it never drops off). SSH
  takes keys only.
- `monkey.activepieces.dev` is a DNS-only A record (Ash's Cloudflare account) to the tailnet address, so the name only
  works on the tailnet. Browsers force HTTPS on every `.dev` name (HSTS preload), so plain :8787 can't be used there.
- HTTPS: Caddy (apt) listens only on the tailnet address :443 and proxies to 127.0.0.1:8787; the app trusts its
  `X-Forwarded-*`. The certificate is Let's Encrypt over DNS-01 (certbot + python3-certbot-dns-cloudflare, no email),
  renewed by `certbot.timer`; `/etc/letsencrypt/renewal-hooks/deploy/caddy.sh` copies it to `/etc/caddy/tls` and
  reloads Caddy. The token in `/root/.secrets/cloudflare.ini` (0600) is the account token "hermes-agents certbot":
  DNS write on activepieces.dev only, and only from the server's IPs (2.29.192.61, 2a01:4f9:c012:c2a4::/64), so it's
  useless anywhere else. A systemd drop-in starts Caddy after tailscaled.
- Installed with the public command (`curl -fsSL https://openhut.dev | sh` as root over Tailscale SSH); upgrading is
  the same command.
- It still runs the Fast Monkey install (`/opt/fastmonkey`, `fastmonkey*.service`). The OpenHut installer uses new paths and unit names, so move it with uninstall plus a fresh install, not an upgrade.
