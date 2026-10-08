"""Per-turn latency log — maps each thing the user says to how long Koda took.

Writes a human-readable block per turn to ``/tmp/koda-latency.log`` so the exact
latency breakdown is visible:

    [16:25:14] "Hey Koda, help me with a project?"  route=chat
       you spoke for           : 4.2 s   (incl. end-of-speech detection)
       stop -> dispatch (coalesce): 601 ms
       dispatch -> routed (Groq)  : 251 ms
       routed -> first audio (TTS): 516 ms
       == stop -> Koda's voice    : 1368 ms

The actionable number is the last one: from the moment you stop talking to the
moment Koda's voice starts. The pieces above it show where that time goes.

This is a debug instrument, not production logic — it never raises into the
pipeline. A single shared ``tracker`` is imported by the pipeline processors:

    from latency import tracker as lat
    lat.started()          # VAD: user started speaking
    lat.stopped()          # VAD: user stopped speaking (end of turn)
    lat.dispatch(text)     # coalesced utterance dispatched to routing
    lat.decided(route)     # router picked a route
    lat.first_audio()      # first TTS audio frame left for the user → log the block
"""

from __future__ import annotations

import time
from datetime import datetime

from loguru import logger

LOG_PATH = "/tmp/koda-latency.log"


def _now_ms() -> float:
    return time.monotonic() * 1000.0


class LatencyTracker:
    """Tracks the timing marks of a single turn and writes a block when the first
    TTS audio leaves. Marks are best-effort — a missing one just renders as ``?``.
    """

    def __init__(self) -> None:
        self._reset()

    def _reset(self) -> None:
        self._t_start: float | None = None      # user started speaking
        self._t_stop: float | None = None       # user stopped speaking
        self._t_dispatch: float | None = None    # coalesced utterance dispatched
        self._t_routed: float | None = None      # router decided
        self._text: str = ""
        self._route: str = ""
        self._logged: bool = False               # block already written this turn

    # ── marks ────────────────────────────────────────────────────────────────
    def started(self) -> None:
        """Record that the user started speaking.

        Resets the tracker if a previous turn has already been logged,
        ensuring each turn's marks are isolated. Sets the start timestamp
        for the VAD-detected speech onset.

        Params:
            None

        Returns:
            None
        """
        # A fresh utterance begins a fresh turn once the previous one has been
        # logged (or never started). Don't clobber an in-flight turn's marks.
        if self._logged or self._t_start is None:
            self._reset()
        self._t_start = _now_ms()

    def stopped(self) -> None:
        """Record that the user stopped speaking.

        Captures the VAD-detected speech end timestamp. Does not reset
        state since coalescing and dispatch still need the full window.

        Params:
            None

        Returns:
            None
        """
        self._t_stop = _now_ms()

    def dispatch(self, text: str) -> None:
        """Record that a coalesced utterance was dispatched for routing.

        This is the real start of "Koda's work" for a turn — marks when
        the complete user utterance enters the routing pipeline. Resets
        state if the previous turn was already logged.

        Params:
            text: The coalesced utterance text to record for the latency log.

        Returns:
            None
        """
        # The coalesced utterance is the real start of "Koda's work" for a turn.
        if self._logged:
            self._reset()
        self._t_dispatch = _now_ms()
        self._text = (text or "").strip()

    def decided(self, route: str) -> None:
        """Record that the router picked a route for this utterance.

        Captures the timestamp and route label after the conversation
        router classifies the utterance (chat, work, recall, etc.).

        Params:
            route: The route label assigned by the conversation router.

        Returns:
            None
        """
        self._t_routed = _now_ms()
        self._route = route or ""

    def first_audio(self) -> None:
        """Record that the first TTS audio of this turn has been sent.

        Closes the end-to-end latency measurement loop: from when the user
        stopped speaking to when Koda's voice starts. Only the first audio
        frame per turn is recorded; subsequent frames are ignored. Swallows
        I/O exceptions since this is a debug instrument that must never
        break the pipeline.

        Params:
            None

        Returns:
            None
        """
        # Only the FIRST TTS frame of a turn closes the loop; ignore the rest.
        if self._logged:
            return
        self._logged = True
        try:
            self._write(_now_ms())
        except Exception:  # never let the debug log break the pipeline
            logger.opt(exception=True).debug("[latency] failed to write block")

    # ── rendering ──────────────────────────────────────────────────────────
    @staticmethod
    def _ms(a: float | None, b: float | None) -> str:
        if a is None or b is None:
            return "     ?"
        return f"{int(round(b - a)):>6}"

    def _write(self, t_voice: float) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        route = self._route or "?"
        text = self._text or ""
        lines = [
            f'[{stamp}] "{text}"  route={route}',
            f"   you spoke for            : {self._ms(self._t_start, self._t_stop)} ms"
            f"  (incl. end-of-speech detection)",
            f"   stop -> dispatch (coalesce): {self._ms(self._t_stop, self._t_dispatch)} ms",
            f"   dispatch -> routed (Groq)  : {self._ms(self._t_dispatch, self._t_routed)} ms",
            f"   routed -> first audio (TTS): {self._ms(self._t_routed, t_voice)} ms",
            f"   == stop -> Koda's voice    : {self._ms(self._t_stop, t_voice)} ms",
        ]
        block = "\n".join(lines) + "\n"
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(block)


# The single shared tracker imported across the pipeline processors.
tracker = LatencyTracker()
