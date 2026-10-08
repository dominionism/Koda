"""Koda v2 voice agent.

Pipecat pipeline:

    LiveKit room  →  Silero VAD  →  Whisper STT  →  Groq LLM (with Ollama fallback)
                                                       ↓
    LiveKit room  ←  Kokoro TTS  ←─────────────────────┘

Connects to a LiveKit Server (local for dev, peer VPS later) and joins a
single room. Re-joins on disconnect. Reads its config from ``Server/.env``.

Run after ``livekit-server --dev`` is up in another terminal:

    cd Server/agent && uv run python main.py
"""

from __future__ import annotations

import asyncio
import math
import os
import random
import re
import struct
import sys
import time
from collections import deque

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    AudioRawFrame,
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InputAudioRawFrame,
    LLMContextFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
    UserTurnStrategies,
)
from pipecat.turns.user_start.min_words_user_turn_start_strategy import (
    MinWordsUserTurnStartStrategy,
)
from pipecat.services.cartesia.tts import CartesiaTTSService, GenerationConfig
from pipecat.services.groq.stt import GroqSTTService
from pipecat.services.groq.tts import GroqTTSService
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

# .env MUST load before our own modules import: acp_client freezes its
# connection constants (KODA_ORCH_HOST/BIN/PROJECT_DIR, session cache) from
# os.environ at import time. Importing it first silently discards the .env
# deployment config — exactly how the VPS gateway ended up SSHing to itself
# instead of spawning the brain locally (2026-06-12).
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from acp_client import Orchestrator, WorkJob, speechify
from conversation import BACKCHANNEL, CHAT, DEPTH, RECALL, STATUS, STOP, WORK, Conversation
from runtime_client import RuntimeJobRunner, maybe_runtime_runner
from latency import tracker as lat
from tts_edge import EdgeTTSService

ROOM_NAME = os.environ.get("KODA_ROOM_NAME", "koda-dev")
AGENT_IDENTITY = "koda-agent"

KODA_SYSTEM_PROMPT = """
You are Koda. You are having a real-time spoken conversation with a human.
You hear audio. You speak audio. You never see text and never produce
text that will be read; everything you say will be heard.

Brevity is law:
- Default reply: ONE short sentence. Often one phrase.
- Maximum: two short sentences, only if the topic genuinely needs it.
- Long-form answers are earned by the user explicitly asking for depth
  ("explain that", "tell me more", "go deeper"). Otherwise stay short.
- Every extra word delays the audio. Talk like a friend who texts back
  fast, not a teacher who lectures.

How to sound:
- Thoughtful friend, not corporate assistant. Contractions, light fillers
  ("yeah", "honestly", "hmm"), natural rhythm.
- No markdown, headers, bullets, "Sure, here's…", stage directions, or
  emoji. No reading symbols aloud.
- Never refer to "your message", "your text", "what you typed", or
  "your input". The user is talking. Refer to what they said as what
  they said.

How to think:
- Opinionated. When the user is wrong, you say so kindly and directly.
  No capitulating to please.
- Curious. Short pointed follow-ups when something's interesting.
- Don't narrate your reasoning; give the conclusion the way a person
  would in conversation.

When unsure what they said:
- Transcription can drop or warp words. If the user's last utterance feels
  nonsensical or out of context, ask one short clarifying question. Never
  bluff. Example: "sorry, did you say X or Y?"

Time-sensitive questions:
- Acknowledge your training cutoff in ONE clause when asked about news or
  current events. Don't lecture about it. Offer what you know.

If cut off mid-sentence, the user started talking. Stop and respond to
what they said next.
""".strip()


class InputAudioGain(FrameProcessor):
    """Server-side mic gain + optional half-duplex gating.

    **Gain.** Browser WebRTC AEC + NS + AGC over-attenuate the built-in mic,
    sending speech at RMS ~0.005 — far under any sensible VAD floor. We boost in
    flight so the VAD sees speech at usable levels regardless of how aggressive
    the publisher's processing is. Clipping to int16 avoids distortion.

    **Half-duplex (for open speakers).** While Koda is SPEAKING, the laptop
    speaker feeds Koda's own voice back into the built-in mic → Whisper
    hallucinations ("Thank you", "Thanks for watching") and false triggers. So we
    DROP mic input while the bot speaks, plus a short tail for the room/echo to
    decay. This kills the echo loop and lets us safely raise sensitivity. The cost
    is no barge-in while Koda speaks — headphones remove the need and restore it.
    """

    def __init__(
        self, gain: float = 4.0, half_duplex: bool = False, tail_secs: float = 0.4
    ) -> None:
        """Configure mic gain boost and optional half-duplex gating.

        Behavior:
            Boosts incoming mic audio by the given gain factor to compensate for
            browser-level over-attenuation. When half_duplex is enabled, mic audio
            is silently dropped while Koda is speaking (plus a decay tail) to
            prevent speaker feedback leading to Whisper hallucinations.

        Params:
            gain: Amplification scalar applied to raw PCM16 samples. Clamped to
                int16 range to avoid distortion.
            half_duplex: When True, swallow mic input while Koda speaks (+ tail).
                Intended for open-speaker setups where echo cancellation is
                unavailable. Headphones should set this to False.
            tail_secs: Additional seconds of muting after Koda stops speaking, to
                let room echo decay before reopening the mic.
        """
        super().__init__()
        self._gain = gain
        self._half_duplex = half_duplex
        self._tail_secs = tail_secs
        self._bot_speaking = False
        self._unmute_at = 0.0

    def _muted(self) -> bool:
        """Check whether mic input should currently be suppressed.

        Returns:
            True when half-duplex is active AND either Koda is still speaking
            or the echo-decay tail period has not yet elapsed.
        """
        if not self._half_duplex:
            return False
        return self._bot_speaking or time.monotonic() < self._unmute_at

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Apply gain and half-duplex gating to inbound audio frames.

        Tracks bot speaking state via BotStarted/BotStoppedSpeakingFrame
        markers. On InputAudioRawFrame: if half-duplex and muted, drops the
        frame; otherwise amplifies PCM16 samples by the configured gain
        factor, clamped to int16 range.

        Params:
            frame: The pipeline frame to process.
            direction: Frame direction (upstream/downstream).
        """
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
            self._unmute_at = time.monotonic() + self._tail_secs
        elif isinstance(frame, InputAudioRawFrame):
            if self._muted():
                return  # half-duplex: swallow mic audio while Koda speaks (+ tail)
            n = len(frame.audio) // 2
            if n:
                samples = struct.unpack(f"<{n}h", frame.audio)
                scaled = [
                    max(-32768, min(32767, int(s * self._gain))) for s in samples
                ]
                frame.audio = struct.pack(f"<{n}h", *scaled)
        await self.push_frame(frame, direction)


class AudioProbe(FrameProcessor):
    """Debug processor that logs post-gain audio level + VAD events."""

    def __init__(self) -> None:
        """Initialize the audio probe.

        Sets up a zeroed frame counter for periodic RMS logging. No
        configuration parameters needed.

        Params:
            None

        Returns:
            None
        """
        super().__init__()
        self._frames = 0
        super().__init__()
        self._frames = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Log periodic audio RMS levels and VAD state transitions.

        Every 100 AudioRawFrames, logs the RMS level (as fraction of max
        int16). On UserStartedSpeakingFrame / UserStoppedSpeakingFrame, logs
        VAD transitions and records latency timestamps.

        Params:
            frame: The pipeline frame to probe.
            direction: Frame direction (upstream/downstream).
        """
        await super().process_frame(frame, direction)
        if isinstance(frame, AudioRawFrame):
            self._frames += 1
            if self._frames % 100 == 0:
                rms = self._rms(frame.audio)
                logger.info(
                    f"[probe] audio #{self._frames} rms={rms:.4f} sr={frame.sample_rate} "
                    f"ch={frame.num_channels} bytes={len(frame.audio)}"
                )
        elif isinstance(frame, UserStartedSpeakingFrame):
            lat.started()
            logger.info("[probe] >>> VAD: user STARTED speaking")
        elif isinstance(frame, UserStoppedSpeakingFrame):
            lat.stopped()
            logger.info("[probe] <<< VAD: user STOPPED speaking")
        await self.push_frame(frame, direction)

    @staticmethod
    def _rms(pcm16_bytes: bytes) -> float:
        """Compute RMS amplitude from PCM16 audio bytes.

        Unpacks raw PCM16 little-endian samples and computes the quadratic
        mean normalized to the int16 dynamic range (0.0-1.0).

        Params:
            pcm16_bytes: Raw PCM16-encoded audio data.

        Returns:
            RMS amplitude as a fraction of max int16 amplitude (0.0-1.0).
            Returns 0.0 for empty input.
        """
        n = len(pcm16_bytes) // 2
        if n == 0:
            return 0.0
        samples = struct.unpack(f"<{n}h", pcm16_bytes)
        s = sum(x * x for x in samples) / n
        return math.sqrt(s) / 32768.0


