#!/bin/sh
# supervise.sh LOG CMD...: run CMD again whenever it exits, like systemd's Restart=always. Used by host-start.sh.
log=$1; shift
while :; do "$@" >> "$log" 2>&1; sleep 2; done
