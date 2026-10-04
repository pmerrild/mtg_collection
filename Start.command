#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
trap 'printf "\nThe app has stopped. Press Return to close this window.\n"; read -r' EXIT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'Python 3.10 or newer is required. Install it from https://www.python.org/downloads/macos/ and try again.\n'
  exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  printf 'Python 3.10 or newer is required. Install a newer Python and try again.\n'
  exit 1
fi
if [ ! -x .venv/bin/python ]; then
  printf 'Preparing your local Python environment…\n'
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import fastapi, uvicorn, openpyxl, httpx' 2>/dev/null; then
  printf 'Installing the app dependencies. Internet access is needed for this first setup.\n'
  .venv/bin/python -m pip install -r requirements.txt
fi
.venv/bin/python run.py
