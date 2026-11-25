#!/bin/sh
# shellcheck disable=SC2016,SC2034,SC2048
# install/swap.sh against a real Docker: swap.test.sh [1 2 3 4] (all by default). Uses containers swt-*, port 18080.
#  1 nginx:1.27 -> 1.28 with an HTTP check keeps the volume, port, env, labels, tmpfs and restart policy
#  2 a new image that exits rolls back: the old one serves again, labeled openhut.failed-digest
#  3 a second swap of the same container while one runs is refused by the lock
#  4 swap.sh run from inside the container it replaces (through the socket, from the new image) replaces it
#  5 a container started with install.sh's openhut flags comes back with the identical HostConfig
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
swap=$here/swap.sh
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
img() { docker container inspect -f '{{.Config.Image}}' "$1" 2>/dev/null; }
label() { docker container inspect -f "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }
get() { curl -fsS --max-time 3 http://127.0.0.1:18080/ 2>/dev/null; }
clean() { docker rm -f swt-web swt-web-previous swt-web-swap-lock swt-self swt-self-previous swt-self-swap-lock >/dev/null 2>&1 || true; }
web() {
  clean
  docker volume rm -f swt-data >/dev/null 2>&1; docker pull -q nginx:1.27 >/dev/null
  docker run --rm -v swt-data:/d busybox:1.36 sh -c 'echo kept-data > /d/index.html' >/dev/null
  docker run -d --name swt-web -p 127.0.0.1:18080:80 -v swt-data:/usr/share/nginx/html:ro --restart unless-stopped \
    --read-only --tmpfs /var/cache/nginx --tmpfs /var/run -e 'GREETING=hello world' --label swt.keep=yes nginx:1.27 >/dev/null
  i=0; until get >/dev/null || [ $i -ge 20 ]; do sleep 1; i=$((i + 1)); done
}
docker pull -q nginx:1.27 >/dev/null; docker pull -q nginx:1.28 >/dev/null; docker pull -q busybox:1.36 >/dev/null

s1() {
  echo "== 1: nginx:1.27 -> nginx:1.28, HTTP health check"
  web
  docker inspect -f 'before: {{.Config.Image}} {{.HostConfig.PortBindings}} {{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Tmpfs}}' swt-web
  echo "\$ swap.sh swt-web nginx:1.28 http://127.0.0.1/"
  sh "$swap" swt-web nginx:1.28 http://127.0.0.1/; code=$?
  docker inspect -f 'after:  {{.Config.Image}} {{.HostConfig.PortBindings}} {{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Tmpfs}}' swt-web
  ok "exit 0" '[ $code = 0 ]'
  ok "runs nginx:1.28" '[ "$(img swt-web)" = nginx:1.28 ]'
  ok "serves the volume's data on the same port" '[ "$(get)" = kept-data ]'
  ok "keeps env, label, read-only, restart policy" \
    'docker inspect -f "{{range .Config.Env}}{{.}};{{end}}" swt-web | grep -q "GREETING=hello world" &&
     [ "$(label swt-web swt.keep)" = yes ] && [ "$(docker inspect -f "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.RestartPolicy.Name}}" swt-web)" = "true unless-stopped" ]'
  ok "takes the new image's own env (NGINX_VERSION)" 'docker inspect -f "{{range .Config.Env}}{{.}};{{end}}" swt-web | grep -q "NGINX_VERSION=1.28"'
  ok "previous container and lock are gone" '! docker container inspect swt-web-previous swt-web-swap-lock >/dev/null 2>&1'
}

