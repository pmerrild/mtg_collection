#!/usr/bin/env python3
"""Start the local service and its prebuilt browser interface."""
import argparse
import socket
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn


def open_when_ready(url):
    # Local readiness checks must bypass any configured external HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(100):
        try:
            with opener.open(url + '/api/state', timeout=1) as response:
                if response.status == 200:
                    webbrowser.open(url)
                    return
        except (OSError, ValueError):
            time.sleep(0.2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run MTG Vault on this computer')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not (Path(__file__).parent / 'frontend' / 'dist' / 'index.html').is_file():
        parser.error('The frontend is not built. Run npm ci and npm run build in frontend first.')
    try:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', args.port))
    except OSError:
        parser.error(f'Port {args.port} is already in use. Close the other app or use --port with a different number.')
    url = f'http://127.0.0.1:{args.port}'
    print(f'\nMTG Vault: {url}\nKeep this terminal open. Press Control-C to stop.\n')
    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
    uvicorn.run('backend.app:app', host='127.0.0.1', port=args.port, log_level='warning')