# Whisper hallucinates these on silence/echo; never treat them as real input.
# (These are the well-known Whisper "silence" outputs — training-data artifacts
# from subtitled videos — plus single-word filler.)
_NOISE_EXACT = {
    "", "you", "thank you", "thanks", "thanks for watching",
    "thank you for watching", "thanks for watching!", "please subscribe",
    "subscribe", "like and subscribe", "see you next time",
    "see you in the next video", "bye", "goodbye", "i", "uh", "um", "hmm",
    "mm", "mhm", "yeah", "thank you very much", "thank you so much", "music",
    "music playing", "applause", "the", "so", "amara.org",
    "subtitles by the amara.org community", "transcription by",
    "you you", "you you you",
}


# Speech coalescing window. The turn detector fires on natural mid-thought pauses,
# so one sentence ("...the virtual aquarium" / "and the gamified" / "eat fish")
# arrives as several turns. We hold a finalized turn this long for a follow-on
# fragment and merge them into ONE utterance before routing — so a single thought
# is handled as a single request, not three. Kept short so it barely adds latency.
COALESCE_SECS = float(os.environ.get("KODA_COALESCE_SECS", "0.35"))

# Proactive updates: while a build runs, Koda may volunteer a natural progress note
# — but only on genuinely new activity and no more often than this, so it feels like
# a partner glancing up, not the old robotic "still on it" every few seconds.
PROACTIVE_MIN_SECS = float(os.environ.get("KODA_PROACTIVE_MIN_SECS", "30"))

# Threshold-gated holding line (Constitution Rule 2): a brain turn (recall/depth)
# can take seconds before its first token. Stay SILENT for this first beat — a
# quick answer just answers, no filler. Only if it runs past the threshold does
# Koda say ONE short, natural holding line, then stream the answer. This kills the
# "38 seconds of dead silence" failure while never adding filler to fast turns.
HOLDING_SECS = float(os.environ.get("KODA_HOLDING_SECS", "1.5"))
_HOLDING_LINES = [
    "Let me dig into that.",
    "One sec, pulling that up.",
    "Let me look.",
    "Give me a second on that.",
    "Hang on, let me check.",
]


def _is_meaningful(text: str) -> bool:
    """Filter out STT noise/echo/hallucination fragments before they trigger a turn."""
    t = text.strip().lower()
    # strip surrounding punctuation/brackets
    t = t.strip(" .,!?…-—_[](){}\"'").strip()
    if t in _NOISE_EXACT:
        return False
    if sum(c.isalpha() for c in t) < 2:  # punctuation / single letter
        return False
    words = t.split()
    if len(set(words)) == 1 and len(words) > 1:  # repeated single word ("you you")
        return False
    return True


# ── stop / abort detection ───────────────────────────────────────────────────
# A short, unambiguous halt command. Caught LOCALLY (no Groq round-trip) so "stop"
# feels instant — being slow to stop is the worst possible failure for a partner.
# False positives are harmless: nothing is killed until the user confirms
# (abort-with-confirm), so the matcher can be generous.
_STOP_LEAD = re.compile(
    r"^(?:(?:hey|ok|okay|no|wait|koda|just|please|alright|right|um|uh|and|so|"
    r"can you|could you|i need you to|i want you to)\b[\s,]*)+",
    re.IGNORECASE,
)
_STOP_HEAD = {"stop", "halt", "abort", "freeze", "quit", "enough", "pause"}
_STOP_PHRASES = {
    "cancel that", "cancel it", "never mind", "nevermind", "drop it",
    "leave it", "forget it", "knock it off", "cut it out", "hold on",
    "hold up", "do not do anything", "don't do anything", "dont do anything",
}


