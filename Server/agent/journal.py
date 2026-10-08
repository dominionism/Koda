"""Koda's durable journal — a grounded, append-only trail of what really happened.

Plan Pillar 4 item 10 + Constitution Rule 4: a lost or partial work turn must
never leave a **false "why"** for a later recall. So the journal records ONLY
**verified tool outcomes** — the same grounding that gates spoken claims
(confirmed successes, real failures with their real errors, and milestones that
are themselves success-gated) — never model prose, never an unconfirmed
intention, never a fabricated file. If a build is dropped halfway, the journal
holds exactly what landed up to that instant and not one word more.

Shape:
- **Append-only JSONL.** Each record is one self-contained line, so a crash
  mid-write can at worst lose the last line — it can never corrupt the trail.
- **Git-excluded path** (default ``~/.koda/journal.jsonl``; override with
  ``KODA_JOURNAL_PATH``). Zero footprint on the user's repo, consistent with the
  durable-memory shape in ADR-0003. Point it into a project's git-excluded
  ``Context/`` via the env var if you want the trail to live with the project.
- **Best-effort, never fatal.** A journal write must never crash a build, so
  every write swallows its own I/O errors (logged, not raised).

Each work turn is one ``turn_id``. Re-dispatches after a dropped link reuse the
SAME ``turn_id`` (recorded with a ``redispatch`` marker), so the trail proves a
recovered drop was one logical turn — never double-counted as two builds.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from loguru import logger


def _default_path() -> Path:
    raw = os.environ.get("KODA_JOURNAL_PATH") or "~/.koda/journal.jsonl"
    return Path(raw).expanduser()


class Journal:
    """An append-only, grounded record of verified work outcomes."""

    def __init__(self, path: str | os.PathLike | None = None) -> None:
        self._path = Path(path).expanduser() if path else _default_path()
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:  # best-effort; a journal must never break a build
            logger.warning(f"[journal] could not create {self._path.parent}: {e}")

    @property
    def path(self) -> Path:
        """The filesystem path to the journal JSONL file.

        Returns:
            Path to the append-only journal file.
        """
        return self._path

    def _append(self, record: dict) -> None:
        record = {"t": time.time(), "iso": time.strftime("%Y-%m-%dT%H:%M:%S"), **record}
        try:
            with self._path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning(f"[journal] write failed ({e}); continuing")

    # ── grounded write API ───────────────────────────────────────────────────
    def job_start(self, turn_id: str, intent: str, project: str = "") -> None:
        """``project`` is the workspace/repo the job runs in, so "what was the
        last thing we worked on?" is a field lookup, not an inference."""
        rec = {"turn": turn_id, "kind": "job_start", "intent": intent}
        if project:
            rec["project"] = project
        self._append(rec)

    def redispatch(self, turn_id: str, attempt: int) -> None:
        """A dropped link is being re-run as the SAME logical turn (idempotent)."""
        self._append({"turn": turn_id, "kind": "redispatch", "attempt": attempt})

    def outcome(self, turn_id: str, text: str, ok: bool) -> None:
        """A tool FINISHED — the only thing that becomes durable truth. ``text`` is
        the grounded outcome line (e.g. 'wrote index.html' / 'shell failed: …')."""
        if not text:
            return
        self._append({"turn": turn_id, "kind": "outcome", "ok": ok, "text": text})

    def milestone(self, turn_id: str, text: str) -> None:
        """A spoken milestone — already success-gated upstream, so grounded."""
        if not text:
            return
        self._append({"turn": turn_id, "kind": "milestone", "text": text})

    def job_end(self, turn_id: str, status: str, result: str = "", redispatches: int = 0) -> None:
        """Record that a work turn has finished.

        Writes a grounded job_end entry with the final status and optional
        result summary. The status field captures how it ended (done,
        failed, cancelled) for recall queries.

        Params:
            turn_id: Stable logical turn identifier.
            status: Final status (done | failed | cancelled).
            result: Optional summary of the final outcome.
            redispatches: How many times this turn was re-dispatched after
                connection drops.

        Returns:
            None
        """
        self._append(
            {
                "turn": turn_id,
                "kind": "job_end",
                "status": status,
                "result": result,
                "redispatches": redispatches,
            }
        )

    # ── read API (recall / debug) ────────────────────────────────────────────
    def records(self) -> list[dict]:
        """All journal records, oldest first. Skips any corrupt trailing line."""
        out: list[dict] = []
        try:
            for line in self._path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # tolerate a half-written final line
        except OSError:
            return []
        return out

    def turn(self, turn_id: str) -> list[dict]:
        """Every record for one logical turn (across re-dispatches)."""
        return [r for r in self.records() if r.get("turn") == turn_id]

    def recent_jobs(self, limit: int = 4) -> list[dict]:
        """The last ``limit`` jobs as structured summaries, oldest→newest. Each:
        {turn, when, intent, project, status, result, outcomes[], failures[]}.
        Built purely from verified records — this is fact, not recollection."""
        jobs: dict[str, dict] = {}
        order: list[str] = []
        for r in self.records():
            t = r.get("turn")
            if not t:
                continue
            j = jobs.get(t)
            if j is None:
                j = {
                    "turn": t, "when": r.get("iso", ""), "intent": "",
                    "project": "", "status": "", "result": "",
                    "outcomes": [], "failures": [],
                }
                jobs[t] = j
                order.append(t)
            kind = r.get("kind")
            if kind == "job_start":
                j["intent"] = r.get("intent", "")
                j["project"] = r.get("project", "")
                j["when"] = r.get("iso", j["when"])
            elif kind == "outcome":
                (j["outcomes"] if r.get("ok") else j["failures"]).append(r.get("text", ""))
            elif kind == "job_end":
                j["status"] = r.get("status", "")
                j["result"] = r.get("result", "")
        return [jobs[t] for t in order[-limit:]]

    def digest(self, limit: int = 4, max_outcomes: int = 6) -> str:
        """A compact grounded digest of recent work, for seeding the brain's
        recall and the session-open greeting (Plan GenuineConversation, A1/A2).
        Contains ONLY verified facts straight from the records; "" when the
        journal is empty. A job with no job_end was interrupted — said so."""
        jobs = self.recent_jobs(limit)
        if not jobs:
            return ""
        lines: list[str] = []
        for j in jobs:
            head = f"- [{j['when'][:16]}] {j['intent'] or '(unknown task)'}"
            if j["project"]:
                head += f" (in {os.path.basename(str(j['project']).rstrip('/'))})"
            head += f" — {j['status'] or 'interrupted (no clean end recorded)'}"
            lines.append(head)
            for o in j["outcomes"][-max_outcomes:]:
                lines.append(f"    did: {o}")
            for f_ in j["failures"][-2:]:
                lines.append(f"    failed: {f_}")
            if j["result"]:
                lines.append(f"    wrapped up: {j['result'][:140]}")
        return "\n".join(lines)
