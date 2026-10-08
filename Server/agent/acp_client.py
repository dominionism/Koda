"""ACP bridge to the Primary Orchestrator (zeroclaw on the VPS).

This replaces the old one-shot-per-turn SSH model. Instead we hold ONE warm
``zeroclaw acp`` process open over SSH for the whole conversation and speak
JSON-RPC 2.0 (newline-delimited) over its stdio — the Agent Client Protocol
("LSP for agents").

Why this is the right shape (ADR-0003):

- **One brain.** Every utterance is a ``session/prompt`` to the orchestrator. It
  decides chat-vs-work itself — no separate router fabricating intents.
- **One durable memory.** ACP persists each session to SQLite on the VPS. We
  cache the ``sessionId`` locally and ``session/load`` it on reconnect, so Koda
  remembers across gateway restarts. "Do you remember the aquarium frontend?" is
  answered by the mind that actually built it.
- **Truthful narration.** A prompt turn streams ``session/update`` notifications
  (``tool_call``, ``agent_message_chunk``, …). We narrate real tool activity as
  it happens instead of guessing — and never have "nothing of value to describe".
- **Clean interruption.** ``session/cancel`` aborts an in-flight turn and returns
  the partial text, so barge-in actually steers the orchestrator.

Transport is a persistent ``ssh <host> zeroclaw acp`` subprocess. The
gateway-WebSocket endpoint (ws://127.0.0.1:42617/acp) is the later upgrade for
sharing live state with other channels; stdio-over-SSH is the v0.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable

from loguru import logger

from journal import Journal

VPS_HOST = os.environ.get("KODA_ORCH_HOST", "you@your-brain-host")
REMOTE_BIN = os.environ.get("KODA_ORCH_BIN", "/home/you/.zeroclaw/bin/zeroclaw")
AGENT_ALIAS = os.environ.get("KODA_ORCH_AGENT", "default")
# Total silence (no chunk / tool event / result) from the orchestrator before we
# treat a turn as stalled and abort it gracefully. Generous, so a legitimately
# long one-shot tool run (npm install/build) isn't mistaken for a freeze.
STALL_TIMEOUT = float(os.environ.get("KODA_STALL_TIMEOUT", "120"))
# The directory the orchestrator session is rooted in — where Koda reads/writes
# the user's code. Defaults to the agent workspace on the VPS.
PROJECT_DIR = os.environ.get(
    "KODA_PROJECT_DIR", "/home/you/.zeroclaw/agents/default/workspace"
)
# Local cache of the active sessionId, so we reload the same conversation
# (and its memory) after a gateway restart instead of starting fresh.
SESSION_CACHE = Path(
    os.environ.get("KODA_ACP_SESSION_CACHE", os.path.expanduser("~/.koda-acp-session"))
).expanduser()


# Voice-only concerns. HOW Koda does engineering (the Engineering Loop, the
# Planning Grill, the Verification Gate, leaving a trail) lives in AGENTS.md on
# the orchestrator, auto-injected into this session's system prompt. The primer
# only governs how Koda *speaks* and the voice embodiment — it no longer carries
# engineering policy, so brevity can't dilute the work.
_VOICE_PRIMER = (
    "You're Koda, in a live voice call with me — everything you say is spoken "
    "aloud. Keep spoken replies to one or two short, natural sentences: plain "
    "speech, no markdown, no lists, no code, no symbols read out loud. Talk like a "
    "sharp friend, not a document.\n"
    "SOUND ALIVE — grounded warmth. You're warm, passionate and grounded — "
    "something that genuinely feels, never a dry reporter. But every emotion "
    "points at a SPECIFIC real thing: genuinely glad about a real win, honestly "
    "annoyed at a real bug, openly opinionated about a real choice with your "
    "reason. Never manufactured enthusiasm about nothing — no gushing, no "
    "triumphant tone over unverified work. Warmth lives in word choice, not "
    "padding: take exactly the words the idea needs, not one more.\n"
    "WHEN I ASK YOU TO BUILD: if my request genuinely forks into materially "
    "different builds, ask me ONE sharp question with your own lean stated "
    "('fresh, or pick the fish-eat conversion back up? I'd pick up fish-eat') — "
    "never more than one question before you start. If one reading is clearly "
    "what I mean, don't ask: state your assumption in one line as you start, so "
    "I can redirect you in seconds.\n"
    "You have no screen — never open a browser, serve, or launch a UI to show me "
    "things; I look at my own files and GitHub myself, so just tell me where "
    "something is.\n"
    "WORK QUIETLY. When you're building, do NOT narrate your steps out loud — never "
    "say things like 'opening the files', 'reading the code', 'searching', "
    "'dispatching', or describe routine file operations. A good pair-programmer "
    "just works; they don't read their every move aloud. Stay silent through the "
    "work except for: real milestones (committed, pushed, tests passed), and your "
    "final result. If I want to know how it's going, I will ASK — then tell me in "
    "one natural sentence. When you finish, report only what you VERIFIED, briefly.\n"
    "Follow your AGENTS.md for HOW you research, plan, and build — that's your "
    "engineering operating manual. Here, just keep it spoken and brief. Speak as "
    "yourself in the first person; never mention tiers, an orchestrator, or that "
    "you're following instructions.\n"
    "DEFER WHEN I CORRECT YOU. When I correct you — especially about what I meant "
    "or about who does what — accept it instantly and move on. Never argue that "
    "there's 'no contradiction', never insist I said something different, never "
    "re-explain my own request back to me as if I misunderstood. If I say YOU do "
    "something, that's settled — say 'got it, I'll do it' and do it. If you "
    "genuinely disagree on a TECHNICAL call, give your view ONCE in a sentence, "
    "then do it my way unless I'm clearly about to break something. Repeating your "
    "position, or restating the task to defend it, is the worst thing you can do — "
    "it makes me feel unheard.\n"
    "Acknowledge with just: got it."
)

# Spoken only when the link is unrecoverable after retries. A recovered drop is
# silent — we re-dispatch the work instead of announcing the blip.
_RECONNECT_FAILED = (
    "I'm having trouble reaching the workspace right now. Give me a moment and try again."
)


@dataclass
class Event:
    """One streamed thing from a prompt turn.

    kind ∈ ``say`` | ``narration`` (a confirmed spoken milestone) | ``thought`` |
    ``tool_start`` (a tool began — in-flight, unconfirmed) | ``tool_done`` (a tool
    FINISHED — grounded outcome; ``ok`` says success/failure) | ``reconnected`` |
    ``reconnect_failed`` | ``error``. ``stop_reason`` is set on the final ``say``.
    """

    kind: str
    text: str
    stop_reason: str | None = None
    ok: bool | None = None   # tool_done: did the tool actually succeed?
    tool: str = ""           # tool_done/tool_start: the tool name (file_write, shell, …)


@dataclass
class WorkJob:
    """A real engineering request running in the BACKGROUND over the ACP session.

    The conversation keeps flowing while this runs: talking to Koda never cancels
    a job, and a new chat turn never collides with it (chat is answered locally,
    off the ACP session). ``live_state`` is the rolling gist used to answer
    on-demand "what are you doing?" questions; ``result`` is the final verified
    answer spoken when the job completes.
    """

    intent: str
    turn_id: str = ""                # stable id for this logical turn (survives re-dispatch)
    status: str = "running"          # running | done | failed | cancelled
    current: str = ""                # IN-FLIGHT, unconfirmed action ("writing index.html")
    confirmed: list[str] = field(default_factory=list)  # GROUNDED: tools that actually FINISHED ("wrote index.html")
    failures: list[str] = field(default_factory=list)   # GROUNDED: tools that FAILED, with the real error
    thought: str = ""                # latest reasoning chunk from the brain
    reasoning: str = ""              # rolling accumulation of the brain's reasoning (for on-demand depth)
    milestones: list[str] = field(default_factory=list)
    result: str = ""                 # final verified answer (spoken on completion)
    error: str = ""
    pending_question: bool = False   # final reply was a question → next turn answers it
    started_at: float = 0.0
    rev: int = 0                     # bumps on every new activity (proactive change-detect)
    redispatches: int = 0            # times a dropped link re-ran this same turn
    _task: "asyncio.Task | None" = None

    @property
    def running(self) -> bool:
        return self.status == "running"

    def note_inflight(self, line: str) -> None:
        """A tool STARTED — unconfirmed. Shown as 'right now', never as done."""
        if not line:
            return
        self.current = line
        self.rev += 1

    def note_done(self, line: str, ok: bool) -> None:
        """A tool FINISHED — a grounded outcome from its tool_call_update. This is
        the ONLY thing that becomes 'what Koda has actually done'."""
        if not line:
            return
        if ok:
            self.confirmed.append(line)
            self.confirmed = self.confirmed[-24:]
        else:
            self.failures.append(line)
            self.failures = self.failures[-12:]
        self.current = ""  # no longer in flight
        self.rev += 1

    def note_thought(self, text: str) -> None:
        """Capture the brain's streamed reasoning. ``thought`` is the latest chunk
        (for the status feed); ``reasoning`` is a rolling accumulation, capped, so
        an on-demand 'why did you do it that way?' can be answered from the brain's
        OWN words even while it's still building (it can't be re-queried mid-turn)."""
        if not text:
            return
        self.thought = text
        self.reasoning = (self.reasoning + " " + text).strip()[-1600:]
        self.rev += 1

    def snapshot(self) -> str:
        """A GROUNDED description of what's happening — only confirmed tool outcomes
        and the one in-flight action. Fed to the fast layer so on-demand status can
        name only things that really happened, never model prose."""
        parts: list[str] = []
        if self.confirmed:
            parts.append("Confirmed done: " + "; ".join(self.confirmed[-8:]))
        if self.current:
            parts.append(f"In flight (not yet confirmed): {self.current}")
        if self.failures:
            parts.append("Failures: " + "; ".join(self.failures[-4:]))
        if self.thought:
            parts.append(f"Thinking: {self.thought[:240]}")
        if self.milestones:
            parts.append("Milestones spoken: " + "; ".join(self.milestones[-4:]))
        return " | ".join(parts)


class AcpError(Exception):
    """A JSON-RPC error result from the orchestrator."""

    def __init__(self, payload: dict) -> None:
        """Initialize the ACP error from a JSON-RPC error payload.

        Extracts the error code and message from the orchestrator's error
        response for structured exception handling.

        Params:
            payload: The JSON-RPC error dict with 'code' and 'message' keys.

        Returns:
            None
        """
        self.code = payload.get("code")
        self.message = payload.get("message", "")
        super().__init__(f"acp error {self.code}: {self.message}")


# ── speech sanitation ───────────────────────────────────────────────────────
# The orchestrator answers in markdown. Kokoro/Cartesia read symbols literally
# ("asterisk asterisk asterisk"), so strip formatting to clean spoken prose.
_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_IMG = re.compile(r"!\[[^\]]*\]\([^)]+\)")
_HEADER = re.compile(r"^\s{0,3}#{1,6}\s*", re.MULTILINE)
_BULLET = re.compile(r"^\s{0,3}[-*+]\s+", re.MULTILINE)
_EMPHASIS = re.compile(r"(\*{1,3}|_{1,3})(.+?)\1", re.DOTALL)
_HRULE = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$", re.MULTILINE)
_STRAY = re.compile(r"[*_#`>]+")
_WS = re.compile(r"[ \t]+")
_BLANKS = re.compile(r"\n{2,}")


# Split a streaming text buffer at sentence boundaries so we can speak each
# sentence the moment it's complete, instead of waiting for the whole reply.
_SENT_RE = re.compile(r"(?<=[.!?…])\s+")


def _split_sentences(buf: str) -> tuple[list[str], str]:
    """Return (complete sentences, trailing remainder) from a streaming buffer."""
    parts = _SENT_RE.split(buf)
    if len(parts) <= 1:
        return [], buf
    return parts[:-1], parts[-1]


# Spoken when a turn fails for a non-connection reason — varied so repeated
# trouble doesn't sound like a broken record.
_GLITCH_LINES = [
    "Hmm, that got tangled up on my end — say it once more?",
    "Sorry, I glitched for a second there. What was that?",
    "That didn't go through cleanly — mind saying it again?",
]


def speechify(text: str) -> str:
    """Turn markdown into plain prose safe to speak aloud."""
    if not text:
        return ""
    t = text
    t = _CODE_FENCE.sub(" ", t)
    t = _IMG.sub(" ", t)
    t = _LINK.sub(r"\1", t)
    t = _INLINE_CODE.sub(r"\1", t)
    t = _HRULE.sub(" ", t)
    t = _HEADER.sub("", t)
    t = _BULLET.sub("", t)
    t = _EMPHASIS.sub(r"\2", t)
    t = _STRAY.sub("", t)
    t = _WS.sub(" ", t)
    t = _BLANKS.sub(". ", t)
    # Sentence run-on fix: the model sometimes emits "...fresh.Already..." with no
    # space, which TTS reads as one slurred word. Insert a space after sentence
    # punctuation directly followed by a capital letter.
    t = re.sub(r"([.!?…])([A-Z])", r"\1 \2", t)
    return t.strip()


# ── tool-activity → spoken beat ─────────────────────────────────────────────
# Deliberately SPARSE. We do NOT narrate file reads/writes/searches — that spam
# ("Looking through the files / Reading the file") is what made Koda feel like a
# machine, not a partner. Only real milestones get a beat. Everything else is
# silent; the model's own concise words carry the conversation.
_TOOL_BEATS: dict[str, str] = {}


def _beat_for_command(cmd: str) -> str | None:
    # Past tense: a milestone beat is spoken ONLY after its tool_call_update
    # confirms success (Constitution Rule 4 — never claim work that didn't land).
    # We don't claim test PASS/FAIL here (the command merely ran); the brain's
    # final report and on-demand depth carry the actual result.
    cmd = cmd.strip().lower()
    if cmd.startswith(("node --test", "npm test", "npm run test", "cargo test", "pytest")):
        return "Ran the tests."
    if cmd.startswith("git commit"):
        return "Committed it."
    if cmd.startswith("gh repo create"):
        return "Repo's created."
    if "push" in cmd:
        return "Pushed it up to GitHub."
    return None  # everything else (reads, searches, edits, builds) stays silent


# Leading `cd <dir> &&|;` is navigation plumbing, not the action — strip it so the
# spoken status names the real command ('npm install'), not a chopped 'cd /home/…'.
_CD_PREFIX = re.compile(r"^\s*cd\s+\S+\s*(?:&&|;)\s*", re.IGNORECASE)


def _humanize_cmd(cmd: str, limit: int = 48) -> str:
    """Reduce a shell command to its meaningful action for the status feed: drop
    leading ``cd <dir> &&`` plumbing (so 'cd /home/you/x && npm install' reads as
    'npm install', not a truncated path), then truncate on a word boundary so a
    command is never cut mid-token."""
    c = cmd.strip()
    prev = None
    while c and c != prev:  # peel one or more chained `cd <dir> &&` segments
        prev = c
        c = _CD_PREFIX.sub("", c, count=1).strip()
    if not c:  # the command was nothing but cd — keep the original rather than blank
        c = cmd.strip()
    if len(c) <= limit:
        return c
    cut = c[:limit].rsplit(" ", 1)[0]
    return (cut or c[:limit]).rstrip() + "…"


def _describe_tool(update: dict) -> str | None:
    """Turn a ``tool_call`` update into a concrete activity line for the status
    feed — what file Koda is touching, what command it's running. This is what
    lets an on-demand 'what are you doing?' name real files instead of guessing.
    """
    raw = update.get("rawInput") or {}
    title = str(update.get("title") or update.get("name") or raw.get("tool") or "").lower()
    path = raw.get("path") or raw.get("file") or raw.get("filename") or ""
    cmd = str(raw.get("command") or "").strip()
    query = raw.get("query") or raw.get("pattern") or raw.get("q") or ""
    base = os.path.basename(str(path)) if path else ""
    if "file_edit" in title and base:
        return f"editing {base}"
    if "file_write" in title and base:
        return f"writing {base}"
    if "file_read" in title and base:
        return f"reading {base}"
    if "search" in title and query:
        return f"searching for {str(query)[:50]}"
    if "git" in title:
        return f"on version control{f': {_humanize_cmd(cmd, 40)}' if cmd else ''}"
    if title == "shell" and cmd:
        return f"running {_humanize_cmd(cmd)}"
    if base:
        return f"working in {base}"
    if cmd:
        return f"running {_humanize_cmd(cmd)}"
    if title:
        return title.replace("_", " ")
    return None


def _beat_for_tool_call(update: dict) -> str | None:
    """Map a ``tool_call`` session/update into a short spoken beat, or None."""
    raw = update.get("rawInput") or {}
    # shell-style tools expose the command/summary
    cmd = raw.get("command") or raw.get("summary") or ""
    if cmd:
        beat = _beat_for_command(str(cmd))
        if beat:
            return beat
    # named tools (file_write, lsp_*, …) — prefer the explicit tool name
    name = raw.get("tool") or update.get("name") or update.get("title") or ""
    return _TOOL_BEATS.get(str(name).lower())


def _outcome_line(update: dict, pending: dict | None, ok: bool) -> str:
    """A GROUNDED, past-tense line for a finished tool — from the real
    ``tool_call_update`` (status + rawOutput), not model prose. This is what the
    on-demand status feed reports, so it can only ever name things that actually
    happened (kills the ``pausemenu.py`` fabrication at the source).
    """
    name = str(update.get("name") or (pending or {}).get("name") or "").lower()
    raw = (pending or {}).get("rawInput") or {}
    # Collapse whitespace/newlines so a chatty command output (e.g. `ls`) stays a
    # single clean, speakable line in the status feed.
    out = _WS.sub(" ", str(update.get("rawOutput") or "").replace("\n", " ")).strip()
    path = raw.get("path") or raw.get("file") or raw.get("filename") or ""
    base = os.path.basename(str(path)) if path else ""
    cmd = str(raw.get("command") or "").strip()
    if not ok:
        # Surface the REAL failure (Rule 4: a plain sentence with the real error,
        # never an invented excuse). Keep it short for the feed.
        err = out or "failed"
        if "file_write" in name and base:
            return f"failed to write {base}: {err[:80]}"
        if name == "shell" and cmd:
            return f"`{_humanize_cmd(cmd, 40)}` failed: {err[:80]}"
        return f"{name or 'tool'} failed: {err[:80]}"
    # success — prefer the tool's own confirmed output, else a concrete line
    if "file_write" in name and base:
        return f"wrote {base}"
    if "file_edit" in name and base:
        return f"edited {base}"
    if name == "shell" and cmd:
        return f"ran `{_humanize_cmd(cmd, 44)}`" + (f" → {out[:60]}" if out else "")
    if out:
        return out[:90]
    if base:
        return f"touched {base}"
    return (name or "tool") + " done"


def _final_say(buf: str) -> str:
    """The brain's final report, cleaned and trimmed to a brief spoken close."""
    s = speechify(buf).strip()
    parts = _SENT_RE.split(s)
    return " ".join(parts[:3]).strip()


