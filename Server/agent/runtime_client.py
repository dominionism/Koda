"""Voice↔Runtime Bridge — run a spoken work request in a disposable box.

This is the WORK backend the voice tier uses when the managed Runtime Layer is
active (``KODA_USE_RUNTIME_JOBS=1``). It is the third generation of "the thing
the gateway calls when you ask for work":

- ``acp_client.Orchestrator`` → the ZeroClaw brain on the VPS (dormant).
- ``koda_backend_client`` (on ``next`` only) → the laptop-operator MVP.
- **this module** → a per-job Firecracker-bound container from the Runtime
  Layer, reached over the runtime HTTP API. The gateway never touches Docker;
  everything goes through ``KODA_RUNTIME_URL`` (managed-tier correct — when
  Docker becomes Firecracker-in-Kubernetes, only the server behind that URL
  changes, not this file).

It presents the EXACT surface the voice tier already consumes —
``start_job(intent, speak, phrase=None) -> WorkJob`` and ``stop_job(job)``,
the same contract as ``Orchestrator`` — so ``OrchestratorProcessor``'s status /
depth / proactive / journal / warmth machinery is reused untouched, and the
persona stays one Koda (ADR-0005).

Grounding (Constitution Rule 4) is preserved: a milestone is spoken only after
a ``tool_call_update`` reports ``status=completed``; the journal records only
verified outcomes; a failure speaks its real error, never an invented reason.
Brevity (Rule 2): only edit-kind completions earn speech — reads/searches feed
the on-demand status trail silently.

Lifecycle (v1): one box per WorkJob — create → prompt → destroy, always
destroyed in a ``finally``. Nothing persists between jobs, which is how this
sidesteps the still-open team Question 3 (workspace persistence / volume
retention). Warm boxes and concurrent jobs are deliberately out of scope.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Awaitable, Callable
from urllib.parse import urljoin

import httpx
from loguru import logger

# Reuse the voice tier's grounded state object and speech cleanup verbatim, and
# the durable journal — so recall / greeting / status read this runner's work
# exactly as they read the brain's. WorkJob is the shared internal protocol.
from acp_client import WorkJob, speechify, _final_say
from journal import Journal

# ── configuration (env) ──────────────────────────────────────────────────────
RUNTIME_URL = os.environ.get("KODA_RUNTIME_URL", "http://localhost:3100")
RUNTIME_TOKEN = os.environ.get("KODA_RUNTIME_TOKEN", "")
# Workspace identity base. One box per job, so the effective userId is
# ``{base}-{turn_id}`` — unique per job, which keeps container names
# (``koda-{userId}``) from colliding and makes 409-on-create impossible in the
# normal flow. The managed tier will map a real user here; for the v1 demo the
# per-job identity is exactly right (each job is its own throwaway box).
RUNTIME_USER_BASE = os.environ.get("KODA_RUNTIME_USER_ID", "dev")
# The project the job runs in — recorded in the journal so "what did we work on
# last?" is a field lookup. Inside the box the cwd is always ``/workspace``.
RUNTIME_PROJECT = os.environ.get("KODA_RUNTIME_PROJECT", "runtime-workspace")
# Overall wall-clock ceiling for one job (create + prompt + destroy). Generous:
# a real build can take minutes. The client itself no longer hangs (the #190
# coalesced-frame fix), so this only fires on a genuinely stuck upstream model.
JOB_DEADLINE_SECS = float(os.environ.get("KODA_RUNTIME_JOB_DEADLINE", "300"))
# How long the box gets to boot before the first prompt. connectACP + handshake
# add a little more; the HTTP client's read side is unbounded (streams are long).
CONNECT_TIMEOUT_SECS = float(os.environ.get("KODA_RUNTIME_CONNECT_TIMEOUT", "15"))
# Which coding agent runs in the box. The runtime layer accepts 'opencode'
# (free default model) or 'omp'. OMP is the team's launch default, but it needs
# a model + provider config to run (BYOK), so the bridge's own default stays
# 'opencode' — set KODA_RUNTIME_AGENT=omp and supply the OMP_* config below.
RUNTIME_AGENT = os.environ.get("KODA_RUNTIME_AGENT", "opencode").strip().lower()
# OMP config forwarded into the box. OMP has no env overrides for its model or
# providers — the image's omp-launch shim writes ~/.omp/agent/{config,models}.yml
# from these at boot (the BYOK file-injection path; the user's API key rides
# inside OMP_MODELS_YML). Only forwarded when the OMP agent is selected.
_OMP_ENV_KEYS = ("OMP_CONFIG_YML", "OMP_MODELS_YML", "OMP_ACP_ARGS")


def _box_env() -> dict[str, str]:
    """Per-box env for the selected agent. Opencode needs nothing (free default);
    OMP needs its config files materialized from these keys by the image shim."""
    if RUNTIME_AGENT != "omp":
        return {}
    return {k: os.environ[k] for k in _OMP_ENV_KEYS if os.environ.get(k)}


class RuntimeClient:
    """Thin async transport over the runtime HTTP API. No business logic.

    Owns one ``httpx.AsyncClient``. Read timeouts are disabled because a prompt
    stream stays silent for as long as the model thinks; connect/write are
    bounded so a dead server surfaces fast.
    """

    def __init__(self, base_url: str = RUNTIME_URL, token: str = RUNTIME_TOKEN) -> None:
        self._base = base_url.rstrip("/") + "/"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._http = httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(None, connect=CONNECT_TIMEOUT_SECS),
        )

    def _url(self, path: str) -> str:
        return urljoin(self._base, path.lstrip("/"))

    async def create_workspace(
        self, user_id: str, agent: str = "opencode", env: dict[str, str] | None = None
    ) -> str:
        """POST /workspaces → the new workspace id. ``agent`` selects the coding
        CLI ('opencode' | 'omp'); ``env`` carries its per-box config (the OMP
        model/provider files, or a BYOK key). No key is logged by this process;
        opencode with empty env uses its free default model."""
        resp = await self._http.post(
            self._url("workspaces"),
            json={"userId": user_id, "agent": agent, "env": env or {}},
        )
        resp.raise_for_status()
        return resp.json()["workspace"]["id"]

    async def prompt_stream(self, workspace_id: str, text: str):
        """POST /workspaces/:id/prompt → async iterator of decoded event dicts.

        Yields one dict per nd-JSON line the server streams (the #188 event
        shapes and the terminal ``result`` / ``error`` line). Raises on a
        non-200 (the handshake failed before streaming began)."""
        url = self._url(f"workspaces/{workspace_id}/prompt")
        async with self._http.stream("POST", url, json={"text": text}) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "replace")
                raise RuntimeError(f"prompt failed ({resp.status_code}): {body[:200]}")
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    logger.warning(f"[runtime] undecodable stream line: {line[:120]!r}")

    async def destroy_workspace(self, workspace_id: str) -> None:
        """DELETE /workspaces/:id. A 404 is fine — the box is already gone."""
        try:
            resp = await self._http.delete(self._url(f"workspaces/{workspace_id}"))
            if resp.status_code not in (204, 404):
                logger.warning(
                    f"[runtime] destroy {workspace_id} returned {resp.status_code}"
                )
        except httpx.HTTPError as e:
            # Best-effort teardown — never let cleanup crash a job's finally.
            logger.warning(f"[runtime] destroy {workspace_id} failed: {e}")

    async def aclose(self) -> None:
        await self._http.aclose()


# ── OpenCode tool vocabulary → grounded spoken/feed lines ─────────────────────
# OpenCode's ACP wire (pinned 1.17.11, proven in the vendored toolcall fixture
# and the 2026-07-19 live probe) names tools by ``title`` on the pending
# ``tool_call`` ('write' / 'read' / 'glob' / 'edit' / 'bash') and by PATH on the
# completed ``tool_call_update`` ('workspace/hello.txt'), with a ``kind``
# category ('edit' / 'read' / 'search'). We capture the verb from the pending
# event (keyed by tool id) and pair it with the path on completion — the same
# pending→outcome correlation the ZeroClaw path uses, but honest to OpenCode's
# own smaller wire (so ``_describe_tool`` / ``_outcome_line`` in acp_client are
# deliberately NOT reused — they key on ZeroClaw's ``rawInput``/tool names).

# Verbs whose COMPLETION Koda speaks aloud (Rule 2: only real edits are
# milestones; reads and searches stay in the silent status feed).
_SPOKEN_VERBS = {"write", "edit"}

# OpenCode names its pending tool by the bare verb (title='write'|'read'|'glob'|
# 'edit'|'bash'); OMP names it in prose (title='Create hello.txt') and only its
# ACP ``kind`` is reliable. Derive one canonical verb from both so the narration
# is honest for either agent.
_KNOWN_VERBS = {"write", "edit", "read", "glob", "grep", "list", "search", "bash", "run"}
# ``kind`` is the agent-agnostic category. 'edit' → 'write' so an OMP file
# creation speaks as "wrote <file>" (true for a create/overwrite — the demo's
# finish line), matching OpenCode's own write path.
_KIND_VERB = {"edit": "write", "read": "read", "search": "search"}


def _canonical_verb(title: str, kind: str) -> str:
    """Map an agent's tool title+kind to one verb. A recognized verb in the
    title wins (OpenCode); else fall back to the ACP ``kind`` (OMP)."""
    t = (title or "").strip().lower()
    first = t.split()[0] if t else ""
    if first in _KNOWN_VERBS:
        return first
    if t in _KNOWN_VERBS:
        return t
    return _KIND_VERB.get((kind or "").strip().lower(), "")


def _first_location_path(locations: object) -> str:
    """First file path from an ACP ``locations`` array (OMP's path source), else ''."""
    if isinstance(locations, list):
        for loc in locations:
            if isinstance(loc, dict) and isinstance(loc.get("path"), str) and loc["path"]:
                return loc["path"]
    return ""


def _basename(title: str) -> str:
    return os.path.basename(title.rstrip("/")) if title else ""


def _inflight_line(verb: str, title: str, kind: str) -> str:
    """A present-tense, unconfirmed activity line for the status feed."""
    base = _basename(title)
    if verb == "write":
        return f"writing {base}" if base else "writing a file"
    if verb == "edit":
        return f"editing {base}" if base else "editing a file"
    if verb == "read":
        return f"reading {base}" if base else "reading a file"
    if kind == "search" or verb in ("glob", "grep", "list", "search"):
        return "searching the project"
    if verb == "bash":
        return "running a command"
    label = (title or verb or kind or "working").replace("/", " ")
    return f"working: {label}" if label else "working"


def _outcome_line(verb: str, title: str, kind: str, ok: bool, err: str) -> str:
    """A grounded, PAST-tense line for a finished tool — the only thing that
    becomes 'what Koda actually did'. On completion ``title`` is the path."""
    base = _basename(title)
    if not ok:
        detail = f": {err[:80]}" if err else ""
        if verb in ("write", "edit") and base:
            return f"failed to {verb} {base}{detail}"
        return f"{verb or kind or 'tool'} failed{detail}"
    if verb == "write":
        return f"wrote {base}" if base else "wrote a file"
    if verb == "edit":
        return f"edited {base}" if base else "edited a file"
    if verb == "read":
        return f"read {base}" if base else "read a file"
    if kind == "search" or verb in ("glob", "grep", "list", "search"):
        return "searched the project"
    if verb == "bash":
        return "ran a command"
    if base:
        return f"touched {base}"
    return (verb or kind or "tool") + " done"


class RuntimeJobRunner:
    """The WORK backend: presents ``start_job`` / ``stop_job`` like Orchestrator,
    but each job runs in its own disposable Runtime box."""

    def __init__(self, client: RuntimeClient, journal: Journal) -> None:
        self._client = client
        self._journal = journal
        # turn_id → workspace_id, so a job's ``finally`` can always destroy its
        # box even if it was cancelled mid-create.
        self._workspaces: dict[str, str] = {}

    @property
    def journal(self) -> Journal:
        return self._journal

    async def start(self) -> None:
        """Symmetry with Orchestrator.start(); nothing to warm up per-job."""
        logger.info(f"[runtime] work backend ready → {RUNTIME_URL}")

    async def close(self) -> None:
        await self._client.aclose()

    async def start_job(
        self,
        intent: str,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None = None,
    ) -> WorkJob:
        """Dispatch real work to a fresh box as a BACKGROUND job. Returns
        immediately; the job runs on its own task and speaks only grounded
        milestones and its final verified result (via ``speak``).

        ``async`` to match ``Orchestrator.start_job`` exactly, so both work
        backends are interchangeable behind one call site."""
        job = WorkJob(
            intent=intent, turn_id=_new_turn_id(), started_at=time.monotonic()
        )
        self._journal.job_start(job.turn_id, intent, project=RUNTIME_PROJECT)
        job._task = asyncio.create_task(self._run_job(job, speak, phrase))
        return job

    async def stop_job(self, job: WorkJob | None) -> None:
        """Abort a running job (only on explicit user 'stop'). Cancelling the
        task triggers its ``finally`` → the box is destroyed. Destroy IS the
        abort — a disposable box needs no graceful in-box cancel."""
        if job is None or not job.running:
            return
        if job._task and not job._task.done():
            job._task.cancel()
            try:
                await job._task
            except asyncio.CancelledError:
                pass

    async def _run_job(
        self,
        job: WorkJob,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None = None,
    ) -> None:
        try:
            async with asyncio.timeout(JOB_DEADLINE_SECS):
                await self._drive(job, speak, phrase)
        except asyncio.CancelledError:
            job.status = "cancelled"
            self._journal.job_end(job.turn_id, "cancelled", "", 0)
            raise
        except asyncio.TimeoutError:
            job.status = "failed"
            job.error = "timed out"
            self._journal.job_end(job.turn_id, "failed", "timed out", 0)
            await speak(
                "That one ran past my time limit — the box wasn't answering. "
                "Want me to take another run at it?"
            )
        except Exception as e:
            logger.exception("[runtime] background job failed")
            job.status = "failed"
            job.error = str(e)
            self._journal.job_end(job.turn_id, "failed", str(e), 0)
            await speak("That one hit a wall on me — want me to take another run at it?")
        finally:
            # Always destroy the box, however the job ended (Q3 sidestep:
            # nothing persists). Best-effort — teardown never raises.
            ws_id = self._workspaces.pop(job.turn_id, None)
            if ws_id:
                await self._client.destroy_workspace(ws_id)

    async def _drive(
        self,
        job: WorkJob,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None,
    ) -> None:
        """The one-box job loop: create → stream+narrate → speak final."""
        user_id = f"{RUNTIME_USER_BASE}-{job.turn_id}"
        ws_id = await self._client.create_workspace(user_id, RUNTIME_AGENT, _box_env())
        self._workspaces[job.turn_id] = ws_id

        # Correlate a tool's pending verb with its completion (which carries the
        # path, not the verb). Keyed by the wire ``id``; falls back to the last
        # pending verb when an update omits the id.
        pending: dict[str, dict] = {}
        last_verb = ""
        buf = ""

        async for event in self._client.prompt_stream(ws_id, job.intent):
            etype = event.get("type")

            if etype == "tool_call":  # a tool STARTED — unconfirmed, feed-only
                kind = str(event.get("kind") or "").lower()
                verb = _canonical_verb(str(event.get("title") or ""), kind)
                loc = _first_location_path(event.get("locations"))
                tid = event.get("id")
                if tid:
                    pending[str(tid)] = {"verb": verb, "kind": kind, "path": loc}
                last_verb = verb or last_verb
                # Prefer the structured path; the raw title is OMP prose, but
                # this line is feed-only (silent) so it never reaches speech.
                job.note_inflight(_inflight_line(verb, loc or str(event.get("title") or ""), kind))

            elif etype == "tool_call_update":
                status = str(event.get("status") or "").lower()
                tid = event.get("id")
                prev = pending.get(str(tid), {}) if tid else {}
                verb = prev.get("verb") or last_verb
                kind = str(event.get("kind") or prev.get("kind") or "").lower()
                # The path: OpenCode repeats it in ``title`` on completion; OMP
                # omits ``title`` and gave it on the pending call's ``locations``.
                path = (
                    str(event.get("title") or "")
                    or _first_location_path(event.get("locations"))
                    or str(prev.get("path") or "")
                )
                # An edit is a milestone however the agent labels its verb, so
                # gate on the ACP ``kind`` too — OMP's verb comes from prose and
                # would otherwise slip the {write, edit} check and go unspoken.
                is_edit = verb in _SPOKEN_VERBS or kind == "edit"
                if status == "completed":
                    line = _outcome_line(verb, path, kind, ok=True, err="")
                    job.note_done(line, ok=True)
                    self._journal.outcome(job.turn_id, line, True)
                    if is_edit:  # Rule 2/4: speak only real edits, in warm words
                        await self._speak_milestone(job, line, speak, phrase)
                elif status in ("failed", "error"):
                    err = _content_text(event.get("content"))
                    line = _outcome_line(verb, path, kind, ok=False, err=err)
                    job.note_done(line, ok=False)
                    self._journal.outcome(job.turn_id, line, False)
                    await self._speak_milestone(job, line, speak, phrase)
                # status == in_progress → keep the in-flight line, stay silent

            elif etype == "thought_chunk":
                job.note_thought(str(event.get("text") or ""))

            elif etype == "message_chunk":
                buf += " " + str(event.get("text") or "")

            elif etype == "result":
                final = _final_say(str(event.get("content") or "") or buf)
                job.result = final
                job.status = "done"
                job.pending_question = final.rstrip().endswith("?")
                self._journal.job_end(job.turn_id, "done", final, 0)
                await speak(final or "Okay, that's done.")
                return

            elif etype == "error":
                msg = str(event.get("message") or "the workspace hit an error")
                job.status = "failed"
                job.error = msg
                self._journal.job_end(job.turn_id, "failed", msg, 0)
                await speak(f"That one failed on me: {speechify(msg)[:120]}")
                return

            # usage_update / plan / unknown → protocol noise for the voice tier

        # Stream ended with no terminal result/error line — the box dropped.
        job.status = "failed"
        job.error = "the workspace connection dropped"
        self._journal.job_end(job.turn_id, "failed", "connection dropped", 0)
        await speak("I lost the workspace connection on that one — want me to retry?")

    async def _speak_milestone(
        self,
        job: WorkJob,
        line: str,
        speak: Callable[[str], Awaitable[None]],
        phrase: Callable[[str], Awaitable[str]] | None,
    ) -> None:
        """Record a spoken milestone and say it. The JOURNAL keeps the canonical
        grounded line; only the SPOKEN words go through ``phrase`` (warmth), and
        any failure falls back to the canonical line — warmth never costs a
        milestone (mirrors Orchestrator._run_job)."""
        job.milestones.append(line)
        job.rev += 1
        self._journal.milestone(job.turn_id, line)
        spoken = line
        if phrase is not None:
            try:
                spoken = (await phrase(line)) or line
            except Exception:
                spoken = line
        await speak(spoken)


def _content_text(content: object) -> str:
    """Pull human-readable text out of an ACP content payload (nested blocks or
    a bare string), for a failure's real error message (Rule 4)."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if isinstance(content.get("text"), str):
            return content["text"]
        return _content_text(content.get("content"))
    if isinstance(content, list):
        return " ".join(_content_text(c) for c in content).strip()
    return ""


def _new_turn_id() -> str:
    import uuid

    return uuid.uuid4().hex[:12]


def maybe_runtime_runner() -> RuntimeJobRunner | None:
    """Construct the Runtime work backend iff ``KODA_USE_RUNTIME_JOBS=1``.

    Returns ``None`` in legacy mode, so the gateway falls back to the ZeroClaw
    ``Orchestrator`` for work. Disjoint env names from ``next``'s
    ``KODA_USE_BACKEND_JOBS`` so the two backends can never be confused if the
    lines merge (Research OQ #9)."""
    if os.environ.get("KODA_USE_RUNTIME_JOBS", "0") != "1":
        return None
    logger.info(
        f"[runtime] KODA_USE_RUNTIME_JOBS=1 → work runs in disposable "
        f"{RUNTIME_AGENT} boxes at {RUNTIME_URL}"
    )
    client = RuntimeClient()
    # The runner writes to the SAME journal the brain reads (default path or
    # KODA_JOURNAL_PATH), so recall / greeting / status see runtime work too.
    return RuntimeJobRunner(client, Journal())