def _looks_like_stop(text: str) -> bool:
    """True when an utterance is essentially just a halt command (not 'stop X and
    do Y', which is longer and should route to the brain normally)."""
    t = text.strip().lower().strip(" .,!?…")
    t = _STOP_LEAD.sub("", t).strip()
    if not t:
        return False
    words = t.split()
    if words and words[0] in _STOP_HEAD and len(words) <= 6:
        return True
    return t in _STOP_PHRASES


# Resolving the "fully stop, or keep going?" confirmation. Kept local so the
# answer lands instantly.
_AFFIRM_STOP_EXACT = {
    "yes", "yeah", "yep", "yup", "fully stop", "stop fully", "stop it",
    "kill it", "completely", "fully", "all the way", "shut it down",
    "stop everything", "yes please", "for real", "i'm sure", "im sure",
}
_KEEP_GOING_EXACT = {
    "no", "nope", "nah", "keep going", "keep it going", "continue",
    "carry on", "go on", "don't stop", "dont stop", "keep at it",
    "leave it running", "resume", "no keep going", "false alarm",
    "my bad", "ignore that", "never mind", "nevermind",
}


def _is_affirmative_stop(text: str) -> bool:
    t = text.strip().lower().strip(" .,!?…")
    return t in _AFFIRM_STOP_EXACT or t.startswith(
        ("yes", "yeah", "yep", "yup", "stop", "kill", "abort", "halt", "shut it")
    )


def _is_keep_going(text: str) -> bool:
    t = text.strip().lower().strip(" .,!?…")
    return t in _KEEP_GOING_EXACT or t.startswith(
        ("keep going", "keep it", "continue", "carry on", "no keep",
         "don't stop", "dont stop", "go on", "leave it")
    )


# ── backchannel detection (Voice Constitution, Rule 1) ────────────────────────
# A pure acknowledgement that asks for nothing — Koda stays silent and keeps
# going. Caught LOCALLY for clear cases (instant, no Groq round-trip). The set is
# deliberately conservative: when genuinely ambiguous we let the router decide and
# bias toward responding (a needless reply is cheaper than swallowing a request).
# NEVER treated as a backchannel while Koda is awaiting an answer to its own
# question — there a short "yeah"/"okay" is the answer, not an acknowledgement.
_BACKCHANNEL_EXACT = {
    "sounds good", "sound good", "ok", "okay", "okay cool", "nice", "cool",
    "gotcha", "got it", "right", "mm-hm", "mhm", "mm", "uh-huh", "sure",
    "makes sense", "make sense", "perfect", "great", "awesome", "alright",
    "i see", "good", "fair enough", "nice nice", "cool cool", "okay nice",
    "yeah okay", "ok cool", "okay got it", "understood", "noted",
}


def _looks_like_backchannel(text: str) -> bool:
    t = text.strip().lower().strip(" .,!?…")
    if t in _BACKCHANNEL_EXACT:
        return True
    return _STOP_LEAD.sub("", t).strip() in _BACKCHANNEL_EXACT


