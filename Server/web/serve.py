"""Koda's dev web client server — serves the test page and mints join tokens.

Replaces the old throwaway (`python -m http.server` out of a /tmp dir that got
deleted). Static page + a /token endpoint, credentials from Server/.env —
nothing hardcoded, nothing in the page source.

Run with the gateway's venv (it has livekit-api + dotenv):

    cd Server/web && ../agent/.venv/bin/python serve.py     # http://localhost:8800
"""
from __future__ import annotations

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", ".env"))

PORT = int(os.environ.get("KODA_WEB_PORT", "8800"))
ROOM = os.environ.get("KODA_ROOM_NAME", "koda-dev")


def mint_token() -> str:
    """Mint a LiveKit JWT for a user participant in the dev room.

    Creates an AccessToken with identity "user" and publish/subscribe
    grants for the configured room. Credentials come from environment
    (LIVEKIT_API_KEY, LIVEKIT_API_SECRET).

    Returns:
        A signed JWT string the user can use to join the LiveKit room.
    """
    token = AccessToken(
        os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"]
    )
    token.with_identity("user").with_name("You")
    token.with_grants(
        VideoGrants(room_join=True, room=ROOM, can_publish=True, can_subscribe=True)
    )
    return token.to_jwt()


class Handler(SimpleHTTPRequestHandler):
    """HTTP request handler for the dev web client.

    Serves static files from the ``Server/web`` directory and exposes a
    ``/token`` endpoint that returns a LiveKit join token and WebSocket URL
    as JSON.
    """

    def _client_ws_url(self) -> str:
        """Return the LiveKit URL the client should join.

        Prefer explicit configuration over request-host inference so the mobile
        app and the agent default to the same LiveKit server. Request-host
        inference remains a final fallback for old local-dev setups.
        """
        override = os.environ.get("KODA_PUBLIC_LK_URL")
        if override:
            return override
        configured = os.environ.get("LIVEKIT_URL")
        if configured:
            return configured
        host = (self.headers.get("Host") or "localhost").rsplit(":", 1)[0]
        return f"ws://{host}:7880"

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        """Handle GET requests: serve static files or return a LiveKit token.

        Routes ``/token`` to the token endpoint (returns JSON with ``token``
        and ``url`` fields). All other paths fall through to the base class
        for static file serving.
        """
        if self.path.split("?")[0] == "/token":
            body = json.dumps(
                {"token": mint_token(), "url": self._client_ws_url()}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format: str, *args) -> None:
        """Suppress default HTTP request logging for the dev page."""
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), partial(Handler, directory=HERE))
    print(f"koda web client: http://localhost:{PORT}  (room={ROOM})")
    server.serve_forever()
