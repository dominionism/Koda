"""Decoupled test API for Koda voice-system diagnostics.

The helpers in this module intentionally model system boundaries instead of
importing production entrypoints. Tests should ask questions like "would the
mobile app and agent join the same LiveKit target?" rather than pinning to a
specific implementation detail in ``serve.py`` or ``main.py``.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_ROOM = "koda-dev"
DEFAULT_LOCAL_LIVEKIT_URL = "ws://localhost:7880"
SHELL_FRAGMENT_PATTERN = re.compile(r"\b(cd|python3?|uv|pip|&&|;)\b")


@dataclass(frozen=True)
class EnvIssue:
    """A sanitized environment/configuration problem found by env-check helpers.

    Behavior:
        Carries the key name, severity, and human-readable reason for a problem
        without storing or printing secret values.

    Exceptions:
        None. This is a plain value object.

    Returns:
        Instances are immutable dataclass values.

    Params:
        key: Environment variable or config field with the issue.
        severity: Short severity label such as ``warning`` or ``error``.
        reason: Sanitized explanation of the problem.
    """

    key: str
    severity: str
    reason: str


@dataclass(frozen=True)
class LiveKitTarget:
    """The LiveKit room/server pair one participant intends to join.

    Behavior:
        Normalizes the minimum identity needed to compare whether two Koda
        participants can meet: URL plus room name.

    Exceptions:
        None. Use ``matches`` to compare safely.

    Returns:
        Instances are immutable dataclass values.

    Params:
        url: WebSocket URL for the LiveKit server.
        room: LiveKit room name.
        source: Human-readable owner, for diagnostics.
    """

    url: str
    room: str = DEFAULT_ROOM
    source: str = "unknown"

    def matches(self, other: "LiveKitTarget") -> bool:
        """Return whether two participants will meet in the same LiveKit room.

        Behavior:
            Compares URL and room exactly after trimming surrounding whitespace.

        Exceptions:
            None.

        Returns:
            ``True`` when both URL and room match; otherwise ``False``.

        Params:
            other: Another participant target to compare against.
        """
        return self.url.strip() == other.url.strip() and self.room.strip() == other.room.strip()


@dataclass(frozen=True)
class AgentEntrypoint:
    """A sanitized classification of a voice-agent Python entrypoint.

    Behavior:
        Records whether a file looks like the full server agent or the stale
        standalone voice agent without importing or executing it.

    Exceptions:
        None. This is a plain value object.

    Returns:
        Instances are immutable dataclass values.

    Params:
        path: Source file inspected.
        has_orchestrator: Whether the file references ACP/Orchestrator brain wiring.
        has_livekit_transport: Whether the file references LiveKit transport wiring.
    """

    path: Path
    has_orchestrator: bool
    has_livekit_transport: bool

    @property
    def is_full_server_agent(self) -> bool:
        """Return whether the entrypoint appears to be the current full agent.

        Behavior:
            Treats Orchestrator/ACP wiring plus LiveKit transport as the minimum
            evidence for the current server agent.

        Exceptions:
            None.

        Returns:
            ``True`` when both core signals are present; otherwise ``False``.

        Params:
            None.
        """
        return self.has_orchestrator and self.has_livekit_transport


@dataclass(frozen=True)
class VoiceProbeReport:
    """A stable summary of voice bootstrap assumptions for tests to assert on.

    Behavior:
        Captures token-server and agent LiveKit targets plus sanitized config
        issues. The report intentionally excludes secrets and network state.

    Exceptions:
        None. This is a plain value object.

    Returns:
        Instances are immutable dataclass values.

    Params:
        token_server: LiveKit target returned or implied by the token server.
        agent: LiveKit target configured for the voice agent.
        issues: Sanitized environment issues discovered during summarization.
    """

    token_server: LiveKitTarget
    agent: LiveKitTarget
    issues: tuple[EnvIssue, ...] = field(default_factory=tuple)

    @property
    def participants_can_meet(self) -> bool:
        """Return whether mobile and agent are aimed at the same room/server.

        Behavior:
            Delegates comparison to ``LiveKitTarget.matches``.

        Exceptions:
            None.

        Returns:
            ``True`` if token-server and agent targets match; otherwise ``False``.

        Params:
            None.
        """
        return self.token_server.matches(self.agent)


def parse_env_lines(lines: Iterable[str]) -> dict[str, str]:
    """Parse simple dotenv lines without expanding or revealing secrets.

    Behavior:
        Reads ``KEY=value`` lines, ignores blank/comment lines, strips optional
        single or double quotes, and returns raw string values for tests to pass
        into env-check helpers.

    Exceptions:
        None. Malformed lines are ignored because the caller can separately test
        raw file contents if syntax strictness matters.

    Returns:
        Dictionary of parsed key/value pairs.

    Params:
        lines: Iterable of dotenv-style lines.
    """
    env: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            env[key] = value
    return env


def derive_client_livekit_url(
    host_header: str | None,
    override: str | None = None,
    configured_url: str | None = None,
) -> str:
    """Derive the LiveKit URL returned to a token-server caller.

    Behavior:
        Mirrors the contract in ``Server/web/serve.py`` without importing the
        HTTP handler: ``KODA_PUBLIC_LK_URL`` wins, then ``LIVEKIT_URL`` wins, and
        request-host inference is only the final fallback.

    Exceptions:
        None.

    Returns:
        WebSocket URL the mobile client would receive from ``GET /token``.

    Params:
        host_header: HTTP Host header that reached the token server.
        override: Optional public LiveKit URL override.
        configured_url: Optional agent/token-server LiveKit URL from env.
    """
    if override:
        return override
    if configured_url:
        return configured_url
    host = (host_header or "localhost").rsplit(":", 1)[0]
    return f"ws://{host}:7880"


def detect_env_issues(env: Mapping[str, str]) -> tuple[EnvIssue, ...]:
    """Find sanitized Koda voice configuration problems.

    Behavior:
        Checks only structural properties: missing required keys, malformed URL
        schemes, known shell-command fragments in model values, and empty room
        names. Secret values are never returned.

    Exceptions:
        None.

    Returns:
        Tuple of ``EnvIssue`` values sorted in deterministic discovery order.

    Params:
        env: Mapping of environment keys to raw string values.
    """
    issues: list[EnvIssue] = []
    required_keys = ("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL")
    for key in required_keys:
        if not env.get(key, "").strip():
            issues.append(EnvIssue(key, "error", "required value is missing"))

    livekit_url = env.get("LIVEKIT_URL", "").strip()
    if livekit_url and not livekit_url.startswith(("ws://", "wss://")):
        issues.append(EnvIssue("LIVEKIT_URL", "error", "must use ws:// or wss://"))

    public_url = env.get("KODA_PUBLIC_LK_URL", "").strip()
    if public_url and not public_url.startswith(("ws://", "wss://")):
        issues.append(EnvIssue("KODA_PUBLIC_LK_URL", "error", "must use ws:// or wss://"))

    room = env.get("KODA_ROOM_NAME", DEFAULT_ROOM).strip()
    if not room:
        issues.append(EnvIssue("KODA_ROOM_NAME", "error", "room name cannot be empty"))

    cartesia_model = env.get("CARTESIA_MODEL", "").strip()
    if cartesia_model and SHELL_FRAGMENT_PATTERN.search(cartesia_model):
        issues.append(
            EnvIssue(
                "CARTESIA_MODEL",
                "error",
                "looks like a shell command was appended to the model value",
            )
        )

    return tuple(issues)


def summarize_voice_config(env: Mapping[str, str], host_header: str | None = "localhost:8800") -> VoiceProbeReport:
    """Summarize whether token server and agent should meet in LiveKit.

    Behavior:
        Builds a sanitized report from environment-like values. The token-server
        target uses ``KODA_PUBLIC_LK_URL`` when present, then ``LIVEKIT_URL``;
        only then does it derive a local fallback from ``host_header``. The agent
        target uses ``LIVEKIT_URL``.

    Exceptions:
        None.

    Returns:
        ``VoiceProbeReport`` containing targets and sanitized issues.

    Params:
        env: Mapping of environment keys to raw string values.
        host_header: Host header used to model a mobile/macOS token request.
    """
    room = env.get("KODA_ROOM_NAME", DEFAULT_ROOM).strip() or DEFAULT_ROOM
    token_url = derive_client_livekit_url(
        host_header,
        env.get("KODA_PUBLIC_LK_URL"),
        env.get("LIVEKIT_URL"),
    )
    agent_url = env.get("LIVEKIT_URL", DEFAULT_LOCAL_LIVEKIT_URL).strip()
    return VoiceProbeReport(
        token_server=LiveKitTarget(token_url, room=room, source="token-server"),
        agent=LiveKitTarget(agent_url, room=room, source="agent"),
        issues=detect_env_issues(env),
    )


def decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode a JWT payload without verifying the signature.

    Behavior:
        Decodes the middle JWT segment using URL-safe base64 padding. This is
    only for test/env-check assertions about token shape; it does not prove token
        authenticity.

    Exceptions:
        ValueError: If the token does not have three segments or the payload is
        not valid JSON.

    Returns:
        Decoded payload dictionary.

    Params:
        token: JWT string to decode.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("JWT must contain header, payload, and signature segments")
    payload = parts[1]
    padded = payload + "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        data = json.loads(decoded.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError("JWT payload is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("JWT payload must decode to an object")
    return data


def build_vps_ssh_command(
    host: str = "you@your-brain-host",
    remote_bin: str = "/home/you/.zeroclaw/bin/zeroclaw",
    *args: str,
) -> tuple[str, ...]:
    """Build the SSH command the agent would use for a VPS health check.

    Behavior:
        Produces a deterministic command tuple for tests and documentation. It
        does not execute SSH, so default tests remain offline.

    Exceptions:
        ValueError: If ``host`` or ``remote_bin`` is blank.

    Returns:
        Tuple suitable for ``subprocess`` or display in diagnostics.

    Params:
        host: SSH destination, e.g. ``you@your-brain-host``.
        remote_bin: Remote zeroclaw executable path.
        *args: Additional remote command arguments.
    """
    host = host.strip()
    remote_bin = remote_bin.strip()
    if not host:
        raise ValueError("host is required")
    if not remote_bin:
        raise ValueError("remote_bin is required")
    return ("ssh", host, remote_bin, *args)


def classify_agent_entrypoint(path: Path) -> AgentEntrypoint:
    """Classify a voice-agent entrypoint without importing it.

    Behavior:
        Reads source text and detects two stable architecture signals: LiveKit
        transport setup and ACP/Orchestrator brain wiring. This lets tests catch
        accidental use of the stale ``agents/voice/main.py`` entrypoint.

    Exceptions:
        FileNotFoundError: If ``path`` does not exist.

    Returns:
        ``AgentEntrypoint`` value with boolean architecture signals.

    Params:
        path: Python source file to inspect.
    """
    text = path.read_text(encoding="utf-8")
    return AgentEntrypoint(
        path=path,
        has_orchestrator="Orchestrator" in text or "acp_client" in text,
        has_livekit_transport="LiveKitTransport" in text,
    )


def missing_processes(process_names: Sequence[str], required_names: Sequence[str]) -> tuple[str, ...]:
    """Compare observed process names against the voice stack requirements.

    Behavior:
        Performs a case-insensitive substring check so tests can feed sanitized
        process command lines without depending on platform-specific ``ps``
        output formatting.

    Exceptions:
        None.

    Returns:
        Tuple of required process labels that were not observed.

    Params:
        process_names: Observed process labels or command lines.
        required_names: Required process labels or substrings.
    """
    observed = "\n".join(process_names).lower()
    return tuple(name for name in required_names if name.lower() not in observed)


def read_env_file(path: Path) -> dict[str, str]:
    """Read a dotenv file through the sanitized parser.

    Behavior:
        Uses ``parse_env_lines`` so tests can inspect structure without importing
        dotenv or printing values.

    Exceptions:
        FileNotFoundError: If the requested file does not exist.

    Returns:
        Parsed key/value dictionary.

    Params:
        path: Dotenv file path.
    """
    return parse_env_lines(path.read_text(encoding="utf-8").splitlines())
