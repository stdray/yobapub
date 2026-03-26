#!/bin/sh
exec pwsh -NoProfile -ExecutionPolicy Bypass -File "$(dirname "$0")/package.ps1" "$@"
