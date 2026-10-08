"""Shared pytest setup for Koda server-agent tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path


TEST_ROOT = Path(__file__).resolve().parent
AGENT_ROOT = TEST_ROOT.parent
SERVER_ROOT = AGENT_ROOT.parent
WEB_ROOT = SERVER_ROOT / "web"
PROJECT_ROOT = SERVER_ROOT.parent

for path in (TEST_ROOT, AGENT_ROOT, WEB_ROOT):
    raw = str(path)
    if raw not in sys.path:
        sys.path.insert(0, raw)


def pytest_configure(config):
    """Register local markers when tests run without pytest.ini discovery."""
    config.addinivalue_line(
        "markers",
        "envcheck: opt-in checks that inspect local machine or external service readiness",
    )
    config.addinivalue_line(
        "markers",
        "integration: opt-in checks that may require live LiveKit/VPS/network services",
    )
    config.addinivalue_line("markers", "slow: checks expected to take longer than fast unit tests")


# Safe import defaults. Tests that need exact values pass explicit dictionaries into
# the test_api helpers instead of depending on this process environment.
os.environ.setdefault("LIVEKIT_API_KEY", "test-api-key")
os.environ.setdefault("LIVEKIT_API_SECRET", "test-api-secret")
os.environ.setdefault("LIVEKIT_URL", "ws://localhost:7880")
os.environ.setdefault("KODA_ROOM_NAME", "koda-dev")
