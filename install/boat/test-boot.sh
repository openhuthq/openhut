#!/bin/sh
# C1 in CI: openhut-boot against a local signed feed (test key, stand-in Rekor): first boot, bad signature refused, unhealthy pack
# falls back. On Linux with Docker it also boots snapshot.sh + openhut.service in a systemd container, the fresh-VM stand-in.
exec node --test --test-concurrency=1 "$(dirname "$0")/boot.test.ts"
