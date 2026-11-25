#!/bin/sh
# Replace a running container with the same container on a new image, and roll back if the new one is unhealthy.
#
#   swap.sh <container> <image[@digest]> <health-check>
#
# <health-check> is either an http(s) URL, fetched from inside the new container (wget or curl) until it answers 2xx
# within 90 s, or a shell command run here with $CONTAINER set to the container name, until it exits 0 within 60 s
# (e.g. 'docker exec "$CONTAINER" test -f /run/ready'). SWAP_TIMEOUT overrides the limit; SWAP_PRUNE=0 keeps the old image.
#
# On success the old container and its image are removed. On failure the new container is removed, the old one is
# recreated from its own image and config with the label openhut.failed-digest=<digest> (so callers skip that digest),
# and the script exits 1 with a one-line reason. A swap that dies halfway is repaired by the next swap of that container.
#
# Run it from the NEW image as its own container, so it survives replacing the container that asked for it:
#   docker run -d --rm -v /var/run/docker.sock:/var/run/docker.sock --entrypoint /bin/sh <image@digest> \
#     /path/to/swap.sh <container> <image@digest> <health-check>
#
# Copied: image, env, labels, mounts (binds, named and anonymous volumes, tmpfs), ports, networks, restart policy,
# privileged, runtime, init, read-only, user, hostname, entrypoint/cmd, caps, security opts, devices, extra hosts, logging.
# Env, labels, user, entrypoint and cmd are copied only where the container differs from its image, so the new image's
# own defaults win. ponytail: not copied: resource limits, ulimits, dns, ip/aliases, pid/ipc mode, stop signal; add here
# when a container we swap uses one. Values containing a newline, and empty command arguments, are not supported.
set -eu
[ $# -eq 3 ] || { echo "usage: swap.sh <container> <image[@digest]> <health-check>" >&2; exit 2; }
name=$1 new=$2 health=$3
prev=$name-previous lock=$name-swap-lock digest=${2#*@}
say() { echo "swap $name: $*" >&2; }
fail() { say "$*"; exit 1; }
exists() { docker container inspect "$1" >/dev/null 2>&1; }

docker image inspect "$new" >/dev/null 2>&1 || docker pull -q "$new" >/dev/null || fail "could not pull $new"

# Lock: container names are unique, so only one swap per container can create this one. It removes itself after 15 min
# if the swap holding it was killed.
if ! docker run -d --rm --name "$lock" --label "openhut.swap-lock=$name" --entrypoint sleep "$new" 900 >/dev/null 2>&1; then
  exists "$lock" && fail "another swap of $name is running"
  fail "could not take the swap lock (no sleep in $new?)"
fi
tmp=$(mktemp -d)
trap 'docker rm -f "$lock" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM HUP

# Repair a swap that died halfway: the container was renamed away but nothing replaced it.
if ! exists "$name" && exists "$prev"; then say "restoring $prev"; docker rename "$prev" "$name"; docker start "$name" >/dev/null; fi
exists "$name" || fail "no container named $name"
docker rm -f "$prev" >/dev/null 2>&1 || true

# Record the old container's run config: one docker-run argument per line.
c() { docker container inspect -f "$1" "$name"; }
old=$(c '{{.Image}}') oldref=$(c '{{.Config.Image}}')
[ "$(docker image inspect -f '{{.Id}}' "$oldref" 2>/dev/null)" = "$old" ] || oldref=$old
o() { docker image inspect -f "$1" "$old"; }
nl='{{"\n"}}'
c "{{with .HostConfig}}--restart={{.RestartPolicy.Name}}{{with .RestartPolicy.MaximumRetryCount}}:{{.}}{{end}}$nl\
--network={{.NetworkMode}}$nl\
{{if .Privileged}}--privileged$nl{{end}}{{if .ReadonlyRootfs}}--read-only$nl{{end}}{{if .PublishAllPorts}}-P$nl{{end}}\
{{if index . \"Init\"}}--init$nl{{end}}{{with .Runtime}}--runtime={{.}}$nl{{end}}\
{{range .CapAdd}}--cap-add={{.}}$nl{{end}}{{range .CapDrop}}--cap-drop={{.}}$nl{{end}}\
{{range .SecurityOpt}}--security-opt={{.}}$nl{{end}}{{range .ExtraHosts}}--add-host={{.}}$nl{{end}}\
{{range .Devices}}--device={{.PathOnHost}}:{{.PathInContainer}}:{{.CgroupPermissions}}$nl{{end}}\
{{range \$k, \$v := index . \"Tmpfs\"}}--tmpfs={{\$k}}{{with \$v}}:{{.}}{{end}}$nl{{end}}\
{{with .LogConfig}}--log-driver={{.Type}}$nl{{range \$k, \$v := .Config}}--log-opt={{\$k}}={{\$v}}$nl{{end}}{{end}}\
{{range \$p, \$b := .PortBindings}}{{range \$b}}-p={{if .HostIp}}{{.HostIp}}:{{.HostPort}}:{{else if .HostPort}}{{.HostPort}}:{{end}}{{\$p}}$nl{{end}}{{end}}\
{{end}}\
{{range .Mounts}}{{if eq .Type \"bind\"}}-v={{.Source}}{{else if eq .Type \"volume\"}}-v={{.Name}}{{end}}\
{{if or (eq .Type \"bind\") (eq .Type \"volume\")}}:{{.Destination}}{{if not .RW}}:ro{{end}}$nl{{end}}{{end}}\
{{if and (ne .HostConfig.NetworkMode \"host\") (ne .Config.Hostname (slice .Id 0 12))}}--hostname={{.Config.Hostname}}$nl{{end}}" > "$tmp/opts"
# Env and labels the container added on top of its image (and not a previous swap's failure mark).
# shellcheck disable=SC2016
env='{{range .Config.Env}}{{.}}'$nl'{{end}}' labels='{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}'$nl'{{end}}'
o "$env" > "$tmp/ienv"; o "$labels" > "$tmp/ilab"
c "$env" | grep -vxF -f "$tmp/ienv" | sed 's/^/--env=/' >> "$tmp/opts" || true
c "$labels" | grep -v '^openhut\.failed-digest=' | grep -vxF -f "$tmp/ilab" | sed 's/^/--label=/' >> "$tmp/opts" || true
[ "$(c '{{.Config.User}}')" = "$(o '{{.Config.User}}')" ] || echo "--user=$(c '{{.Config.User}}')" >> "$tmp/opts"
: > "$tmp/cmd"
if [ "$(c '{{json .Config.Entrypoint}}')" != "$(o '{{json .Config.Entrypoint}}')" ]; then
  c "--entrypoint={{range \$i, \$a := .Config.Entrypoint}}{{if eq \$i 0}}{{\$a}}{{end}}{{end}}" >> "$tmp/opts"
  c "{{range \$i, \$a := .Config.Entrypoint}}{{if ne \$i 0}}{{\$a}}$nl{{end}}{{end}}{{range .Config.Cmd}}{{.}}$nl{{end}}" > "$tmp/cmd"
elif [ "$(c '{{json .Config.Cmd}}')" != "$(o '{{json .Config.Cmd}}')" ]; then
  c "{{range .Config.Cmd}}{{.}}$nl{{end}}" > "$tmp/cmd"
fi
for f in opts cmd; do grep -v '^$' "$tmp/$f" > "$tmp/x" || true; mv "$tmp/x" "$tmp/$f"; done
nets=$(c "{{range \$n, \$_ := .NetworkSettings.Networks}}{{if ne \$n \$.HostConfig.NetworkMode}}{{\$n}} {{end}}{{end}}")

# start <image> [extra docker-run options]: create and start $name from the recorded config.
start() {
  img=$1; shift
  while IFS= read -r a; do set -- "$@" "$a"; done < "$tmp/opts"
  set -- "$@" "$img"
  while IFS= read -r a; do set -- "$@" "$a"; done < "$tmp/cmd"
  docker create --name "$name" "$@" >/dev/null || return 1
  for n in $nets; do docker network connect "$n" "$name" || return 1; done
  docker start "$name" >/dev/null
}

rollback() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if start "$oldref" --label "openhut.failed-digest=$digest"; then docker rm "$prev" >/dev/null
  else docker rm -f "$name" >/dev/null 2>&1 || true; docker rename "$prev" "$name"; docker start "$name" >/dev/null; fi
  fail "rolled back from $new: $*"
}

docker rename "$name" "$prev"
docker stop "$prev" >/dev/null || { docker rename "$prev" "$name"; fail "could not stop the old container"; }
start "$new" || rollback "the new container did not start"

case $health in
  http://*|https://*) limit=${SWAP_TIMEOUT:-90}
    check() { docker exec "$name" sh -c 'wget -q -O /dev/null "$1" || curl -fsS -o /dev/null "$1"' - "$health"; } ;;
  *) limit=${SWAP_TIMEOUT:-60}
    check() { CONTAINER=$name sh -c "$health"; } ;;
esac
waited=0
until check >/dev/null 2>&1; do
  state=$(docker container inspect -f '{{.State.Status}} {{.RestartCount}}' "$name" 2>/dev/null || echo 'gone 0')
  case $state in exited*|dead*|gone*) rollback "the new container is ${state% *}" ;; esac
  [ "${state#* }" = 0 ] || rollback "the new container keeps restarting"
  [ "$waited" -lt "$limit" ] || rollback "health check failed for ${limit}s"
  sleep 2; waited=$((waited + 2))
done

docker rm "$prev" >/dev/null
[ "${SWAP_PRUNE:-1}" = 0 ] || [ "$old" = "$(c '{{.Image}}')" ] || docker image rm "$old" >/dev/null 2>&1 || true
say "now on $new"
