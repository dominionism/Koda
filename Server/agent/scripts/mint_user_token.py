"""Mint a LiveKit JWT for a human participant in the dev room.

Usage:
    make token                 # identity "user", room from KODA_ROOM_NAME
    make token IDENTITY=alice  # override the participant identity

    # or directly:
    cd Server/agent && uv run python -m scripts.mint_user_token [identity]

Credentials come from Server/.env (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) — the
same file the gateway and Server/web/serve.py read. Prints the signed JWT to
stdout; paste it into the Flutter app's Access-token field (alongside the
LiveKit URL) or the LiveKit Agents Playground. This mirrors what serve.py's
/token endpoint mints for the app's auto-fetch flow.
"""
from __future__ import annotations

import os
import sys

from datetime import timedelta

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants

# Server/agent/scripts/mint_user_token.py -> Server/.env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def main() -> int:
    """Mint and print a LiveKit join token for the dev room.

    Reads the participant identity from argv (default "user") and the room
    from KODA_ROOM_NAME (default "koda-dev"). Signs a 24h token with
    join/publish/subscribe grants using the LiveKit API key/secret in the
    environment.

    Returns:
        0 on success; 1 with a clear message if the LiveKit credentials are
        missing from Server/.env.
    """
    identity = sys.argv[1] if len(sys.argv) > 1 else "user"
    room = os.environ.get("KODA_ROOM_NAME", "koda-dev")

    try:
        api_key = os.environ["LIVEKIT_API_KEY"]
        api_secret = os.environ["LIVEKIT_API_SECRET"]
    except KeyError as missing:
        sys.stderr.write(
            f"Missing {missing} — copy Server/.env.example to Server/.env and set "
            "LIVEKIT_API_KEY / LIVEKIT_API_SECRET (dev defaults: devkey / secret).\n"
        )
        return 1

    token = AccessToken(api_key, api_secret)
    token.with_identity(identity).with_name(identity)
    token.with_ttl(timedelta(hours=24))
    token.with_grants(
        VideoGrants(
            room_join=True,
            room=room,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        )
    )
    print(token.to_jwt())
    return 0


if __name__ == "__main__":
    sys.exit(main())
