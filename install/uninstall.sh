#!/bin/sh
set -u
printf 'This deletes every agent and all OpenHut data. It cannot be undone. Type "uninstall" to go on: '
read -r answer || answer=
[ "$answer" = uninstall ] || { echo 'Nothing removed.'; exit 1; }
D=docker; docker info >/dev/null 2>&1 || D="sudo docker"
$D rm -f openhut openhut-previous >/dev/null 2>&1
$D volume rm openhut openhut-data >/dev/null 2>&1
echo 'OpenHut is removed. Docker stays installed.'
