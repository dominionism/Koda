"""Unit tests for the Voice↔Runtime Bridge runner (runtime_client.py).

No network, no Docker: a fake RuntimeClient replays a canned nd-JSON event
stream — the exact #188 AcpEvent shapes the runtime server emits — so the
translation, speech policy (Rule 2/4), grounding, and box lifecycle are
pinned deterministically. Sync tests wrap ``asyncio.run`` so no pytest-asyncio
dependency is needed.
"""

from __future__ import annotations

import asyncio
import os
import sys

# Import the module under test from the agent dir (its siblings — acp_client,
# journal — import by bare name), with a scratch journal so tests never touch
# the real ~/.koda trail.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("KODA_JOURNAL_PATH", "/tmp/koda-test-journal.jsonl")

import runtime_client as rc  # noqa: E402
from runtime_client import RuntimeJobRunner  # noqa: E402
from acp_client import WorkJob  # noqa: E402
from journal import Journal  # noqa: E402


# ── a fake transport that replays canned events ──────────────────────────────
class FakeClient:
    def __init__(self, events, *, fail_create=False):
        self._events = events
        self._fail_create = fail_create
        self.created: list[str] = []
        self.destroyed: list[str] = []
        self.created_agent: str | None = None
        self.created_env: dict[str, str] | None = None

    async def create_workspace(self, user_id: str, agent: str = "opencode", env=None) -> str:
        if self._fail_create:
            raise RuntimeError("create boom")
        self.created.append(user_id)
        self.created_agent = agent
        self.created_env = env or {}
        return f"ws-for-{user_id}"

    async def prompt_stream(self, workspace_id: str, text: str):
        for ev in self._events:
            await asyncio.sleep(0)  # yield control, like a real stream
            yield ev

    async def destroy_workspace(self, workspace_id: str) -> None:
        self.destroyed.append(workspace_id)

    async def aclose(self) -> None:
        pass


# The canonical happy-path stream: search (glob), edit (write), read, then the
# agent's final message and terminal result — the shapes from the vendored
# toolcall fixture, as the server forwards them.
HAPPY_EVENTS = [
    {"type": "thought_chunk", "text": "I'll create the file."},
    {"type": "tool_call", "id": "t1", "title": "glob", "kind": "search", "status": "pending"},
    {"type": "tool_call_update", "id": "t1", "title": "glob", "kind": "search", "status": "in_progress"},
    {"type": "tool_call_update", "id": "t1", "title": "workspace", "kind": "search", "status": "completed"},
    {"type": "tool_call", "id": "t2", "title": "write", "kind": "edit", "status": "pending"},
    {"type": "tool_call_update", "id": "t2", "title": "write", "kind": "edit", "status": "in_progress"},
    {"type": "tool_call_update", "id": "t2", "title": "workspace/hello.txt", "kind": "edit", "status": "completed"},
    {"type": "tool_call", "id": "t3", "title": "read", "kind": "read", "status": "pending"},
    {"type": "tool_call_update", "id": "t3", "title": "workspace/hello.txt", "kind": "read", "status": "completed"},
    {"type": "message_chunk", "text": "Done — I created hello.txt with hello world in it."},
    {"type": "usage_update", "used": 7976},
    {"type": "result", "content": "Done — I created hello.txt with hello world in it.", "stopReason": "end_turn"},
]


# OMP's wire, as the server forwards it: the tool is described in PROSE
# (title a sentence, not a verb), the path rides in `locations` on the pending
# call, and the completed update omits BOTH title and kind. This is the shape
# the OpenCode-tuned vocabulary used to miss — the bridge must still speak
# "wrote hello.txt" (proven live against OMP 17.0.8 on 2026-07-23).
OMP_EVENTS = [
    {"type": "thought_chunk", "text": "The user wants a file."},
    {"type": "tool_call", "id": "c1", "title": "Create hello.txt", "kind": "edit",
     "status": "pending", "locations": [{"path": "/workspace/hello.txt"}]},
    {"type": "tool_call_update", "id": "c1", "status": "in_progress"},
    {"type": "tool_call_update", "id": "c1", "status": "completed",
     "content": [{"type": "text", "text": "Successfully wrote 11 bytes to hello.txt"}]},
    {"type": "message_chunk", "text": "Done — created hello.txt with hello world."},
    {"type": "usage_update", "used": 6116},
    {"type": "result", "content": "Done — created hello.txt with hello world.", "stopReason": "end_turn"},
]


