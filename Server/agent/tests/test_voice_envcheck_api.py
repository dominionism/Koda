from __future__ import annotations

import base64
import json

from pathlib import Path

from test_api import (
    build_vps_ssh_command,
    classify_agent_entrypoint,
    decode_jwt_payload,
    derive_client_livekit_url,
    detect_env_issues,
    missing_processes,
    parse_env_lines,
    summarize_voice_config,
)


def _unsigned_jwt(payload: dict) -> str:
    header = {"alg": "none", "typ": "JWT"}

    def encode(part: dict) -> str:
        raw = json.dumps(part, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{encode(header)}.{encode(payload)}."


def test_parse_env_lines_ignores_comments_and_strips_quotes() -> None:
    env = parse_env_lines(
        [
            "# comment",
            "",
            "LIVEKIT_URL='wss://example.livekit.cloud'",
            'KODA_ROOM_NAME="koda-dev"',
            "malformed",
        ]
    )

    assert env == {
        "LIVEKIT_URL": "wss://example.livekit.cloud",
        "KODA_ROOM_NAME": "koda-dev",
    }


def test_public_livekit_override_wins_over_request_host() -> None:
    url = derive_client_livekit_url(
        "localhost:8800",
        override="wss://koda-hjr3crsv.livekit.cloud",
    )

    assert url == "wss://koda-hjr3crsv.livekit.cloud"


def test_configured_livekit_url_wins_over_request_host_when_public_override_missing() -> None:
    url = derive_client_livekit_url(
        "localhost:8800",
        configured_url="wss://koda-hjr3crsv.livekit.cloud",
    )

    assert url == "wss://koda-hjr3crsv.livekit.cloud"


def test_request_host_is_final_fallback_when_no_livekit_url_is_configured() -> None:
    url = derive_client_livekit_url("192.168.1.23:8800")

    assert url == "ws://192.168.1.23:7880"


def test_voice_config_report_confirms_mobile_agent_can_meet_without_public_override() -> None:
    report = summarize_voice_config(
        {
            "LIVEKIT_API_KEY": "key",
            "LIVEKIT_API_SECRET": "secret",
            "LIVEKIT_URL": "wss://koda-hjr3crsv.livekit.cloud",
            "KODA_ROOM_NAME": "koda-dev",
        },
        host_header="localhost:8800",
    )

    assert report.token_server.url == "wss://koda-hjr3crsv.livekit.cloud"
    assert report.agent.url == "wss://koda-hjr3crsv.livekit.cloud"
    assert report.participants_can_meet


def test_voice_config_report_confirms_mobile_agent_can_meet_with_public_override() -> None:
    report = summarize_voice_config(
        {
            "LIVEKIT_API_KEY": "key",
            "LIVEKIT_API_SECRET": "secret",
            "LIVEKIT_URL": "wss://koda-hjr3crsv.livekit.cloud",
            "KODA_PUBLIC_LK_URL": "wss://koda-hjr3crsv.livekit.cloud",
            "KODA_ROOM_NAME": "koda-dev",
        },
        host_header="localhost:8800",
    )

    assert report.participants_can_meet


def test_detect_env_issues_flags_corrupted_cartesia_model_without_exposing_value() -> None:
    issues = detect_env_issues(
        {
            "LIVEKIT_API_KEY": "key",
            "LIVEKIT_API_SECRET": "secret",
            "LIVEKIT_URL": "wss://koda-hjr3crsv.livekit.cloud",
            "CARTESIA_MODEL": "sonic-2cd /tmp/project && python3 -m venv .venv",
        }
    )

    assert any(issue.key == "CARTESIA_MODEL" for issue in issues)
    assert all("/tmp/project" not in issue.reason for issue in issues)


def test_detect_env_issues_flags_missing_required_livekit_values() -> None:
    issues = detect_env_issues({"KODA_ROOM_NAME": "koda-dev"})

    assert {issue.key for issue in issues} == {
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "LIVEKIT_URL",
    }


def test_decode_jwt_payload_returns_payload_object() -> None:
    token = _unsigned_jwt(
        {
            "sub": "user",
            "video": {"room": "koda-dev", "roomJoin": True},
        }
    )

    assert decode_jwt_payload(token) == {
        "sub": "user",
        "video": {"room": "koda-dev", "roomJoin": True},
    }


def test_decode_jwt_payload_rejects_non_jwt_shape() -> None:
    try:
        decode_jwt_payload("not-a-jwt")
    except ValueError as exc:
        assert "segments" in str(exc)
    else:
        raise AssertionError("decode_jwt_payload should reject non-JWT strings")


def test_build_vps_ssh_command_is_deterministic_and_offline() -> None:
    command = build_vps_ssh_command("you@your-brain-host", "/home/you/.zeroclaw/bin/zeroclaw", "--help")

    assert command == (
        "ssh",
        "you@your-brain-host",
        "/home/you/.zeroclaw/bin/zeroclaw",
        "--help",
    )


def test_missing_processes_reports_absent_voice_stack_processes() -> None:
    missing = missing_processes(
        ["python /repo/koda/Server/agent/main.py", "python /repo/koda/Server/web/serve.py"],
        ["Server/agent/main.py", "Server/web/serve.py", "livekit-server"],
    )

    assert missing == ("livekit-server",)


def test_classify_agent_entrypoint_identifies_full_server_agent() -> None:
    agent_main = Path(__file__).resolve().parents[1] / "main.py"

    entrypoint = classify_agent_entrypoint(agent_main)

    assert entrypoint.has_livekit_transport
    assert entrypoint.has_orchestrator
    assert entrypoint.is_full_server_agent
