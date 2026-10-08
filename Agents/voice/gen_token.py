#!/usr/bin/env python3
"""Generate a LiveKit access token and run a simple test client."""

import sys

def generate_token(identity: str, room_name: str, api_key: str, api_secret: str) -> str:
    """Generate a LiveKit access token manually."""
    import time
    import base64
    import hmac
    import hashlib
    import json

    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())

    payload = {
        "sub": identity,
        "name": identity,
        "iat": now,
        "exp": now + 600,
        "room": room_name,
        "can_publish": True,
        "can_subscribe": True,
        "room_join": True,
    }

    header_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()

    message = f"{header_b64}.{payload_b64}"
    signature = hmac.new(api_secret.encode(), message.encode(), hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()

    return f"{header_b64}.{payload_b64}.{signature_b64}"


if __name__ == "__main__":
    import os

    api_key = os.environ.get("LIVEKIT_API_KEY", "devkey")
    api_secret = os.environ.get("LIVEKIT_API_SECRET", "secret")

    token = generate_token("test-user", "koda-dev", api_key, api_secret)
    print(token)