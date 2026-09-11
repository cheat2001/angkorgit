#!/bin/sh
# angkorgit-cli
set -e
APP=@APP@
KIND=@KIND@

usage() {
  cat <<'EOF'
@HELP@
EOF
}

resolve() {
  target=$1
  if [ ! -e "$target" ]; then
    echo "angkorgit: $target: no such file or directory" >&2
    exit 1
  fi
  if [ -d "$target" ]; then
    (cd "$target" && pwd)
  else
    echo "$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"
  fi
}

launch_open() {
  abs=$1
  if [ "$KIND" = "app" ]; then
    open -a "$APP" "$abs"
  else
    nohup "$APP" --open "$abs" >/dev/null 2>&1 &
  fi
}

launch_clone() {
  url=$1
  branch=$2
  cwd=$(pwd)
  if [ "$KIND" = "app" ]; then
    if [ -n "$branch" ]; then
      open -n -a "$APP" --args --clone "$url" --into "$cwd" --branch "$branch"
    else
      open -n -a "$APP" --args --clone "$url" --into "$cwd"
    fi
  else
    if [ -n "$branch" ]; then
      nohup "$APP" --clone "$url" --into "$cwd" --branch "$branch" >/dev/null 2>&1 &
    else
      nohup "$APP" --clone "$url" --into "$cwd" >/dev/null 2>&1 &
    fi
  fi
}

if [ $# -eq 0 ]; then
  launch_open "$(pwd)"
  exit 0
fi

case "$1" in
  -h|--help|help)
    usage
    exit 0
    ;;
  open)
    if [ -n "$2" ]; then
      case "$2" in
        -h|--help)
          usage
          exit 0
          ;;
      esac
      abs=$(resolve "$2") || exit 1
      launch_open "$abs"
    else
      launch_open "$(pwd)"
    fi
    exit 0
    ;;
  clone)
    shift
    branch=
    url=
    while [ $# -gt 0 ]; do
      case "$1" in
        -b|--branch)
          if [ -z "$2" ]; then
            echo "angkorgit: clone: missing branch after $1" >&2
            exit 1
          fi
          branch=$2
          shift 2
          ;;
        -h|--help)
          usage
          exit 0
          ;;
        -*)
          echo "angkorgit: unknown option: $1" >&2
          usage >&2
          exit 1
          ;;
        *)
          url=$1
          shift
          ;;
      esac
    done
    if [ -z "$url" ]; then
      echo "angkorgit: clone: missing url or owner/repo" >&2
      usage >&2
      exit 1
    fi
    launch_clone "$url" "$branch"
    exit 0
    ;;
  -*)
    echo "angkorgit: unknown option: $1" >&2
    usage >&2
    exit 1
    ;;
  *)
    abs=$(resolve "$1") || exit 1
    launch_open "$abs"
    exit 0
    ;;
esac
