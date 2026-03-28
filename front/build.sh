#!/bin/sh
exec pwsh -NoProfile -ExecutionPolicy Bypass -File "$(dirname "$0")/build.ps1" "$@"