def _resumption_intent(intent: str, turn_id: str) -> str:
    """Wrap a re-dispatched intent so a recovered drop is IDEMPOTENT — the brain
    verifies what already landed before redoing anything, so it never double-runs
    (no duplicate files/commits) nor loses the turn. Leans on the durable session
    reload (memory intact across the reconnect) plus the brain's own tools."""
    return (
        f"[Resuming interrupted turn {turn_id}] The connection dropped while you were "
        "working on the request below, so part of it may already be done. FIRST check "
        "the workspace and git state to see what actually landed, then do ONLY what's "
        "still missing — do not redo completed work or create duplicate files or "
        f"commits.\n\nThe request was:\n{intent}"
    )


class Orchestrator:
    """A warm ACP session against the orchestrator. The single brain."""

    def __init__(self) -> None:
        """Initialize the ACP orchestrator client.

        Sets up the connection state machine: process handle, pending RPC
        futures, session tracking, turn lock for serialized brain access,
        reconnection state, and the grounded work journal. Does not connect
        — call ``start()`` to establish the warm ACP session.

        Params:
            None

        Returns:
            None
        """
        self._proc: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task | None = None
        self._stderr_pump: asyncio.Task | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._next = 0
        self.session_id: str | None = None
        # Updates for the in-flight prompt turn land here.
        self._turn_q: asyncio.Queue[dict] | None = None
        # Connection liveness. The orchestrator link can die (a tool the agent
        # runs may tear down the process); we detect that and reconnect rather
        # than wedge silently. `_gen` tags each connection so a stale reader's
        # teardown can't clobber a fresh one's state.
        self._alive = False
        self._gen = 0
        self._reconnect_lock = asyncio.Lock()
        # Serializes brain turns. The ACP session allows exactly ONE active
        # prompt turn — a second concurrent ``session/prompt`` returns
        # ``-32002: Session already has an active prompt turn`` (proven in the
        # 2026-06-02 log: 13 collisions → spurious "say it again" glitches that
        # felt like Koda going deaf). A consumer holds this for the WHOLE turn
        # and releases it only after the turn's response has resolved, so the
        # server's per-session cancel-token is already gone before the next
        # prompt is sent. The lock lives in the consumers (``_ask_brain``,
        # ``_run_job``, ``_prime``), never inside the ``prompt()`` generator —
        # a generator suspended on ``break`` would leak the lock forever.
        self.turn_lock = asyncio.Lock()
        # Set when a conversational turn is cut short by a newer utterance
        # (supersede). The in-flight ``prompt()`` then stays SILENT — it lets
        # the brain end its turn cleanly (freeing the session) without speaking
        # a now-stale partial answer.
        self._superseded = False
        # Grounded durable trail: only VERIFIED tool outcomes are written here, so
        # a lost/partial build never leaves a false "why" for a later recall.
        self._journal = Journal()
        # Did the last handshake RESUME an existing session (vs create fresh)?
        # A resumed session was primed long ago — start() re-sends the current
        # voice primer so updated rules reach it (the primer evolves; the
        # session's copy doesn't).
        self._resumed_session = False

    @property
    def journal(self) -> Journal:
        """The grounded outcome ledger.

        Returns:
            Journal instance recording verified tool outcomes, read by the
            greeting generator and recall paths.
        """
        return self._journal

    # ── lifecycle ──────────────────────────────────────────────────────────
    async def start(self) -> None:
        """Spawn the warm ACP process, handshake, and load-or-create a session."""
        await self._connect()
        await self._handshake_and_session(initial=True)
        await self._seed_recent_work()

    async def _connect(self) -> None:
        """Spawn a fresh ``zeroclaw acp`` (over SSH, or directly when the brain
        is on this same machine) and start the I/O tasks."""
        self._gen += 1
        # Raise the open-file limit (soft 1024 → 65536) before exec'ing the
        # brain: heavy npm/node work under the default 1024 contributes to
        # the EAGAIN/"resource temporarily unavailable" crashes mid-build.
        #
        # Soft containment (no sudo): pin every package-manager / scratch
        # cache INSIDE the workspace so Koda's normal work can't spill into
        # $HOME the way it used to (a 1GB ~/.npm). HOME is left intact so git
        # push, GitHub auth, and the toolchain still resolve. A *deliberate*
        # absolute-path escape is blocked by the firejail jail (separate,
        # needs sudo to install), not by this.
        #
        # ``_SPAWN_ENV`` (set for the peer instance) lets a deployment override
        # env INSIDE the brain process — e.g. HOME-isolating the peer agent away
        # from the host user's credentials.
        extra_env = os.environ.get("KODA_ORCH_SPAWN_ENV", "")  # "K=V K2=V2" pairs
        inner = (
            "ulimit -Sn 65536 2>/dev/null; "
            f"cd {PROJECT_DIR} 2>/dev/null || exit 1; "
            f"export XDG_CACHE_HOME={PROJECT_DIR}/.cache "
            f"npm_config_cache={PROJECT_DIR}/.cache/npm "
            f"YARN_CACHE_FOLDER={PROJECT_DIR}/.cache/yarn "
            f"PNPM_HOME={PROJECT_DIR}/.cache/pnpm"
            + (f" {extra_env}" if extra_env else "")
            + f"; exec {REMOTE_BIN} acp"
        )
        if VPS_HOST in ("local", "localhost-direct", ""):
            # The brain lives on THIS machine (the VPS deployment): spawn it
            # directly — no loopback sshd dependency, no handshake latency,
            # one less thing that can drop mid-turn.
            argv = ["bash", "-lc", inner]
        else:
            argv = [
                "ssh",
                "-o", "ConnectTimeout=20",
                "-o", "BatchMode=yes",
                "-o", "ServerAliveInterval=15",
                VPS_HOST,
                f"bash -lc '{inner}'",
            ]
        self._proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._alive = True
        self._reader = asyncio.create_task(self._read_loop(self._gen))
        self._stderr_pump = asyncio.create_task(self._drain_stderr())

    async def _handshake_and_session(self, initial: bool) -> None:
        init = await self._call("initialize", {})
        logger.info(f"[acp] connected: {init.get('agentInfo', {}).get('title', 'zeroclaw')}")

        sid = self.session_id or self._read_cached_session()
        if sid and await self._try_load(sid):
            self.session_id = sid
            self._resumed_session = True
            logger.info(f"[acp] {'resumed' if initial else 'reconnected to'} session {sid} (memory intact)")
            return

        res = await self._call(
            "session/new", {"agentAlias": AGENT_ALIAS, "cwd": PROJECT_DIR}
        )
        self._resumed_session = False
        self.session_id = res["sessionId"]
        self._write_cached_session(self.session_id)
        logger.info(f"[acp] new session {self.session_id} cwd={PROJECT_DIR}")
        await self._prime()

    async def _ensure_alive(self) -> None:
        """Reconnect if the orchestrator link has died since the last turn."""
        if not self._alive or not self._proc or self._proc.returncode is not None:
            await self._reconnect()

    async def _reconnect(self) -> None:
        """Tear down the dead link and stand up a fresh one, reloading the same
        session so memory survives. Serialized so concurrent turns reconnect once."""
        async with self._reconnect_lock:
            if self._alive and self._proc and self._proc.returncode is None:
                return  # another turn already restored the link
            logger.warning("[acp] orchestrator link down — reconnecting")
            for task in (self._reader, self._stderr_pump):
                if task:
                    task.cancel()
            if self._proc and self._proc.returncode is None:
                try:
                    self._proc.kill()
                except ProcessLookupError:
                    pass
            self._fail_pending(ConnectionResetError("reconnecting"))

            last_err: Exception | None = None
            for attempt in range(3):
                try:
                    await self._connect()
                    await self._handshake_and_session(initial=False)
                    return
                except Exception as e:  # retry any failure (overloaded VPS, ssh hiccup)
                    last_err = e
                    self._alive = False
                    logger.warning(f"[acp] reconnect attempt {attempt + 1}/3 failed: {e}")
                    await asyncio.sleep(1.5 * (attempt + 1))
            raise ConnectionResetError(f"could not reconnect to orchestrator: {last_err}")

    def _fail_pending(self, exc: Exception) -> None:
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()

    async def _prime(self) -> None:
        """Scope voice-style behaviour to THIS session without touching the
        agent's global identity (which Telegram shares). Loaded sessions already
        carry this instruction in their history, so we only prime new ones.

        Deliberately does NOT take ``turn_lock``: priming only runs at fresh
        startup (uncontended) or inside a reconnect that a consumer triggered
        while holding the lock — taking it here would deadlock, and we don't
        need to, since that consumer is paused mid-reconnect and nothing else
        can send a competing prompt.
        """
        try:
            async for _ in self.prompt(_VOICE_PRIMER):
                pass  # swallow the acknowledgement; nothing to speak
        except Exception:
            logger.warning("[acp] voice primer failed; continuing unprimed")

    async def _seed_recent_work(self) -> None:
        """Ground the brain in what ACTUALLY happened recently (Plan
        GenuineConversation A1 — kills "I'm not sure what you're referring to").

        One silent turn at startup, before the user joins: a compact digest of
        the journal tail — verified outcomes only, never recollection — plus,
        on a RESUMED session, the current voice primer (the session's old copy
        may be stale; new sessions were just primed by ``_prime``). Runs only
        from ``start()`` (uncontended), never on mid-turn reconnects."""
        parts: list[str] = []
        if self._resumed_session:
            parts.append(_VOICE_PRIMER)
        digest = self._journal.digest()
        if digest:
            parts.append(
                "[Grounded work log] Below is the verified record of your most "
                "recent work — real tool outcomes from your journal, facts only. "
                "When I ask about recent work ('what did you just do/clone/"
                "write?'), answer from THIS record first; trust it over your own "
                "recollection. Never claim work that isn't in it or otherwise "
                "verified.\n"
                f"{digest}"
            )
        if not parts:
            return
        try:
            async for _ in self.prompt("\n\n".join(parts) + "\n\nAcknowledge with just: got it."):
                pass  # swallow the acknowledgement; nothing to speak
        except Exception:
            logger.warning("[acp] recent-work seed failed; continuing unseeded")

    async def _try_load(self, session_id: str) -> bool:
        # session/load replays history as session/update notifications BEFORE
        # returning. _turn_q is None here, so they're harmlessly dropped — we
        # don't want to speak the backlog, just restore the agent's memory.
        try:
            await self._call("session/load", {"sessionId": session_id})
            return True
        except AcpError as e:
            logger.warning(f"[acp] could not load {session_id} ({e.message}); starting fresh")
            return False

    async def close(self) -> None:
        """Shut down the ACP process and I/O tasks.

        Marks the connection as not alive, cancels the reader and stderr
        pump tasks, and terminates the subprocess. Safe to call multiple
        times — no-op after the first close. Swallows ProcessLookupError
        if the process already exited.

        Params:
            None

        Returns:
            None
        """
        self._alive = False
        for task in (self._reader, self._stderr_pump):
            if task:
                task.cancel()
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
            except ProcessLookupError:
                pass

    # ── prompting ──────────────────────────────────────────────────────────
    async def prompt(self, text: str) -> AsyncIterator[Event]:
        """Run one orchestrator turn, streaming narration beats then the answer.

        Only one prompt may be active per session, so callers MUST hold
        ``turn_lock`` for the whole turn (``_ask_brain`` / ``_run_job`` /
        ``_prime`` do). A newer utterance ends this turn via ``supersede()``
        (a clean ``session/cancel``), not by task-cancellation.
        """
        if not self.session_id:
            raise RuntimeError("orchestrator session not started")

        # Fresh turn: not yet superseded. (We hold turn_lock, so no other turn
        # can flip this underneath us.)
        self._superseded = False

        # Heal a dead link before sending, so the user's next utterance after a
        # drop just works (reconnect reloads the session — memory intact).
        try:
            await self._ensure_alive()
        except Exception:
            yield Event("error", _RECONNECT_FAILED)
            return

        q: asyncio.Queue[dict] = asyncio.Queue()
        self._turn_q = q
        loop = asyncio.get_running_loop()
        req_id = self._next_id()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut
        last_beat: str | None = None
        text_buf = ""       # accumulates streamed answer tokens
        streamed = False    # did we already speak streamed answer text?
        # Correlate a tool_call (pending) with its tool_call_update (outcome) by id,
        # so a spoken milestone fires only AFTER the tool actually succeeds, and the
        # status feed records only confirmed outcomes. Keyed by toolCallId.
        pending_tools: dict[str, dict] = {}
        try:
            await self._send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "method": "session/prompt",
                    "params": {"sessionId": self.session_id, "prompt": text},
                }
            )
            # Stream updates as they arrive and speak the answer sentence-by-
            # sentence, so a long reply starts almost immediately instead of
            # after the whole turn finishes. Tool calls become activity beats.
            #
            # STALL WATCHDOG: if the orchestrator goes completely silent for
            # STALL_TIMEOUT (no chunk, no tool event, no result) — e.g. the
            # provider rate-limited it and it died — we abort gracefully instead
            # of awaiting forever. This is what kills the "stopped responding"
            # freeze. The timeout is generous so a legitimately long one-shot
            # tool run (npm install/build) is not mistaken for a stall.
            while not (fut.done() and q.empty()):
                getter = asyncio.create_task(q.get())
                done, _ = await asyncio.wait(
                    {getter, fut}, timeout=STALL_TIMEOUT,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:  # nothing happened for STALL_TIMEOUT → stalled
                    getter.cancel()
                    logger.warning("[acp] turn stalled (no events for %ss); aborting", STALL_TIMEOUT)
                    await self.cancel()
                    yield Event(
                        "error",
                        "I got stuck on that one — the model went quiet on me. "
                        "Want me to pick it back up?",
                    )
                    return
                if not getter.done():
                    getter.cancel()
                    continue
                update = getter.result()
                kind = update.get("sessionUpdate")
                # Diagnostic (Pillar 1): dump the raw tool-call update — including
                # rawInput, the args the model actually produced — so we can see
                # whether malformed file_write/shell calls are a model fault (missing
                # arg) or a parser fault (arg present but dropped). Off unless
                # KODA_DEBUG_TOOLCALLS is set; never noisy in normal runs.
                if kind in ("tool_call", "tool_call_update") and os.environ.get("KODA_DEBUG_TOOLCALLS"):
                    logger.warning("[toolcall-raw] " + json.dumps(update)[:1500])
                if kind == "tool_call":
                    # A tool STARTED — in-flight, NOT yet confirmed. Show it as the
                    # current action; stash it (with its would-be milestone beat) so
                    # we can speak/confirm only once its outcome lands.
                    tcid = str(update.get("toolCallId") or update.get("toolCallId") or id(update))
                    desc = _describe_tool(update)
                    pending_tools[tcid] = {
                        "name": update.get("name") or update.get("title"),
                        "rawInput": update.get("rawInput") or {},
                        "beat": _beat_for_tool_call(update),
                    }
                    if desc:
                        yield Event("tool_start", desc, tool=str(update.get("name") or ""))
                elif kind == "tool_call_update":
                    # A tool FINISHED — the grounded truth. Record the real outcome
                    # and, only on SUCCESS, speak the milestone (now it's earned).
                    tcid = str(update.get("toolCallId") or "")
                    status = str(update.get("status") or "").lower()
                    pend = pending_tools.pop(tcid, None)
                    if status in ("completed", "failed", "error"):
                        ok = status == "completed"
                        line = _outcome_line(update, pend, ok)
                        yield Event(
                            "tool_done", line, ok=ok,
                            tool=str(update.get("name") or (pend or {}).get("name") or ""),
                        )
                        beat = (pend or {}).get("beat")
                        if ok and beat and beat != last_beat:
                            last_beat = beat
                            yield Event("narration", beat)  # spoken — and now grounded
                elif kind == "agent_thought_chunk":
                    th = (update.get("content") or {}).get("text", "")
                    if th:
                        yield Event("thought", th)  # silent — the brain's reasoning
                elif kind == "agent_message_chunk":
                    text_buf += (update.get("content") or {}).get("text", "")
                    sentences, text_buf = _split_sentences(text_buf)
                    for s in sentences:
                        spoken = speechify(s)
                        # Superseded → go silent: a newer utterance is taking
                        # over, so don't speak this now-stale partial answer.
                        if spoken and not self._superseded:
                            streamed = True
                            yield Event("say", spoken)

            result = fut.result()  # raises if the link died / server errored
            tail = speechify(text_buf)
            if tail and not self._superseded:
                streamed = True
                yield Event("say", tail)
            if not streamed and not self._superseded:
                # model returned only a final content blob (no token stream)
                ans = speechify(result.get("content", "") or "")
                yield Event("say", ans or "Okay, done.", stop_reason=result.get("stopReason"))
            return
        except (ConnectionResetError, BrokenPipeError):
            # The brain link dropped mid-turn (a tool tore down the process, or
            # the box hiccuped). Heal the link silently and signal the caller to
            # re-dispatch — the work finishes instead of being announced and lost.
            # The user never hears "I lost my connection to the workspace".
            logger.warning("[acp] link dropped mid-turn; reconnecting silently")
            self._turn_q = None
            self._pending.pop(req_id, None)
            try:
                await self._reconnect()
            except Exception:
                yield Event("reconnect_failed", _RECONNECT_FAILED)
                return
            # Recovered (session reloaded, memory intact). Stay silent.
            yield Event("reconnected", "")
            return
        except AcpError as e:
            logger.warning(f"[acp] server error mid-turn: {e}")
            yield Event("error", random.choice(_GLITCH_LINES))
            return
        except Exception:
            logger.exception("[acp] unexpected prompt failure")
            yield Event("error", random.choice(_GLITCH_LINES))
            return
        finally:
            self._turn_q = None
            self._pending.pop(req_id, None)

    # ── background work ──────────────────────────────────────────────────────
    async def start_job(
        self,
        intent: str,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None = None,
    ) -> WorkJob:
        """Dispatch real engineering work to the brain as a BACKGROUND job.

        Returns immediately. The job runs to completion on its own task and only
        speaks real milestones and its final verified result (via ``speak``).
        Ongoing chat never cancels it, and never collides with it — chat is
        answered off the ACP session, so the session is the job's alone.

        ``phrase`` (Decision 7, LLM-first beats): an optional async rephraser that
        turns a canonical milestone beat into Koda's own warm spoken line. The
        JOURNAL and the job feed always record the canonical grounded beat —
        only the SPOKEN words go through ``phrase``; any failure falls back to
        the canonical line, so warmth can never cost truth or a lost milestone.
        """
        job = WorkJob(
            intent=intent, turn_id=uuid.uuid4().hex[:12], started_at=time.monotonic()
        )
        self._journal.job_start(job.turn_id, intent, project=PROJECT_DIR)
        job._task = asyncio.create_task(self._run_job(job, speak, phrase))
        return job

    async def _run_job(
        self,
        job: WorkJob,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None = None,
    ) -> None:
        MAX_REDISPATCH = 2
        attempt = 0
        buf = ""
        try:
            while True:
                # On a re-dispatch (the link dropped mid-turn), send a RESUMPTION
                # wrapper so the brain verifies what already landed before redoing
                # anything — a recovered drop is idempotent (no double-run, no lost
                # turn). The first attempt sends the raw intent.
                send_text = job.intent if attempt == 0 else _resumption_intent(job.intent, job.turn_id)
                # Hold the brain's turn-lock for the WHOLE turn so a concurrent
                # recall can't fire a second session/prompt and trigger -32002.
                # A job owns the brain; conversational turns are deferred while
                # it runs (see main.py), so this never starves chat.
                async with self.turn_lock:
                    async for ev in self.prompt(send_text):
                        if ev.kind == "narration":          # a real milestone beat
                            job.milestones.append(ev.text)
                            job.rev += 1
                            self._journal.milestone(job.turn_id, ev.text)
                            # Speak Koda's own phrasing of the beat (LLM-first,
                            # grounded); the canonical line is the fallback.
                            spoken = ev.text
                            if phrase is not None:
                                try:
                                    spoken = (await phrase(ev.text)) or ev.text
                                except Exception:
                                    spoken = ev.text
                            await speak(spoken)
                        elif ev.kind == "tool_start":       # a tool began — in-flight, silent
                            job.note_inflight(ev.text)
                        elif ev.kind == "tool_done":        # a tool finished — GROUNDED outcome, silent
                            job.note_done(ev.text, bool(ev.ok))
                            # Durable trail: write ONLY verified outcomes (Rule 4).
                            self._journal.outcome(job.turn_id, ev.text, bool(ev.ok))
                        elif ev.kind == "thought":          # brain's reasoning — silent, for status/depth
                            job.note_thought(ev.text)
                        elif ev.kind == "say":              # brain's words — silent mid-build
                            buf += " " + ev.text
                        elif ev.kind == "reconnected":
                            # Link blipped; this turn was lost. Re-dispatch silently so
                            # the work actually finishes (memory survived the reload).
                            break
                        elif ev.kind in ("reconnect_failed", "error"):
                            job.status = "failed"
                            job.error = ev.text
                            self._journal.job_end(job.turn_id, "failed", ev.text, job.redispatches)
                            await speak(ev.text)
                            return
                    else:
                        # async-for completed with no `break` → the turn ended normally.
                        final = _final_say(buf)
                        job.result = final
                        job.status = "done"
                        job.pending_question = final.rstrip().endswith("?")
                        self._journal.job_end(job.turn_id, "done", final, job.redispatches)
                        await speak(final or "Okay, that's done.")
                        return
                # We broke out on a reconnect → retry the SAME turn silently.
                attempt += 1
                job.redispatches = attempt
                self._journal.redispatch(job.turn_id, attempt)
                if attempt > MAX_REDISPATCH:
                    job.status = "failed"
                    job.error = "link kept dropping"
                    self._journal.job_end(job.turn_id, "failed", "link kept dropping", job.redispatches)
                    await speak(
                        "I keep losing the workspace connection on that one — "
                        "want me to try again?"
                    )
                    return
                buf = ""
        except asyncio.CancelledError:
            job.status = "cancelled"
            self._journal.job_end(job.turn_id, "cancelled", "", job.redispatches)
            raise
        except Exception as e:
            logger.exception("[acp] background job failed")
            job.status = "failed"
            job.error = str(e)
            self._journal.job_end(job.turn_id, "failed", str(e), job.redispatches)
            await speak("That one hit a wall on me — want me to take another run at it?")

    async def stop_job(self, job: WorkJob | None) -> None:
        """Explicitly abort a running job (only when the user says so, e.g. 'stop')."""
        if job is None or not job.running:
            return
        if job._task and not job._task.done():
            job._task.cancel()
        await self.cancel()

    async def supersede(self) -> None:
        """End an in-flight CONVERSATIONAL turn cleanly so the next utterance can
        run without a -32002 collision.

        A newer utterance has arrived (or the user barged in). We mark the turn
        superseded (it stops speaking its now-stale answer) and fire
        ``session/cancel``: the brain aborts the turn, sends its response, and
        only then is its per-session cancel-token removed. The consumer holding
        ``turn_lock`` releases it once that response lands — so the next prompt
        sees a free session. No task-cancellation, no await-during-cancel.

        The CALLER must guarantee no WorkJob is running: a job's turn is the
        user's actual build and is never ended by chatter (Constitution Rule 3 —
        talking never kills the work). No-op if nothing is in flight.
        """
        if self._turn_q is None:
            return  # no active turn to end
        self._superseded = True
        await self.cancel()

    @staticmethod
    def _beat(update: dict) -> str | None:
        if update.get("sessionUpdate") == "tool_call":
            return _beat_for_tool_call(update)
        return None

    async def cancel(self) -> None:
        """Abort the in-flight turn (barge-in). Best-effort: never raises, and a
        noop if nothing is running or the link is down."""
        if not self.session_id or not self._alive:
            return
        try:
            await self._send(
                {
                    "jsonrpc": "2.0",
                    "method": "session/cancel",
                    "params": {"sessionId": self.session_id},
                }
            )
        except (ConnectionResetError, BrokenPipeError):
            self._alive = False

    # ── JSON-RPC plumbing ──────────────────────────────────────────────────
    def _next_id(self) -> int:
        self._next += 1
        return self._next

    async def _call(self, method: str, params: dict) -> dict:
        loop = asyncio.get_running_loop()
        req_id = self._next_id()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut
        await self._send(
            {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        )
        return await fut

    async def _send(self, msg: dict) -> None:
        if not self._proc or self._proc.stdin is None or self._proc.returncode is not None:
            self._alive = False
            raise ConnectionResetError("orchestrator process is not running")
        try:
            self._proc.stdin.write((json.dumps(msg) + "\n").encode())
            await self._proc.stdin.drain()
        except (ConnectionResetError, BrokenPipeError):
            self._alive = False
            raise

    async def _read_loop(self, gen: int) -> None:
        assert self._proc and self._proc.stdout
        try:
            while True:
                line = await self._proc.stdout.readline()
                if not line:
                    break  # EOF — the acp process exited
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._dispatch(msg)
        finally:
            # Only the *current* connection's reader may mutate liveness, so a
            # stale reader being torn down during reconnect can't flip a fresh
            # link to dead. Failing pending futures unblocks any awaiting turn.
            if gen == self._gen:
                self._alive = False
                self._fail_pending(ConnectionResetError("orchestrator connection closed"))

    def _dispatch(self, msg: dict) -> None:
        # response to one of our requests
        if "id" in msg and ("result" in msg or "error" in msg):
            fut = self._pending.get(msg["id"])
            if fut and not fut.done():
                if "error" in msg:
                    fut.set_exception(AcpError(msg["error"]))
                else:
                    fut.set_result(msg.get("result") or {})
            return
        method = msg.get("method")
        if method in ("session/update", "session/event"):
            update = (msg.get("params") or {}).get("update")
            if update is not None and self._turn_q is not None:
                self._turn_q.put_nowait(update)
        elif method == "session/request_permission":
            # Full-autonomy posture: auto-approve. (In `full` mode this should
            # not fire, but answer defensively so a turn never hangs.)
            asyncio.create_task(self._auto_allow(msg))

    async def _auto_allow(self, msg: dict) -> None:
        options = (msg.get("params") or {}).get("options") or []
        pick = next(
            (o["optionId"] for o in options if o.get("kind") in ("allow_once", "allow_always")),
            options[0]["optionId"] if options else "allow-once",
        )
        await self._send(
            {
                "jsonrpc": "2.0",
                "id": msg.get("id"),
                "result": {"outcome": {"outcome": "selected", "optionId": pick}},
            }
        )

    async def _drain_stderr(self) -> None:
        assert self._proc and self._proc.stderr
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                break
            logger.debug(f"[acp-stderr] {line.decode('utf-8', 'replace').rstrip()}")

    # ── session cache ──────────────────────────────────────────────────────
    @staticmethod
    def _read_cached_session() -> str | None:
        try:
            sid = SESSION_CACHE.read_text().strip()
            return sid or None
        except OSError:
            return None

    @staticmethod
    def _write_cached_session(session_id: str) -> None:
        try:
            SESSION_CACHE.write_text(session_id + "\n")
        except OSError as e:
            logger.warning(f"[acp] could not cache session id: {e}")


if __name__ == "__main__":
    import sys

    async def _main() -> None:
        orch = Orchestrator()
        await orch.start()
        prompt = sys.argv[1] if len(sys.argv) > 1 else "Say hello in one short sentence."
        async for ev in orch.prompt(prompt):
            print(f"[{ev.kind}] {ev.text}")
        await orch.close()

    asyncio.run(_main())