s2() {
  echo "== 2: a new image that exits rolls back"
  web
  bad=$(docker image inspect -f '{{index .RepoDigests 0}}' busybox:1.36)
  echo "\$ swap.sh swt-web $bad http://127.0.0.1/"
  out=$(sh "$swap" swt-web "$bad" http://127.0.0.1/ 2>&1); code=$?
  echo "$out"
  ok "exit non-zero with one line" '[ $code != 0 ] && [ "$(echo "$out" | wc -l)" -eq 1 ]'
  ok "old image runs again" '[ "$(img swt-web)" = nginx:1.27 ]'
  i=0; until get >/dev/null || [ $i -ge 20 ]; do sleep 1; i=$((i + 1)); done
  ok "old one serves the volume's data again" '[ "$(get)" = kept-data ]'
  ok "labeled openhut.failed-digest=${bad#*@}" '[ "$(label swt-web openhut.failed-digest)" = "${bad#*@}" ]'
  ok "keeps its own label" '[ "$(label swt-web swt.keep)" = yes ]'
  ok "previous container and lock are gone" '! docker container inspect swt-web-previous swt-web-swap-lock >/dev/null 2>&1'
  echo "\$ swap.sh swt-web nginx:1.28 http://127.0.0.1/   (a later good swap drops the failure mark)"
  sh "$swap" swt-web nginx:1.28 http://127.0.0.1/
  ok "no failed-digest label after a good swap" '[ -z "$(label swt-web openhut.failed-digest)" ]'
}

s3() {
  echo "== 3: a concurrent swap is refused"
  web
  echo "\$ swap.sh swt-web nginx:1.28 'sleep 8' &"
  sh "$swap" swt-web nginx:1.28 'sleep 8' & first=$!
  sleep 3
  echo "\$ swap.sh swt-web nginx:1.28 http://127.0.0.1/"
  out=$(sh "$swap" swt-web nginx:1.28 http://127.0.0.1/ 2>&1); code=$?
  echo "$out"
  wait $first; firstcode=$?
  ok "second swap refused" '[ $code != 0 ] && echo "$out" | grep -q "another swap of swt-web is running"'
  ok "first swap finished" '[ $firstcode = 0 ] && [ "$(img swt-web)" = nginx:1.28 ] && [ "$(get)" = kept-data ]'
  ok "lock released" '! docker container inspect swt-web-swap-lock >/dev/null 2>&1'
}

s4() {
  echo "== 4: swap.sh run from inside the container it replaces"
  clean
  for v in a b; do
    printf 'FROM docker:27-cli\nCOPY swap.sh /swap.sh\nRUN touch /%s\n' $v | docker build -q -t swt-self:$v -f - "$here" >/dev/null
  done
  docker run -d --name swt-self --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock swt-self:a sleep infinity >/dev/null
  echo "\$ docker exec swt-self docker run -d --rm -v /var/run/docker.sock:/var/run/docker.sock --entrypoint /bin/sh swt-self:b /swap.sh swt-self swt-self:b 'docker exec \"\$CONTAINER\" test -f /b'"
  docker exec swt-self docker run -d --rm -v /var/run/docker.sock:/var/run/docker.sock --entrypoint /bin/sh swt-self:b \
    /swap.sh swt-self swt-self:b 'docker exec "$CONTAINER" test -f /b'
  i=0; until { [ "$(img swt-self)" = swt-self:b ] && ! docker container inspect swt-self-previous swt-self-swap-lock >/dev/null 2>&1; } || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
  docker inspect -f 'after: {{.Name}} {{.Config.Image}} {{.State.Status}} cmd={{.Config.Cmd}} binds={{.HostConfig.Binds}}' swt-self
  ok "swt-self runs swt-self:b" '[ "$(img swt-self)" = swt-self:b ] && docker exec swt-self test -f /b'
  ok "keeps its command and the socket" '[ "$(docker inspect -f "{{.Config.Cmd}} {{range .Mounts}}{{.Source}}{{end}}" swt-self)" = "[sleep infinity] /var/run/docker.sock" ]'
  ok "previous container and lock are gone" '! docker container inspect swt-self-previous swt-self-swap-lock >/dev/null 2>&1'
}

s5() {
  echo "== 5: install.sh's openhut flags come back with the identical HostConfig"
  clean; docker volume rm -f swt-v1 swt-v2 >/dev/null 2>&1
  docker run -d --name swt-web --hostname openhut --label dev.openhut.build=1 --restart unless-stopped --privileged --read-only \
    --tmpfs /run:size=256m --tmpfs /tmp:size=1g --tmpfs /var/cache/nginx -v swt-v1:/var/lib/x -v swt-v2:/data \
    -p 127.0.0.1:18080:80 --log-opt max-size=10m --log-opt max-file=3 --cap-drop ALL --cap-add CHOWN --cap-add SETUID \
    --cap-add SETGID --cap-add NET_BIND_SERVICE --security-opt no-new-privileges --init --add-host foo:1.2.3.4 nginx:1.27 >/dev/null
  f='{{json .HostConfig}} {{.Config.Hostname}} {{json .Config.Labels}}{{range .Mounts}}{{"\n"}}{{.Name}}:{{.Destination}}{{end}}'
  conf() { docker inspect -f "$f" swt-web | sed 's/"Binds":\[[^]]*\],//' | sort; }
  before=$(conf)
  echo "\$ swap.sh swt-web nginx:1.28 http://127.0.0.1/"
  sh "$swap" swt-web nginx:1.28 http://127.0.0.1/
  after=$(conf)
  echo "$after" | cut -c1-300
  ok "same HostConfig, hostname, labels and volumes (mount order aside)" '[ "$before" = "$after" ]'
  clean; docker volume rm -f swt-v1 swt-v2 >/dev/null 2>&1
}

for s in ${*:-1 2 3 4 5}; do "s$s"; echo; done
clean; docker volume rm -f swt-data >/dev/null 2>&1; docker image rm swt-self:a swt-self:b >/dev/null 2>&1
echo "failures: $fails"
[ $fails = 0 ]