def _run(runner: RuntimeJobRunner, intent: str) -> tuple[list[str], WorkJob]:
    """Drive one job to completion, capturing everything spoken."""
    spoken: list[str] = []

    async def speak(text: str) -> None:
        spoken.append(text)

    async def go() -> WorkJob:
        job = await runner.start_job(intent, speak)
        assert job._task is not None
        await job._task  # runner runs the job on its own task
        return job

    job = asyncio.run(go())
    return spoken, job


def _fresh_runner(events, **kw):
    client = FakeClient(events, **kw)
    journal = Journal("/tmp/koda-test-journal.jsonl")
    return RuntimeJobRunner(client, journal), client


def test_speaks_only_edit_completions_and_final():
    runner, client = _fresh_runner(HAPPY_EVENTS)
    spoken, job = _run(runner, "create hello.txt")

    assert job.status == "done"
    # The write completion is spoken; the glob (search) and read are NOT.
    assert any("wrote hello.txt" in s for s in spoken), spoken
    assert not any("searched" in s or "read hello.txt" in s for s in spoken), spoken
    # The final answer is spoken last.
    assert "hello.txt" in spoken[-1]
    # Exactly one milestone (the write) plus the final line.
    assert len(spoken) == 2, spoken


def test_grounded_state_and_journal():
    runner, client = _fresh_runner(HAPPY_EVENTS)
    _, job = _run(runner, "create hello.txt")

    # All three tool outcomes are grounded in the job's confirmed list.
    assert "wrote hello.txt" in job.confirmed
    assert "read hello.txt" in job.confirmed
    assert "searched the project" in job.confirmed
    assert job.failures == []
    # Milestone recorded for the spoken edit only.
    assert job.milestones == ["wrote hello.txt"]


def test_box_created_and_always_destroyed():
    runner, client = _fresh_runner(HAPPY_EVENTS)
    _, job = _run(runner, "create hello.txt")
    assert client.created == [f"{rc.RUNTIME_USER_BASE}-{job.turn_id}"]
    assert client.destroyed == [f"ws-for-{rc.RUNTIME_USER_BASE}-{job.turn_id}"]


def test_failure_speaks_real_error():
    events = [
        {"type": "tool_call", "id": "t1", "title": "write", "kind": "edit", "status": "pending"},
        {"type": "tool_call_update", "id": "t1", "title": "workspace/locked.txt", "kind": "edit",
         "status": "failed", "content": {"type": "text", "text": "permission denied"}},
        {"type": "result", "content": "I couldn't write it.", "stopReason": "end_turn"},
    ]
    runner, client = _fresh_runner(events)
    spoken, job = _run(runner, "write locked.txt")

    assert any("failed to write locked.txt" in s and "permission denied" in s for s in spoken), spoken
    assert any("failed to write locked.txt" in f for f in job.failures), job.failures
    # The box is still destroyed after a tool failure.
    assert client.destroyed


def test_dropped_stream_fails_and_destroys():
    # No terminal result/error line — the box dropped mid-turn.
    events = [
        {"type": "tool_call", "id": "t1", "title": "write", "kind": "edit", "status": "pending"},
        {"type": "tool_call_update", "id": "t1", "title": "workspace/a.txt", "kind": "edit", "status": "completed"},
    ]
    runner, client = _fresh_runner(events)
    spoken, job = _run(runner, "half a job")

    assert job.status == "failed"
    assert any("lost the workspace connection" in s for s in spoken), spoken
    assert client.destroyed  # finally still tore the box down


