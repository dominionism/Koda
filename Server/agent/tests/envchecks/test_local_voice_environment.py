from __future__ import annotations

from pathlib import Path

import pytest

from test_api.voice_envcheck import read_env_file, summarize_voice_config


@pytest.mark.envcheck
def test_local_env_has_structurally_valid_voice_config() -> None:
    """Check the developer machine's current voice env without printing secrets."""
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        pytest.skip("Server/.env is not present on this machine")

    report = summarize_voice_config(read_env_file(env_path), host_header="localhost:8800")

    assert not report.issues, [f"{issue.key}: {issue.reason}" for issue in report.issues]


@pytest.mark.envcheck
def test_local_token_server_and_agent_target_same_livekit_room_when_using_localhost() -> None:
    """Check whether localhost token fetches would put mobile in the agent room."""
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        pytest.skip("Server/.env is not present on this machine")

    report = summarize_voice_config(read_env_file(env_path), host_header="localhost:8800")

    assert report.participants_can_meet, (
        f"token server would return {report.token_server.url!r} for room "
        f"{report.token_server.room!r}, but agent is configured for "
        f"{report.agent.url!r} room {report.agent.room!r}"
    )