class LatencyTap(FrameProcessor):
    """Marks the instant the first TTS audio of a turn leaves for the user, so the
    latency log can close the loop on 'stop talking → Koda's voice starts'."""

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Capture first-audio timestamp for end-to-end latency tracking.

        On TTSAudioRawFrame, records the moment the first audio of a turn
        leaves for the user via the global latency tracker. This closes the
        loop on 'stop talking -> Koda's voice starts'.

        Params:
            frame: The pipeline frame to inspect.
            direction: Frame direction (upstream/downstream).
        """
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSAudioRawFrame):
            lat.first_audio()
        await self.push_frame(frame, direction)


class OrchestratorProcessor(FrameProcessor):
    """The voice tier: a fast mouth/ears in front of the ONE brain (ACP).

    Two channels, so Koda can talk AND work at the same time:

    - **Conversation** (fast, local): every utterance is classified by the
      ``Conversation`` layer. Chat and on-demand status are answered locally in
      ~1s — the brain never wakes for them. This is the latency win.
    - **Work** (ACP, the brain): a real engineering request is dispatched as a
      BACKGROUND ``WorkJob``. It runs to completion on its own task, speaking only
      milestones and its final verified result. Because work is backgrounded and
      chat is local, the two never collide (no ``-32002``) and talking never
      cancels a build.

    Barge-in interrupts Koda's SPEECH only — never a running job. Speech is
    coalesced first, so one sentence spoken with pauses is one request, not three.
    """

    def __init__(
        self,
        orchestrator: Orchestrator,
        conversation: Conversation,
        runner: RuntimeJobRunner | None = None,
    ) -> None:
        """Initialize the voice-tier orchestrator with the brain and conversation layers.

        Holds a reference to the ACP orchestrator (the brain) and the local
        Conversation router. Sets up the coalescing buffer, proactive update
        loop, and stop-confirmation state machine.

        Params:
            orchestrator: ACP orchestrator instance that manages brain recall
                sessions (and, in legacy mode, WorkJob execution).
            conversation: Local conversation router that classifies utterances
                (chat, work, recall, etc.) and answers fast paths without the brain.
            runner: When present (KODA_USE_RUNTIME_JOBS=1), the WORK backend —
                jobs run in disposable Runtime boxes instead of on the brain.
                Recall / status / greeting always stay on the brain.
        """
        super().__init__()
        self._orch = orchestrator
        self._conv = conversation
        # The WORK backend: the runtime runner when active, else the brain. Only
        # start_job / stop_job route here; everything else uses self._orch.
        self._work = runner or orchestrator
        self._job: WorkJob | None = None
        self._reply_task: asyncio.Task | None = None   # in-flight chat/status/recall speech
        self._reply_is_recall: bool = False            # is _reply_task a brain recall? (don't task-cancel it)
        self._pending: list[str] = []                  # coalescing buffer
        self._coalesce_task: asyncio.Task | None = None
        self._proactive_task: asyncio.Task | None = None
        self._said: deque[str] = deque(maxlen=4)       # recent spoken status/proactive lines
        self._last_voice_t: float = 0.0                # when Koda last spoke (for pacing)
        self._awaiting_stop_confirm: bool = False      # asked "fully stop or keep going?"
        self._koda_asked_question: bool = False        # Koda's last spoken turn contained a '?' (a reply is an ANSWER, not a backchannel)

    # ── frame handling ───────────────────────────────────────────────────────
    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Route frames between the VAD-gated pipeline and the orchestrator.

        UserStartedSpeakingFrame triggers barge-in (cancels local replies and
        supersedes brain recall). LLMContextFrame is consumed here - its user
        text is extracted, noise-filtered, and enqueued for coalesced routing.
        All other frames pass through unchanged.

        Params:
            frame: The pipeline frame to process.
            direction: Frame direction (upstream/downstream).
        """
        await super().process_frame(frame, direction)
        # Barge-in: stop SPEAKING so the user can talk over Koda. Crucially this
        # does NOT touch a running WorkJob — the build keeps going in the
        # background while we listen. Only the spoken reply is interrupted.
        if isinstance(frame, UserStartedSpeakingFrame):
            self._cancel_reply()
            # If a brain RECALL is mid-answer (and it's not the user's build),
            # end it cleanly so the session is free for what they say next —
            # otherwise the next prompt collides (-32002) and Koda answers with
            # a spurious "say it again". A running WorkJob is never touched.
            if not (self._job and self._job.running):
                asyncio.create_task(self._orch.supersede())
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, LLMContextFrame):
            text = self._latest_user_text(frame.context)
            if text and _is_meaningful(text):
                self._enqueue(text)
            elif text:
                logger.info(f"[koda] ignored noise: {text!r}")
            return  # consume — do not forward the context frame to TTS
        await self.push_frame(frame, direction)

    def _cancel_reply(self) -> None:
        # Cancel a LOCAL chat/status reply. A brain RECALL is NEVER task-cancelled:
        # that would free turn_lock before the brain has ended its turn, letting
        # the next prompt collide (-32002). supersede() ends a recall cleanly via
        # session/cancel instead.
        if self._reply_is_recall:
            return
        if self._reply_task and not self._reply_task.done():
            self._reply_task.cancel()

    # ── speech coalescing ────────────────────────────────────────────────────
    def _enqueue(self, text: str) -> None:
        """Buffer a finalized turn and (re)arm the debounce. Consecutive fragments
        within COALESCE_SECS merge into one utterance before we route."""
        self._pending.append(text)
        if self._coalesce_task and not self._coalesce_task.done():
            self._coalesce_task.cancel()
        self._coalesce_task = asyncio.create_task(self._flush_after_debounce())

    async def _flush_after_debounce(self) -> None:
        try:
            await asyncio.sleep(COALESCE_SECS)
        except asyncio.CancelledError:
            return
        text = " ".join(self._pending).strip()
        self._pending = []
        if not text:
            return
        lat.dispatch(text)
        self._cancel_reply()  # a real new utterance supersedes any in-flight LOCAL reply
        # End an in-flight brain RECALL cleanly so its session frees before the
        # new turn dispatches (no -32002). Skipped while a WorkJob owns the brain.
        if not (self._job and self._job.running):
            await self._orch.supersede()
        self._reply_task = asyncio.create_task(self._handle(text))

    # ── routing ──────────────────────────────────────────────────────────────
    async def _handle(self, text: str) -> None:
        """Route a coalesced utterance to the correct handler.

        Runs the stop-detection -> backchannel -> Conversation.decide
        pipeline. Based on the route, dispatches to abort-with-confirm, work,
        status, depth, recall, or local chat handlers. Sets
        _koda_asked_question for the next turn's awaiting-answer gating.

        Params:
            text: The user's utterance after coalescing and noise filtering.
        """
        logger.info(f"[koda] turn: {text!r}")
        self._conv.remember_user(text)

        # Abort-with-confirm, step 2: we just asked "fully stop, or keep going?".
        # Resolve it locally and instantly. An answer that's neither a clear yes
        # nor no falls through and is routed as a normal new utterance.
        if self._awaiting_stop_confirm:
            self._awaiting_stop_confirm = False
            if _is_affirmative_stop(text):
                await self._do_stop()
                return
            if _is_keep_going(text):
                await self._say("Okay, I'll keep going.")
                return
            # ambiguous → fall through to normal routing below.

        # Abort-with-confirm, step 1: a bare halt command while work is running.
        # Caught locally so "stop" is instant; we confirm before killing anything,
        # which makes a false-triggered "stop" harmless.
        if _looks_like_stop(text):
            await self._begin_stop_confirm()
            return

        running = bool(self._job and self._job.running)
        # "Did Koda just ask something?" — true if its last spoken turn contained a
        # question (tracked across ALL turns: chat, recall, and the grill, not just
        # the job's final line). While awaiting, a short reply is an ANSWER, so it
        # must never be swallowed as a backchannel — that's what dropped "I was
        # thinking a web app" and "yep, all four directions" into silence.
        awaiting = self._koda_asked_question or bool(self._job and self._job.pending_question)
        self._koda_asked_question = False  # consume it; Koda's next question re-arms it

        # Backchannel (Voice Constitution, Rule 1): a pure acknowledgement while
        # Koda is NOT awaiting an answer to its own question → stay silent,
        # instantly, without waking the router or the brain. When awaiting, a short
        # "yeah"/"okay" is an ANSWER, not a backchannel, so we let it route normally.
        if not awaiting and _looks_like_backchannel(text):
            logger.info("[koda] backchannel — staying silent")
            return

        try:
            decision = await self._conv.decide(
                text, work_running=running, awaiting_answer=awaiting
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[koda] routing failed")
            await self._say("Sorry, I glitched for a second — say that again?")
            return
        lat.decided(decision.route)
        logger.info(f"[koda] route={decision.route} intent={decision.intent!r}")

        if decision.route == BACKCHANNEL:
            logger.info("[koda] backchannel (router) — staying silent")
            return
        if decision.route == STOP:
            await self._begin_stop_confirm()
        elif decision.route == WORK:
            await self._dispatch_work(decision.intent, decision.say, running)
        elif decision.route == STATUS:
            await self._report_status()
        elif decision.route == DEPTH:
            await self._report_depth(text, running)
        elif decision.route == RECALL:
            # Send the user's ACTUAL words to the brain, not the router's paraphrase.
            # The paraphrase can invert meaning — it once turned "draw me a fish"
            # into "you'll handle the fish art" and the brain dug in. The brain has
            # the session history to disambiguate; it should anchor on what the user
            # really said.
            await self._ask_brain(text, running)
        else:  # CHAT
            if decision.say:
                self._conv.remember_koda(decision.say)
                await self._say(decision.say)

    # ── abort-with-confirm ─────────────────────────────────────────────────────
    async def _begin_stop_confirm(self) -> None:
        """Ask before killing. The job keeps running while we ask, so a misheard
        'stop' costs nothing; only a confirmed stop actually aborts the work."""
        if not (self._job and self._job.running):
            # Nothing to stop. Barge-in already silenced any speech — stay quiet
            # rather than answer a 'stop' with chatter.
            return
        self._awaiting_stop_confirm = True
        await self._say("Want me to fully stop what I'm doing, or keep going?")

    async def _do_stop(self) -> None:
        """The user confirmed: abort the running job for real."""
        job = self._job
        if self._proactive_task and not self._proactive_task.done():
            self._proactive_task.cancel()
        if job and job.running:
            await self._work.stop_job(job)
            self._said.clear()
            await self._say("Okay, I've stopped.")
        else:
            await self._say("That one already wrapped up — nothing left to stop.")

    async def _dispatch_work(self, intent: str, ack: str, running: bool) -> None:
        """Dispatch a work intent to the ACP orchestrator as a background job.

        If a job is already running, defers politely rather than colliding on
        the ACP session. Otherwise acknowledges the intent, clears the
        said-history for fresh status tracking, starts the job via the
        orchestrator, and launches the proactive update loop.

        Params:
            intent: The user's natural-language work request.
            ack: Optional spoken acknowledgment before starting.
            running: Whether a WorkJob is currently in flight.
        """
        if running:
            # v1: one job at a time. Don't collide on the ACP session — let the
            # current build finish. (Concurrent jobs are the next iteration.)
            await self._say(
                "I'm still on the last thing — let me wrap it up, then I'll jump on that."
            )
            return
        if ack:
            await self._say(ack)
        self._said.clear()  # fresh job, fresh status memory
        # phrase= (Decision 7): milestone beats are spoken in Koda's own warm
        # words, generated from the exact grounded beat; journal stays canonical.
        self._job = await self._work.start_job(
            intent, self._say, phrase=lambda beat: self._conv.beat_line(beat, intent)
        )
        if self._proactive_task and not self._proactive_task.done():
            self._proactive_task.cancel()
        self._proactive_task = asyncio.create_task(self._proactive(self._job))

    async def _report_status(self) -> None:
        """Answer a 'what are you working on?' query.

        If no job is running, says so. Otherwise asks the Conversation layer
        to generate a status reply from the job's snapshot, the original
        intent, and lines already said this turn.
        """
        if not self._job or not self._job.running:
            await self._say("I'm not working on anything right now — what's next?")
            return
        reply = await self._conv.status_reply(
            self._job.snapshot(), self._job.intent, list(self._said)
        )
        if reply:
            self._said.append(reply)
            await self._say(reply)

    async def _report_depth(self, question: str, running: bool) -> None:
        """A DEEP question ('why that approach?', 'what exactly did you write?').

        Rule 4's depth split: the BRAIN holds the code and the full reasoning, so
        when it's free we route there for real depth. But the brain runs ONE turn
        at a time — while a build owns it we can't re-query without a -32002
        collision. So mid-build we answer from the brain's OWN already-streamed
        reasoning + confirmed outcomes (grounded, honest), and say plainly when
        that's too thin rather than fabricate."""
        if not (self._job and self._job.running):
            # Brain is free — route there for true depth (it holds code + reasoning).
            await self._ask_brain(question, running=False)
            return
        reply = await self._conv.depth_reply(
            self._job.snapshot(), self._job.reasoning, self._job.intent, question
        )
        if reply:
            self._said.append(reply)
            await self._say(reply)

    async def _proactive(self, job: WorkJob) -> None:
        """While the job runs, occasionally volunteer a natural progress note — but
        only on genuinely new activity, well-spaced, like a human partner. This is
        the 'Koda initiates' behaviour, NOT the old robotic heartbeat."""
        loop = asyncio.get_running_loop()
        last_rev = job.rev
        try:
            while job.running:
                await asyncio.sleep(6)
                if not job.running:
                    break
                if job.rev == last_rev:
                    continue  # nothing new happened
                if loop.time() - self._last_voice_t < PROACTIVE_MIN_SECS:
                    continue  # spoke too recently — don't crowd the user
                line = await self._conv.proactive_update(
                    job.snapshot(), job.intent, list(self._said)
                )
                last_rev = job.rev
                if line:
                    self._said.append(line)
                    await self._say(line)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[koda] proactive narrator failed")

    async def _ask_brain(self, intent: str, running: bool) -> None:
        """Send a memory/project question to the brain (ACP recall).

        If a WorkJob is running, defers to avoid ACP session collision.
        Otherwise marks the reply as a brain recall (so barge-in uses
        supersede() rather than task-cancel), starts a threshold-gated
        holding line task, and prompts the brain. The response is streamed
        through _say and recorded in conversation history. The turn_lock
        is held for the entire recall to prevent -32002 collisions.

        Params:
            intent: The user's question or recall request.
            running: Whether a WorkJob currently owns the ACP session.
        """
        if running:
            await self._say("I'm mid-build right now — give me a moment and I'll get to that.")
            return
        # Mark this reply a brain recall so barge-in / a new utterance ends it via
        # supersede() (clean session/cancel), never task-cancel (which would free
        # turn_lock before the brain frees its turn → -32002). The clear is guarded
        # by task identity: if a newer utterance has already taken over the reply
        # slot, we leave the flag to it.
        me = asyncio.current_task()
        self._reply_is_recall = True
        # Threshold-gated holding line (Rule 2): fire ONE short natural line if the
        # brain hasn't started answering within HOLDING_SECS, so a slow recall is
        # never dead silence — but a quick answer gets no filler. At most once per
        # turn (never repeats); stays quiet if the turn was superseded meanwhile.
        #
        # LLM-first (Decision 7): a question-aware line ("let me dig through the
        # aquarium code") generates IN PARALLEL from the moment the turn starts. If
        # it's ready by the threshold we speak it; if not, the fixed line fires —
        # warmth never costs dead air.
        spoke = asyncio.Event()
        gen = asyncio.create_task(self._conv.holding_line(intent))

        async def _holding_line() -> None:
            try:
                await asyncio.sleep(HOLDING_SECS)
            except asyncio.CancelledError:
                return
            if not spoke.is_set() and not self._orch._superseded:
                line = ""
                if gen.done():
                    try:
                        line = gen.result() or ""
                    except Exception:
                        line = ""
                await self._say(line or random.choice(_HOLDING_LINES))

        hold = asyncio.create_task(_holding_line())
        # Ground the recall in the journal (Plan GenuineConversation A1): the brain's
        # own context degrades over a long session — this is exactly how "what did
        # you just clone?" got "I'm not sure what you're referring to" while the
        # clone sat in its own history. Attach the verified work log as reference
        # so recall about recent work is answered from fact, not recollection.
        digest = self._orch.journal.digest(limit=3)
        ask = intent
        if digest:
            ask = (
                f"{intent}\n\n"
                "[Reference — your verified recent work log (real tool outcomes, "
                "facts only). If my question touches recent work, answer from this "
                "record over your own recollection; otherwise ignore it.]\n"
                f"{digest}"
            )
        try:
            # Hold the brain's turn-lock for the whole recall so no second
            # session/prompt overlaps (the -32002 source). Released only after the
            # turn's response resolves — a superseding utterance waits here, behind
            # supersede()'s clean session/cancel, never colliding.
            async with self._orch.turn_lock:
                buf = ""
                try:
                    for _ in range(2):  # one silent retry if the link blips
                        redispatch = False
                        async for ev in self._orch.prompt(ask):
                            if ev.kind == "say":
                                spoke.set()  # real answer landed → no holding line
                                buf += " " + ev.text
                                await self._say(ev.text)
                            elif ev.kind == "reconnected":
                                buf = ""
                                redispatch = True
                                break
                            elif ev.kind in ("reconnect_failed", "error"):
                                spoke.set()
                                await self._say(ev.text)
                                return
                        if not redispatch:
                            break
                    if buf.strip():
                        self._conv.remember_koda(buf.strip())
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("[koda] recall failed")
                    await self._say("Hmm, that got tangled up — say it once more?")
        finally:
            hold.cancel()
            gen.cancel()
            if self._reply_task is me:
                self._reply_is_recall = False

    @staticmethod
    def _latest_user_text(context) -> str | None:
        """Extract the most recent user message text from LLM context.

        Walks the context messages in reverse, looking for the last user-role
        entry. Handles both dict-style and object-style message representations,
        including content arrays of typed parts (e.g. [{"type": "text",
        "text": "..."}]).

        Params:
            context: An LLM context object with a .messages iterable.

        Returns:
            The stripped text of the latest user message, or None if no user
            message is found.
        """
        for msg in reversed(context.messages):
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            if role != "user":
                continue
            content = (
                msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
            )
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts = [
                    p.get("text", "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                return " ".join(parts).strip()
        return None

    def note_greeting(self, line: str) -> None:
        """Register the session-open greeting with conversation state.

        Records the greeting line in the conversation history so the router
        has context. If the greeting ends with a question, arms the
        awaiting-answer signal so the user's short reply routes as an answer,
        never swallowed as a backchannel.

        Params:
            line: The greeting text that was (or will be) spoken aloud.

        Returns:
            None
        """
        self._conv.remember_koda(line)
        if line.rstrip().endswith("?"):
            self._koda_asked_question = True
        self._conv.remember_koda(line)
        if line.rstrip().endswith("?"):
            self._koda_asked_question = True

    async def _say(self, text: str) -> None:
        """Speak a line of text through the TTS pipeline.

        Sanitises the text via speechify() (strips markdown/symbols), records
        the speaking timestamp for proactive pacing, sets
        _koda_asked_question if the line ends with '?', and pushes a
        TTSSpeakFrame downstream.

        Params:
            text: The text for Koda to speak aloud.
        """
        spoken = speechify(text)  # strip any stray markdown/symbols before TTS reads it
        if spoken:
            try:
                self._last_voice_t = asyncio.get_running_loop().time()
            except RuntimeError:
                pass
            # Arm the "Koda just asked a question" signal so the user's next reply
            # is treated as an answer, not a backchannel. Set (never cleared) here;
            # _handle consumes it. Any question anywhere in the turn counts.
            if spoken.rstrip().endswith("?"):
                self._koda_asked_question = True
            # Koda's spoken output — logged so a whole conversation can be read back
            # (paired with the "[koda] turn:" user lines) for testing & diagnosis.
            logger.info(f"[koda] say: {spoken!r}")
            await self.push_frame(TTSSpeakFrame(spoken), FrameDirection.DOWNSTREAM)


def _mint_agent_token() -> str:
    """Generate a LiveKit JWT for the agent's own room participant.

    Creates an AccessToken with the agent identity and full
    publish/subscribe/data grants for the configured room name. Reads API
    credentials from environment (LIVEKIT_API_KEY, LIVEKIT_API_SECRET).

    Returns:
        A signed JWT string the agent can use to join the LiveKit room.
    """
    token = AccessToken(
        os.environ["LIVEKIT_API_KEY"],
        os.environ["LIVEKIT_API_SECRET"],
    )
    token.with_identity(AGENT_IDENTITY).with_name("Koda")
    token.with_grants(
        VideoGrants(
            room_join=True,
            room=ROOM_NAME,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        )
    )
    return token.to_jwt()


async def run_agent() -> None:
    """Build and run the Pipecat voice pipeline.

    Behavior:
        1. Reads config from environment (LiveKit URL/credentials, VAD
           parameters, STT/TTS choice, mic gain).
        2. Instantiates the LiveKit transport, STT (Groq Whisper), TTS (Groq /
           Cartesia / Kokoro), audio processors (InputAudioGain, AudioProbe),
           the ACP orchestrator, and the Conversation router.
        3. Constructs a two-tier Pipecat pipeline: transport -> gain -> probe
           -> STT -> user aggregator -> OrchestratorProcessor -> TTS ->
           LatencyTap -> transport output.
        4. Generates a journal-grounded session-open greeting.
        5. Registers event handlers for participant join/leave.
        6. Runs the pipeline until the user disconnects or the process is
           interrupted.

    Raises:
        KeyError: A required environment variable (LIVEKIT_URL, GROQ_API_KEY,
            LIVEKIT_API_KEY, LIVEKIT_API_SECRET) is missing.
    """
    livekit_url = os.environ["LIVEKIT_URL"]
    token = _mint_agent_token()

    # VAD timing — tuned for human-conversational latency (Plan Pillar 4 item 11).
    #
    # END-OF-TURN COMMIT (stop_secs) is the knob that decides how fast Koda
    # commits "the user is done" after they stop. It was 0.5s (raised earlier for
    # echo/hallucination robustness on open speakers); on the real path — a live
    # mic on headphones — that adds ~0.2s of dead wait on every turn. Lowered to
    # 0.35: snappier than 0.5, safer than Pipecat's bare 0.2 (which can slice on a
    # natural mid-sentence breath). The COALESCE_SECS window (0.35) backstops it —
    # if a faster commit fragments one thought into two turns, the coalescer merges
    # them before routing, so the cost of a too-eager cut is paid back, not lost.
    #
    # min_volume/confidence stay sensitive (0.03 / 0.6) so a quiet built-in mic
    # still triggers; with the InputAudioGain boost upstream, real speech sits at
    # 0.04–0.30 RMS. Combined with Groq Whisper's ~100–300 ms STT, end-of-speech to
    # STT-done is ~250–450 ms — the remaining budget is TTS.
    #
    # ALL env-tunable so the final endpointing tune happens against a LIVE mic
    # (measured via /tmp/koda-latency.log "you spoke for") without a code edit:
    # too-fragmenting → raise KODA_VAD_STOP_SECS; too-laggy → lower it.
    vad_params = VADParams(
        confidence=float(os.environ.get("KODA_VAD_CONFIDENCE", "0.6")),
        start_secs=float(os.environ.get("KODA_VAD_START_SECS", "0.2")),
        stop_secs=float(os.environ.get("KODA_VAD_STOP_SECS", "0.35")),
        min_volume=float(os.environ.get("KODA_VAD_MIN_VOLUME", "0.03")),
    )

    transport = LiveKitTransport(
        url=livekit_url,
        token=token,
        room_name=ROOM_NAME,
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_audio_passthrough=True,
        ),
    )

    # Groq-hosted Whisper runs on their LPU and is the fastest Whisper
    # inference available. STT round-trip drops from ~500–1500 ms (local
    # CPU) to ~100–200 ms — the single biggest perceived-latency win.
    # Locking the language to English skips the per-utterance language
    # detection step. Temperature 0 gives deterministic transcripts.
    stt = GroqSTTService(
        api_key=os.environ["GROQ_API_KEY"],
        settings=GroqSTTService.Settings(
            model="whisper-large-v3-turbo",
            language=Language.EN,
            temperature=0.0,
        ),
    )

    # TTS selection. KODA_TTS ∈ edge | groq | cartesia | kokoro picks explicitly;
    # unset → edge (free Microsoft Edge neural TTS: no key, no rate limits, one
    # consistent voice — Koda's default).
    # The others remain selectable: groq (rate-limited free tier), cartesia (paid,
    # low-latency), kokoro (local ONNX, RTF ~1.5 on the shared EPYC cores — too slow
    # for the VPS).
    tts: TTSService
    tts_choice = (os.environ.get("KODA_TTS") or "edge").lower()
    if tts_choice == "edge":
        # Free, unlimited, single voice — replaces the rate-limited Groq/Orpheus path.
        edge_voice = os.environ.get("KODA_EDGE_VOICE", "en-GB-SoniaNeural")
        tts = EdgeTTSService(voice=edge_voice)
        logger.info(f"TTS: Edge (free, unlimited) voice={edge_voice}")
    elif tts_choice == "groq":
        tts = GroqTTSService(
            api_key=os.environ["GROQ_API_KEY"],
            settings=GroqTTSService.Settings(
                voice=os.environ.get("KODA_GROQ_VOICE", "autumn"),
            ),
        )
        logger.info(f"TTS: Groq voice={os.environ.get('KODA_GROQ_VOICE', 'autumn')}")
    elif tts_choice == "cartesia" and os.environ.get("CARTESIA_API_KEY"):
        # Cartesia Sonic-3 — websocket-streaming TTS at ~40 ms time-to-first-
        # audio and human-grade prosody. Sonic-3 unlocks GenerationConfig
        # (volume / speed / emotion) for finer-grained warmth control.
        cartesia_model = os.environ.get("CARTESIA_MODEL", "sonic-3")
        cartesia_voice = os.environ.get(
            "CARTESIA_VOICE_ID", "38aabb6a-f52b-4fb0-a3d1-988518f4dc06"
        )
        gen_config = GenerationConfig(
            speed=float(os.environ.get("CARTESIA_SPEED", "0.85")),
            emotion=os.environ.get("CARTESIA_EMOTION") or None,
        )
        tts = CartesiaTTSService(
            api_key=os.environ["CARTESIA_API_KEY"],
            settings=CartesiaTTSService.Settings(
                model=cartesia_model,
                voice=cartesia_voice,
                generation_config=gen_config,
            ),
        )
        logger.info(
            f"TTS: Cartesia {cartesia_model} voice={cartesia_voice} "
            f"speed={gen_config.speed} emotion={gen_config.emotion}"
        )
    else:
        # Local Kokoro fallback — slower (~700 ms TTFB) and more robotic but
        # fully free if no Cartesia key is configured.
        tts = KokoroTTSService(voice_id=os.environ.get("KOKORO_VOICE", "af_heart"))
        logger.info(f"TTS: Kokoro voice={os.environ.get('KOKORO_VOICE', 'af_heart')}")

    # The WORK backend. When KODA_USE_RUNTIME_JOBS=1, work runs in disposable
    # Runtime-Layer boxes (the managed-tier path — Voice↔Runtime Bridge); else
    # None and work falls back to the ZeroClaw brain below.
    runtime_runner = maybe_runtime_runner()

    # The brain: one warm ACP session to the orchestrator, started before we join
    # so it's ready the instant the user speaks. Holds the durable memory and,
    # in legacy mode, runs background work jobs.
    orchestrator = Orchestrator()
    if runtime_runner is not None:
        await runtime_runner.start()
        # Work no longer needs the brain — it only powers recall/greeting. Don't
        # let an unreachable brain (e.g. the inert VPS) block the demo: start it
        # best-effort, bounded, and continue with recall degraded if it's down.
        try:
            await asyncio.wait_for(orchestrator.start(), timeout=20.0)
        except Exception as e:
            logger.warning(
                f"[koda] brain unavailable ({e!r}); recall degraded — work runs in runtime boxes"
            )
    else:
        await orchestrator.start()

    # The fast mouth in front of the brain: answers chat + on-demand status
    # locally (~1s) and routes real work to the work backend. ACP stays the brain.
    conversation = Conversation()

    # Session-open greeting (Plan GenuineConversation A2, Decision 5): Koda speaks
    # FIRST, grounded in the journal — it names the real last work and offers to
    # resume. Generated NOW (before the user joins) so the join is instant; the
    # plain line is the fallback when the journal is empty or generation fails.
    greeting_line = await conversation.greeting(orchestrator.journal.digest(limit=2))
    if not greeting_line:
        greeting_line = "Hey, I'm Koda. What are we building today?"
    greeted_once = False  # #6: a rejoin regenerates the greeting, never repeats it
    logger.info(f"[koda] session-open greeting: {greeting_line!r}")

    context = LLMContext(
        messages=[{"role": "system", "content": KODA_SYSTEM_PROMPT}]
    )
    # Rule 3 sub-clause — "a backchannel while Koda speaks doesn't cut it."
    # The DEFAULT start strategies ([VAD, Transcription]) interrupt Koda the
    # instant the mic hears ANY sound, so "mm-hm" cuts him off (Rule 1 says it
    # shouldn't). Opt-in: KODA_BACKCHANNEL_SAFE_INTERRUPT=1 swaps the raw-VAD
    # interrupt for MinWordsUserTurnStartStrategy, which only starts the turn
    # (and the interruption) once >= N transcribed words land — so a one-word
    # backchannel never interrupts, but a real phrase does.
    #
    # TRADE-OFF (why this is OFF by default and needs a LIVE mic to tune): Groq
    # Whisper is non-streaming, so there are no interim words — the turn (and the
    # interrupt) can only fire after the FULL utterance transcribes. That makes
    # substantive interruption laggier than the default raw-VAD cut. With a
    # streaming STT, use_interim gives near-instant word-gated interrupts. Until
    # validated live, the default raw-VAD path (Rule 3 headline) stays intact.
    user_agg_kwargs: dict = {"vad_analyzer": SileroVADAnalyzer(params=vad_params)}
    if os.environ.get("KODA_BACKCHANNEL_SAFE_INTERRUPT", "0") != "0":
        min_words = int(os.environ.get("KODA_INTERRUPT_MIN_WORDS", "2"))
        user_agg_kwargs["user_turn_strategies"] = UserTurnStrategies(
            start=[MinWordsUserTurnStartStrategy(min_words=min_words, use_interim=True)]
        )
        logger.info(f"Rule 3: backchannel-safe interruption ON (min_words={min_words})")
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(**user_agg_kwargs),
    )

    # Two-tier pipeline (ADR-0003): STT → user aggregator (VAD-gated turn) →
    # OrchestratorProcessor (dispatches to the brain, narrates its work) → TTS.
    # The assistant aggregator is gone — the orchestrator holds conversation
    # state, not the voice tier's local context.
    pipeline = Pipeline(
        [
            transport.input(),
            # half_duplex defaults OFF: muting the mic while Koda speaks would
            # break Rule 3 (interruption is sacred). It stays available as a
            # speaker-only fallback via KODA_HALF_DUPLEX=1, but the real path is a
            # live mic + (next task) transcript-gated interruption. On headphones
            # there's no echo, so a live mic is the correct, constitution-faithful
            # setup today.
            InputAudioGain(
                gain=float(os.environ.get("KODA_MIC_GAIN", "4.0")),
                half_duplex=os.environ.get("KODA_HALF_DUPLEX", "0") != "0",
            ),
            AudioProbe(),
            stt,
            user_aggregator,
            processor := OrchestratorProcessor(orchestrator, conversation, runtime_runner),
            tts,
            LatencyTap(),
            transport.output(),
        ]
    )

    task = PipelineTask(
        pipeline,
        # NOTE: `allow_interruptions` is NOT a real PipelineParams field in pipecat
        # 1.1.0 (it was silently ignored). Interruption is driven by the user
        # aggregator's turn START strategy (above). Default raw-VAD interrupts on
        # any speech — Rule 3's headline. The backchannel-doesn't-interrupt
        # sub-clause is implemented via KODA_BACKCHANNEL_SAFE_INTERRUPT (MinWords
        # start strategy) — opt-in, pending live validation (non-streaming STT
        # makes substantive interrupts laggier; see the user-aggregator comment).
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        cancel_on_idle_timeout=False,
    )

    @transport.event_handler("on_first_participant_joined")
    async def _on_user_joined(transport, participant_identity: str) -> None:
        nonlocal greeting_line, greeted_once
        logger.info(f"user joined room: {participant_identity}")
        # On a REJOIN, regenerate from the CURRENT journal so new wins surface and
        # the opener never repeats verbatim (#6 — stale rejoin greeting). The first
        # join keeps the boot-time line (instant; the journal hasn't moved yet).
        if greeted_once:
            fresh = await conversation.greeting(
                orchestrator.journal.digest(limit=2), avoid=greeting_line
            )
            greeting_line = fresh or (
                "Welcome back — want to pick up where we left off, or something new?"
            )
        greeted_once = True
        # Koda speaks first, with the thread in hand (Decision 5): the grounded
        # greeting names the real last work. note_greeting() puts it in router
        # history and arms the question signal so "yeah" routes as an answer.
        processor.note_greeting(greeting_line)
        logger.info(f"[koda] say(greeting): {greeting_line!r}")
        await task.queue_frames([TTSSpeakFrame(greeting_line)])

    @transport.event_handler("on_participant_disconnected")
    async def _on_user_left(transport, participant_identity: str) -> None:
        logger.info(f"user left room: {participant_identity}")

    logger.info(f"koda agent connecting to {livekit_url} room={ROOM_NAME}")
    runner = PipelineRunner()
    await runner.run(task)


def main() -> int:
    """Entry point that validates config and launches the voice agent.

    Checks that at least GROQ_API_KEY or OLLAMA_MODEL is configured. If
    missing, logs an error and returns 2. Otherwise runs the async agent
    loop, catching KeyboardInterrupt for clean shutdown.

    Returns:
        0 on clean exit, 2 on missing configuration.
    """
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    has_ollama = bool(os.environ.get("OLLAMA_MODEL"))
    if not has_groq and not has_ollama:
        logger.error("missing LLM config: set GROQ_API_KEY or OLLAMA_MODEL — see Server/.env.example")
        return 2
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        logger.info("shutdown signal received")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
