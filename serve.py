"""Serve the React build and partner login / upload-quota API."""

from __future__ import annotations

import json
import os
import secrets
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", "8502"))
QUOTA = 30
ACCOUNTS = {f"aipeoplereader{i:02d}": f"partner{i:02d}" for i in range(1, 11)}
STORE_LOCK = threading.Lock()


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


def resolve_store() -> Path:
    env = os.environ.get("MOTION_WEBAPP_STORE", "").strip()
    if env:
        return Path(env)
    for root in (Path.cwd(), Path("/opt/render/project/src"), Path(__file__).resolve().parent):
        if (root / "dist" / "index.html").is_file() or (root / "serve.py").is_file():
            path = root / "data" / "quotas.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            return path
    path = Path.cwd() / "data" / "quotas.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


DIST = None
STORE = None


def default_state() -> dict:
    return {
        "users": {
            name: {"password": password, "remaining": QUOTA} for name, password in ACCOUNTS.items()
        },
        "sessions": {},
    }


def load_state() -> dict:
    assert STORE is not None
    if not STORE.is_file():
        return default_state()
    try:
        data = json.loads(STORE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_state()
    users = data.setdefault("users", {})
    data.setdefault("sessions", {})
    for name, password in ACCOUNTS.items():
        current = users.get(name)
        if not isinstance(current, dict):
            users[name] = {"password": password, "remaining": QUOTA}
            continue
        current["password"] = password
        if not isinstance(current.get("remaining"), int):
            current["remaining"] = QUOTA
        current["remaining"] = max(0, min(QUOTA, current["remaining"]))
    return data


def save_state(data: dict) -> None:
    assert STORE is not None
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(STORE)


def public_user(username: str, remaining: int) -> dict:
    return {
        "ok": True,
        "username": username,
        "remaining": remaining,
        "quota": QUOTA,
    }


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        if self._api_path() == "/api/me":
            self._api_me()
            return
        requested = Path(self.translate_path(self.path))
        if requested.is_file():
            super().do_GET()
            return
        self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = self._api_path()
        if path == "/api/login":
            self._api_login()
            return
        if path == "/api/logout":
            self._api_logout()
            return
        if path == "/api/consume":
            self._api_consume()
            return
        self._json(404, {"ok": False, "error": "Not found"})

    def _api_path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def _token(self) -> str:
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return ""

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_login(self) -> None:
        body = self._read_json()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        with STORE_LOCK:
            state = load_state()
            user = state["users"].get(username)
            if not user or user.get("password") != password:
                self._json(401, {"ok": False, "error": "Invalid username or password."})
                return
            token = secrets.token_hex(24)
            state["sessions"][token] = username
            save_state(state)
            remaining = int(user["remaining"])
        payload = public_user(username, remaining)
        payload["token"] = token
        self._json(200, payload)

    def _api_logout(self) -> None:
        token = self._token()
        if token:
            with STORE_LOCK:
                state = load_state()
                state["sessions"].pop(token, None)
                save_state(state)
        self._json(200, {"ok": True})

    def _session_user(self) -> tuple[str, int] | None:
        token = self._token()
        if not token:
            return None
        with STORE_LOCK:
            state = load_state()
            username = state["sessions"].get(token)
            if not username:
                return None
            user = state["users"].get(username)
            if not user:
                return None
            return username, int(user["remaining"])

    def _api_me(self) -> None:
        session = self._session_user()
        if not session:
            self._json(401, {"ok": False, "error": "Please log in."})
            return
        username, remaining = session
        self._json(200, public_user(username, remaining))

    def _api_consume(self) -> None:
        token = self._token()
        if not token:
            self._json(401, {"ok": False, "error": "Please log in."})
            return
        with STORE_LOCK:
            state = load_state()
            username = state["sessions"].get(token)
            user = state["users"].get(username) if username else None
            if not username or not user:
                self._json(401, {"ok": False, "error": "Please log in."})
                return
            remaining = int(user["remaining"])
            if remaining <= 0:
                self._json(
                    403,
                    {
                        "ok": False,
                        "error": "No video uploads remaining.",
                        **public_user(username, 0),
                    },
                )
                return
            user["remaining"] = remaining - 1
            save_state(state)
            leftover = int(user["remaining"])
        self._json(200, public_user(username, leftover))


def main() -> None:
    global DIST, STORE
    DIST = resolve_dist()
    STORE = resolve_store()
    with STORE_LOCK:
        save_state(load_state())
    server = ThreadingHTTPServer(("0.0.0.0", PORT), SpaHandler)
    print(f"Serving {DIST} on 0.0.0.0:{PORT}", flush=True)
    print(f"Quota store {STORE}", flush=True)
    server.serve_forever()


def cli() -> None:
    """Console entry for Render's leftover `streamlit ...` start command."""
    main()


if __name__ == "__main__":
    main()
