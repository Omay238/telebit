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
    echo "Failed to find 'curl' or 'wget' to download setup files."
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
  local _http_bash_url=$1
  local _http_bash_args=${2:-}
  local _http_bash_tmp=$(mktemp)
  $_my_http_get $_my_http_opts $_my_http_out "$_http_bash_tmp" "$_http_bash_url"
  bash "$_http_bash_tmp" $_http_bash_args; rm "$_http_bash_tmp"
}

detect_http_get
export -f http_get
export -f http_bash

###############################
##       END HTTP_GET        ##
###############################

# Priority
#darwin-x64			tar.gz                    28-May-2019 21:25            17630540
#linux-arm64		tar.gz                   28-May-2019 21:14            20114146
#linux-armv6l		tar.gz                  28-May-2019 21:19            19029391
#linux-armv7l		tar.gz                  28-May-2019 21:22            18890540
#linux-x64			tar.gz                     28-May-2019 21:36            20149492
#win-x64				zip                          28-May-2019 22:08            17455164
#win-x86				zip                          28-May-2019 21:57            15957629

# TODO
#aix-ppc64			tar.gz                     28-May-2019 21:45            24489408
#linux-ppc64le	tar.gz                 28-May-2019 21:18            20348655
#linux-s390x		tar.gz                   28-May-2019 21:19            20425501
#sunos-x64			tar.gz                     28-May-2019 21:19            21382759
#... cygwin?

# Extra
#x64						msi                              28-May-2019 22:09            18186240
#x86						msi                              28-May-2019 21:57            16601088
#(darwin)				pkg                                  28-May-2019 21:22            17869062

###############################
##    PLATFORM DETECTION     ##
###############################

echo "Detecting your system..."
sleep 0.5
echo ""

# OSTYPE https://stackoverflow.com/a/8597411/151312

my_os=''
my_os_friendly=''
my_arch=''
my_arch_friendly=''
if [ "$(uname | grep -i 'Darwin')" ]; then
  #OSX_VER="$(sw_vers | grep ProductVersion | cut -d':' -f2 | cut -f2)"
  #OSX_MAJOR="$(echo ${OSX_VER} | cut -d'.' -f1)"
	my_os='darwin'
	my_os_friendly='MacOS'
  #if [ -n "$(sysctl hw | grep 64bit | grep ': 1')" ]; then
  #  my_arch="amd64"
  #fi
  my_unarchiver="tar"
elif [ "$(uname | grep -i 'MING')" ] || [[ "$OSTYPE" == "msys" ]]; then
	my_os='windows'
  # although it's not quite our market, many people don't know if they have "microsoft" OR "windows"
	my_os_friendly='Microsoft Windows'
  my_unarchiver="unzip"
elif [ "$(uname | grep -i 'Linux')" ] || [[ "$OSTYPE" == "linux-gnu" ]]; then
	my_os='linux'
	my_os_friendly='Linux'
	# Find out which linux... but there are too many
	#cat /etc/issue
  my_unarchiver="tar"
else
	>&2 echo "You don't appear to be on Mac (darwin), Linux, or Windows (mingw32)."
	>&2 echo "Help us support your platform by filing an issue:"
	>&2 echo "		https://git.rootprojects.org/root/telebit.js/issues"
	exit 1
fi

export _my_unarchiver=""
export _my_unarchive_opts=""
export _my_unarchive_out=""
export archive_ext=""

detect_unarchiver()
{
  set +e
  if type -p "$my_unarchiver" >/dev/null 2>&1; then
    if [ "tar" == "$my_unarchiver" ]; then
      _my_unarchiver="tar"
      _my_unarchive_opts="-xf"
      _my_unarchive_out="-C"
      archive_ext="tar.gz"
    elif [ "unzip" == "$my_unarchiver" ]; then
      _my_unarchiver="unzip"
      _my_unarchive_opts="-qq"
      _my_unarchive_out="-d"
      archive_ext="zip"
    else
      # TODO ping bug report url
      echo "Developer error: '$my_unarchiver' isn't a supported. The developer made a typo."
      return 20
    fi
  else
    echo "Failed to find '$my_unarchiver' which is needed to unpack downloaded files."
    return 21
  fi
  set -e
}

unarchiver()
{
  $_my_unarchiver $_my_unarchive_opts "$1" $_my_unarchive_out "$2"
}

detect_unarchiver
export -f unarchiver


if [ "$(uname -m | grep -i 'ARM')" ]; then
	if [ "$(uname -m | grep -i 'v5')" ]; then
		my_arch="armv5"
	elif [ "$(uname -m | grep -i 'v6')" ]; then
		my_arch="armv6"
	elif [ "$(uname -m | grep -i 'v7')" ]; then
		my_arch="armv7"
	elif [ "$(uname -m | grep -i 'v8')" ]; then
		my_arch="armv8"
	elif [ "$(uname -m | grep -i '64')" ]; then
		my_arch="armv8"
	fi
elif [ "$(uname -m | grep -i '86')" ]; then
	if [ "$(uname -m | grep -i '64')" ]; then
		my_arch="amd64"
		my_arch_friendly="64-bit"
	else
		my_arch="386"
		my_arch_friendly="32-bit"
	fi
elif [ "$(uname -m | grep -i '64')" ]; then
	my_arch="amd64"
	my_arch_friendly="64-bit"