def test_create_failure_speaks_and_no_orphan():
    runner, client = _fresh_runner(HAPPY_EVENTS, fail_create=True)
    spoken, job = _run(runner, "anything")

    assert job.status == "failed"
    assert spoken  # a spoken apology, not silence
    assert client.created == []
    assert client.destroyed == []  # nothing to destroy — no box was made


def test_omp_prose_titles_still_speak_the_edit():
    # OMP describes its tool in prose and drops title/kind on completion; the
    # edit milestone must still be spoken, with the filename from `locations`.
    runner, client = _fresh_runner(OMP_EVENTS)
    spoken, job = _run(runner, "create hello.txt")

    assert job.status == "done"
    assert any("wrote hello.txt" in s for s in spoken), spoken
    assert job.milestones == ["wrote hello.txt"]
    assert "wrote hello.txt" in job.confirmed
    # The final answer still lands last.
    assert "hello.txt" in spoken[-1]


def test_selected_agent_and_omp_config_reach_create(monkeypatch):
    monkeypatch.setattr(rc, "RUNTIME_AGENT", "omp")
    monkeypatch.setenv("OMP_MODELS_YML", "providers: {}")
    monkeypatch.setenv("OMP_ACP_ARGS", "--tools read,write,edit")
    monkeypatch.delenv("OMP_CONFIG_YML", raising=False)

    runner, client = _fresh_runner(OMP_EVENTS)
    _run(runner, "create hello.txt")

    assert client.created_agent == "omp"
    assert client.created_env == {
        "OMP_MODELS_YML": "providers: {}",
        "OMP_ACP_ARGS": "--tools read,write,edit",
    }


def test_default_agent_is_opencode_with_empty_env(monkeypatch):
    monkeypatch.setattr(rc, "RUNTIME_AGENT", "opencode")
    runner, client = _fresh_runner(HAPPY_EVENTS)
    _run(runner, "x")

    assert client.created_agent == "opencode"
    assert client.created_env == {}  # opencode uses its free default; no key leaks


def test_canonical_verb_prefers_title_then_kind():
    assert rc._canonical_verb("write", "edit") == "write"
    assert rc._canonical_verb("Create hello.txt", "edit") == "write"  # prose → kind
    assert rc._canonical_verb("glob", "search") == "glob"
    assert rc._canonical_verb("Search the project", "search") == "search"
    assert rc._canonical_verb("", "read") == "read"
    assert rc._canonical_verb("mystery tool", "") == ""


def test_first_location_path_picks_first_real_path():
    assert rc._first_location_path([{"path": "/workspace/a.txt"}]) == "/workspace/a.txt"
    assert rc._first_location_path([{"line": 3}, {"path": "b.txt"}]) == "b.txt"
    assert rc._first_location_path([]) == ""
    assert rc._first_location_path(None) == ""


def test_stop_job_cancels_and_destroys():
    # A stream that never terminates, so the job stays running until stopped.
    async def go():
        never = asyncio.Event()

        class Hanging(FakeClient):
            async def prompt_stream(self, workspace_id, text):
                yield {"type": "tool_call", "id": "t1", "title": "write", "kind": "edit", "status": "pending"}
                await never.wait()  # hang forever
                yield {"type": "result", "content": "x", "stopReason": "end_turn"}

        client = Hanging([])
        runner = RuntimeJobRunner(client, Journal("/tmp/koda-test-journal.jsonl"))

        async def speak(_):
            pass

        job = await runner.start_job("long thing", speak)
        await asyncio.sleep(0.05)  # let it create the box and start streaming
        assert job.running
        await runner.stop_job(job)
        assert job.status == "cancelled"
        assert client.destroyed  # box torn down on cancel
        return True

    assert asyncio.run(go())
