"""Serve the copied Vercel React build on Render's $PORT."""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8502"))


def resolve_dist() -> Path:
    env = os.environ.get("MOTION_WEBAPP_DIST", "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.extend(
        [
            Path.cwd() / "dist",
            Path("/opt/render/project/src/dist"),
            Path(__file__).resolve().parent / "dist",
        ]
    )
    for path in candidates:
        if (path / "index.html").is_file():
            return path
    checked = ", ".join(str(p) for p in candidates)
    raise SystemExit(f"Missing React build (index.html). Looked in: {checked}")


DIST = None


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
        self.path = "/index.html"
        super().do_GET()


def main() -> None:
    global DIST
    DIST = resolve_dist()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), SpaHandler)
    print(f"Serving {DIST} on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


def cli() -> None:
    """Console entry for Render's leftover `streamlit ...` start command."""
    main()


if __name__ == "__main__":
    main()