else
	>&2 echo "Your CPU doesn't appear to be 386, amd64 (x64), armv6, armv7, or armv8 (arm64)."
	>&2 echo "Help us support your platform by filing an issue:"
	>&2 echo "		https://git.rootprojects.org/root/telebit.js/issues"
fi

export TELEBIT_ARCH="$my_arch"
export TELEBIT_OS="$my_os"
TELEBIT_VERSION=${TELEBIT_VERSION:-stable}
export TELEBIT_RELEASE=${TELEBIT_RELEASE:-$TELEBIT_VERSION}
export TELEBIT_ARCHIVER="$my_unarchiver"

echo "    Operating System:  $my_os_friendly"
echo "    Processor Family:  ${my_arch_friendly:-$my_arch}"
echo "    Download Type:     $archive_ext"
echo "    Release Channel:   $TELEBIT_VERSION"
echo ""
sleep 0.3
#echo "Downloading the Telebit installer for your system..."
#sleep 0.5
#echo ""

#if [ -e "usr/share/install_helper.sh" ]; then
#  bash usr/share/install_helper.sh "$@"
#else
#  http_bash https://git.coolaj86.com/coolaj86/telebit.js/raw/branch/$TELEBIT_VERSION/usr/share/install_helper.sh "$@"
#fi

mkdir -p $HOME/Downloads
my_tmp="$(mktemp -d -t telebit.XXXX)"

http_get "https://rootprojects.org/telebit/dist/index.tab" "$my_tmp/index.tab"
meta=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1)
latest=$(echo "$meta" | cut -f 1)
major=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 2)
size=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 3)
t_sha256=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 4)
t_channel=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 5)
t_os=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 6)
t_arch=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 7)
t_url=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 8)

if [ -z "$t_url" ]; then
  # TODO ping bug report url
  echo "No matching version for '$TELEBIT_RELEASE' for '$TELEBIT_OS' on '$TELEBIT_ARCH'"
  exit 2
fi

my_dir="telebit-$latest-$TELEBIT_OS-$TELEBIT_ARCH"
my_file="$my_dir.$archive_ext"
if [ -f "$HOME/Downloads/$my_file" ]; then
  my_size=$(($(wc -c < "$HOME/Downloads/$my_file")))
  if [ "$my_size" -eq "$size" ]; then
    echo "~/Downloads/$my_file exists, skipping download"
    sleep 0.5
  else
    echo "Removing incomplete download '~/Downloads/$my_file'"
    # change into $HOME because we don't ever want to perform
    # a destructive action on a variable we didn't set
    pushd "$HOME" > /dev/null
      rm -f "Downloads/$my_file"
    popd > /dev/null
  fi
fi

if [ ! -f "$HOME/Downloads/$my_file" ]; then
  #echo "Downloading from https://rootprojects.org/telebit/dist/$major/$my_file ..."
  echo "Downloading from $t_url ..."
  sleep 0.3
  #http_get "https://rootprojects.org/telebit/dist/$major/$my_file" "$HOME/Downloads/$my_file"
  http_get "$t_url" "$HOME/Downloads/$my_file"
  echo "Saved to '$HOME/Downloads/$my_file' ..."
  echo ""
  sleep 0.3
fi

echo "Unpacking and installing Telebit ..."
echo ""
unarchiver "$HOME/Downloads/$my_file" "$my_tmp"
# because unzip can't strip a prfeix
pushd "$my_tmp" > /dev/null
  if [ -d ./telebit-* ]; then
      mv ./telebit-*/* "./"
      rm -rf ./telebit-*
  fi
popd > /dev/null
echo "Extracted '$my_file' to '$my_tmp'"

# On linux npm is a javascript file, but on Windows (Git Bash) it's both sh and cmd,
# so we need to make sure *this* node is first in the path for this script
OLD_PATH="$PATH"
export PATH="$my_tmp/bin/:$OLD_PATH"

# make sure that telebit is not in use
pushd "$my_tmp" > /dev/null
  ./bin/npm --scripts-prepend-node-path=true run preinstall
popd > /dev/null

# move only once there are not likely to be any open files
# (especially important on windows)
pushd "$HOME" > /dev/null
  if [ -e ".local/opt/telebit" ]; then
    mv ".local/opt/telebit" ".local/opt/telebit-old-$(date "+%s")"
  fi
  mv "$my_tmp" ".local/opt/telebit"
popd > /dev/null

# On linux npm is a javascript file, but on Windows (Git Bash) it's both sh and cmd,
# so we need to make sure *this* node is first in the path for this script
export PATH="$HOME/.local/opt/telebit/bin/:$OLD_PATH"

# make sure that telebit is not in use
pushd "$HOME/.local/opt/telebit" > /dev/null
  if [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]]; then
    ./node_modules/.bin/pathman add '%USERPROFILE%\.local\opt\telebit\bin-public' > /dev/null &
    sleep 0.1 # workaround for pathman not exiting as it should on Windows
  else
    ./node_modules/.bin/pathman add "$HOME/.local/opt/telebit/bin-public" > /dev/null
  fi
  ./bin/npm --scripts-prepend-node-path=true run postinstall
popd > /dev/null

echo ""
echo ""
echo ""
echo "Open a new terminal and run the following:"
echo ""
printf "\ttelebit init\n"
echo ""
