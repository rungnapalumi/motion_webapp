"""Serve the copied Vercel React build on Render's $PORT."""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parent / "dist"
PORT = int(os.environ.get("PORT", "8502"))


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        requested = Path(self.translate_path(self.path))
        if requested.is_file():
            super().do_GET()
            return
        index = DIST / "index.html"
        self.path = "/index.html"
        if index.is_file():
            super().do_GET()
            return
        self.send_error(404, "Build missing. Run npm run build.")


if __name__ == "__main__":
    if not DIST.is_dir():
        raise SystemExit(f"Missing {DIST}. Run npm run build first.")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), SpaHandler)
    print(f"Serving {DIST} on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()
