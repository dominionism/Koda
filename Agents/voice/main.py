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
import struct
import sys

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    InputAudioRawFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.services.cartesia.tts import CartesiaTTSService, GenerationConfig
from pipecat.services.groq.stt import GroqSTTService
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

from services import create_llm_service

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

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
    """Server-side amplification of the participant's mic audio.

    Browser-side WebRTC AEC + NS + AGC frequently over-attenuates speech,
    sending peak RMS at 0.005 or below — far under any sensible VAD
    threshold. Rather than tune VAD down to noise levels (which causes
    constant false positives), we boost the audio in flight so the VAD
    receives speech at expected levels regardless of how aggressive the
    publisher's audio processing is.

    Default 8x is conservative: doubles WebRTC's typical output to put
    quiet speech around 0.04 RMS — comfortably above VAD start_volume.
    Clipping to int16 range is enforced to avoid distortion.
    """

    def __init__(self, gain: float = 8.0) -> None:
        super().__init__()
        self._gain = gain

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
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
        super().__init__()
        self._frames = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
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
            logger.info("[probe] >>> VAD: user STARTED speaking")
        elif isinstance(frame, UserStoppedSpeakingFrame):
            logger.info("[probe] <<< VAD: user STOPPED speaking")
        await self.push_frame(frame, direction)

    @staticmethod
    def _rms(pcm16_bytes: bytes) -> float:
        n = len(pcm16_bytes) // 2
        if n == 0:
            return 0.0
        samples = struct.unpack(f"<{n}h", pcm16_bytes)
        s = sum(x * x for x in samples) / n
        return math.sqrt(s) / 32768.0


def _mint_agent_token() -> str:
    """Generate a LiveKit JWT for the agent's own room participant."""
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
    livekit_url = os.environ["LIVEKIT_URL"]
    token = _mint_agent_token()

    # Aggressive VAD timing for human-conversational latency. With the 8x
    # InputAudioGain upstream, normal speech sits at 0.04–0.30 RMS; a 0.02
    # floor with 0.5 confidence is reliable and noise-robust.
    #
    # stop_secs 0.2 is Pipecat's default and the snappiest you can use
    # without slicing on a natural breath. Combined with Groq Whisper's
    # 100–300 ms STT, end-of-speech to STT-done is now ~300–500 ms — the
    # remaining latency budget is TTS, which dominates with Kokoro and
    # disappears with Cartesia.
    vad_params = VADParams(
        confidence=0.5,
        start_secs=0.10,
        stop_secs=0.1,
        min_volume=0.02,
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

    primary_llm, _ = create_llm_service(
        groq_api_key=os.environ.get("GROQ_API_KEY"),
        groq_model=os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        ollama_model=os.environ.get("OLLAMA_MODEL"),
        ollama_base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    )

    tts: TTSService
    if os.environ.get("CARTESIA_API_KEY"):
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

    context = LLMContext(
        messages=[{"role": "system", "content": KODA_SYSTEM_PROMPT}]
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=vad_params)
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            InputAudioGain(gain=8.0),
            AudioProbe(),
            stt,
            user_aggregator,
            primary_llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        cancel_on_idle_timeout=False,
    )

    @transport.event_handler("on_first_participant_joined")
    async def _on_user_joined(transport, participant_identity: str) -> None:
        logger.info(f"user joined room: {participant_identity}")
        await task.queue_frames(
            [TTSSpeakFrame("Hey, I'm Koda. Talk to me whenever you're ready.")]
        )

    @transport.event_handler("on_participant_disconnected")
    async def _on_user_left(transport, participant_identity: str) -> None:
        logger.info(f"user left room: {participant_identity}")

    logger.info(f"koda agent connecting to {livekit_url} room={ROOM_NAME}")
    runner = PipelineRunner()
    await runner.run(task)


def main() -> int:
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
