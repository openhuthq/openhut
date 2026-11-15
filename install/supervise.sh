#!/bin/sh
log=$1; shift
while :; do "$@" >> "$log" 2>&1; sleep 2; done
