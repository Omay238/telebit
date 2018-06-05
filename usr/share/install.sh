#!/bin/bash
#<pre><code>

# This script does exactly 3 things for 1 good reason:
#
# What this does:
#
#   1. Detects either curl or wget and wraps them in helpers
#   2. Exports the helpers for the real installer
#   3. Downloads and runs the real installer
#
# Why
#
#   1. 'curl <smth> | bash -- some args here` breaks interactive input
#       See https://stackoverflow.com/questions/16854041/bash-read-is-being-skipped-when-run-from-curl-pipe
#
#   2.  It also has practical risks of running a partially downloaded script, which could be dangeresque
#       See https://news.ycombinator.com/item?id=12767636

set -e
set -u

###############################
#                             #
#         http_get            #
# boilerplate for curl / wget #
#                             #
###############################

# See https://git.coolaj86.com/coolaj86/snippets/blob/master/bash/http-get.sh

export _my_http_get=""
export _my_http_opts=""
export _my_http_out=""

detect_http_get()
{
  set +e
  if type -p curl >/dev/null 2>&1; then
    _my_http_get="curl"
    _my_http_opts="-fsSL"
    _my_http_out="-o"
  elif type -p wget >/dev/null 2>&1; then
    _my_http_get="wget"
    _my_http_opts="--quiet"
    _my_http_out="-O"
  else
    echo "Aborted, could not find curl or wget"
    return 7
  fi
  set -e
}

http_get()
{
  $_my_http_get $_my_http_opts $_my_http_out "$2" "$1"
  touch "$2"
}

http_bash()
{
  _http_url=$1
  my_args=${2:-}
  rm -rf my-tmp-runner.sh
  $_my_http_get $_my_http_opts $_my_http_out my-tmp-runner.sh "$_http_url"; bash my-tmp-runner.sh $my_args; rm my-tmp-runner.sh
}

detect_http_get
export -f http_get
export -f http_bash

###############################
##       END HTTP_GET        ##
###############################

my_branch=master
if [ -e "usr/share/install_helper.sh" ]; then
  bash usr/share/install_helper.sh "$@"
else
  http_bash https://git.coolaj86.com/coolaj86/telebit.js/raw/branch/$my_branch/usr/share/install_helper.sh "$@"
fi
