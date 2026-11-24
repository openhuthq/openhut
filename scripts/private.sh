#!/bin/sh
[ -d .git ] || [ -f .git ] || exit 0
[ -e private/.git ] || GIT_TERMINAL_PROMPT=0 git submodule update --init private >/dev/null 2>&1 || exit 0
[ -f private/site/package.json ] || exit 0
git config push.recurseSubmodules on-demand
[ "$(git -C private rev-parse HEAD)" = "$(git -C private rev-parse -q --verify main)" ] && git -C private switch -q main
npm --prefix private/site install --no-audit --no-fund --silent
[ ! -f private/api/package.json ] || npm --prefix private/api install --no-audit --no-fund --silent
