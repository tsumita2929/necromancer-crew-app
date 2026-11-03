"""Graveyard backend for the Necromancer Kiro Crew app.

Read-only. It serves the watchlist file that the MCP server and Night Watch write
(``data/watch.json``) to the Graveyard page through the gateway's reverse proxy at
``/apps/necromancer/api/*``. Standard library only, so there is nothing to install.

Requests from the proxy carry ``X-KiroCrew-Proxy: <ts>:<hmac>``. When the gateway
gave this process a proxy secret, every ``/api/*`` request must verify. ``/health``
is unsigned on purpose: the gateway probes it without credentials.
"""
import hashlib
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", 9100))
APP_NAME = os.environ.get("KIROCREW_APP_NAME", "necromancer")
SECRET = os.environ.get("KIROCREW_PROXY_SECRET", "")
ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
DATA_DIR = os.environ.get("NECROMANCER_DATA_DIR") or os.path.join(ROOT, "data")
STATE_FILE = os.path.join(DATA_DIR, "watch.json")
MAX_SKEW_SECONDS = 60
MAX_STATE_BYTES = 20 * 1024 * 1024


def verify(header, method, target, body=b"", secret=SECRET, now=None):
    """True when the proxy signature is valid and fresh (same scheme as the gateway)."""
    if not secret:
        return True  # no secret was issued: loopback-only, unverified
    if not header or ":" not in header:
        return False
    ts, _, sig = header.partition(":")
    if not ts.isdigit() or not sig:
        return False
    if abs((time.time() if now is None else now) - int(ts)) > MAX_SKEW_SECONDS:
        return False
    msg = "%s:%s:%s:%s" % (ts, method, target, hashlib.sha256(body).hexdigest())
    expected = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), sig.encode("utf-8", "surrogatepass"))


def read_state():
    """The stored watch state, or an empty one. Never raises."""
    empty = {"version": 1, "projects": {}}
    try:
        if os.path.getsize(STATE_FILE) > MAX_STATE_BYTES:
            return empty, "State file is too large to serve."
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        if isinstance(doc, dict) and doc.get("version") == 1 and isinstance(doc.get("projects"), dict):
            return doc, None
        return empty, "State file has an unexpected shape."
    except FileNotFoundError:
        return empty, None
    except (OSError, ValueError) as exc:
        return empty, "State file could not be read: %s" % exc.__class__.__name__


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            return self._json(200, {"status": "ok", "app": APP_NAME})
        if not path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        if not verify(self.headers.get("X-KiroCrew-Proxy", ""), "GET", self.path):
            return self._json(401, {"error": "unauthorized"})
        if path == "/api/graveyard":
            state, problem = read_state()
            return self._json(200, {"state": state, "problem": problem})
        if path == "/api/status":
            return self._json(200, {"app": APP_NAME, "version": "0.1.0"})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        self._json(405, {"error": "read-only"})

    do_PUT = do_PATCH = do_DELETE = do_POST

    def _json(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class Server(HTTPServer):
    """Address reuse is POSIX-only so a second copy fails to bind instead of splitting traffic."""

    allow_reuse_address = not sys.platform.startswith("win")


if __name__ == "__main__":
    print("%s backend on port %s" % (APP_NAME, PORT))
    Server(("127.0.0.1", PORT), Handler).serve_forever()
