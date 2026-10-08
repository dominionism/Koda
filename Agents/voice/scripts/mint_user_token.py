"""Print a LiveKit JWT for a human participant.

Usage:
    uv run python -m scripts.mint_user_token [identity]

Default identity is "user". Useful when joining the LiveKit Agents Playground
or the Flutter client during local development.
"""

from __future__ import annotations

import os
import sys

from datetime import timedelta

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def main() -> int:
    identity = sys.argv[1] if len(sys.argv) > 1 else "user"
    room = os.environ.get("KODA_ROOM_NAME", "koda-dev")

    token = AccessToken(
        os.environ["LIVEKIT_API_KEY"],
        os.environ["LIVEKIT_API_SECRET"],
    )
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
