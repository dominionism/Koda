"""
Edge TTS service for the Koda Voice Gateway.
============================================

A streaming Pipecat :class:`TTSService` backed by Microsoft Edge's free online
neural voices via the ``edge-tts`` package — no API key, no account, and no
hard request caps (unlike Groq's free tier, which rate-limited long sessions).

This is Koda's default voice: one consistent voice (``en-GB-SoniaNeural`` by
default), chosen over the rate-limited Groq/Orpheus path because a voice that
switches mid-task is jarring.

edge-tts emits 24 kHz mono MP3; Pipecat wants raw PCM, so we decode in-memory
with PyAV (already present via ``faster-whisper``) and resample to the pipeline's
output rate. On a transient endpoint hiccup we retry the *same* voice — we never
switch voices.
"""

from __future__ import annotations

import asyncio
import io
import os
from collections.abc import AsyncGenerator

import av
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.utils.tracing.service_decorators import traced_tts

from text_normalize import speakable

try:
    import edge_tts
except ModuleNotFoundError as e:  # pragma: no cover
    logger.error("edge-tts not installed — run `pip install edge-tts`.")
    raise Exception(f"Missing module: {e}") from e


DEFAULT_EDGE_VOICE = "en-GB-SoniaNeural"


def decode_mp3_to_pcm(mp3_bytes: bytes, target_rate: int) -> bytes:
    """Decode MP3 bytes to mono s16le PCM at ``target_rate`` using PyAV.

    Pure function (no Pipecat state) so it can be unit-tested in isolation.
    """
    container = av.open(io.BytesIO(mp3_bytes))
    resampler = av.AudioResampler(format="s16", layout="mono", rate=target_rate)
    chunks: list[bytes] = []
    try:
        for frame in container.decode(audio=0):
            for rframe in resampler.resample(frame):
                chunks.append(rframe.to_ndarray().tobytes())
        # Flush any audio buffered inside the resampler.
        for rframe in resampler.resample(None):
            chunks.append(rframe.to_ndarray().tobytes())
    finally:
        container.close()
    return b"".join(chunks)


class EdgeTTSService(TTSService):
    """Free, unlimited Microsoft Edge neural TTS for Pipecat — Koda's default voice.

    No API key. Decodes edge-tts MP3 → PCM in-memory and yields audio frames at
    the pipeline's output sample rate.
    """

    def __init__(
        self,
        *,
        voice: str | None = None,
        rate: str | None = None,   # edge prosody, e.g. "+0%" / "-5%"
        pitch: str | None = None,  # edge prosody, e.g. "+0Hz"
        max_retries: int = 2,
        sample_rate: int | None = None,
        **kwargs,
    ):
        """Create the Edge TTS service.

        Args:
            voice: Edge voice id (e.g. ``en-US-AriaNeural``). Defaults to
                ``KODA_EDGE_VOICE`` env var, then :data:`DEFAULT_EDGE_VOICE`.
            rate / pitch: optional edge-tts prosody overrides.
            max_retries: extra attempts on a transient endpoint failure
                (same voice — never a different one).
            sample_rate: output rate; when None the pipeline supplies it at start.
        """
        resolved_voice = voice or os.environ.get("KODA_EDGE_VOICE", DEFAULT_EDGE_VOICE)
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            sample_rate=sample_rate,
            # Initialize every TTSSettings field (the base validates none are NOT_GIVEN).
            settings=TTSSettings(model=None, voice=resolved_voice, language=Language.EN),
            **kwargs,
        )
        self._voice = resolved_voice
        self._rate = rate
        self._pitch = pitch
        self._max_retries = max_retries

    def can_generate_metrics(self) -> bool:
        """This service reports TTFB / usage metrics."""
        return True

    async def _synthesize_mp3(self, text: str) -> bytes:
        """Drive edge-tts and return the full MP3 byte stream."""
        prosody = {}
        if self._rate:
            prosody["rate"] = self._rate
        if self._pitch:
            prosody["pitch"] = self._pitch
        communicate = edge_tts.Communicate(text, self._voice, **prosody)
        buf = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio" and chunk.get("data"):
                buf.extend(chunk["data"])
        return bytes(buf)

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        """Synthesize ``text`` to PCM audio frames via Edge TTS.

        The base class (push_start_frame / push_stop_frames) emits the
        TTSStarted/TTSStopped frames, so we only yield audio (or an ErrorFrame).
        """
        text = speakable(text)  # speak file paths/extensions correctly (.py -> "dot pie")
        logger.debug(f"{self}: Generating Edge TTS [{text}] voice={self._voice}")
        await self.start_tts_usage_metrics(text)

        # 1. Synthesize (retry the SAME voice on transient failure).
        mp3 = b""
        last_err: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                mp3 = await self._synthesize_mp3(text)
                if mp3:
                    break
            except Exception as e:
                last_err = e
                logger.warning(f"{self}: Edge TTS attempt {attempt + 1} failed: {e}")
                await asyncio.sleep(0.3 * (attempt + 1))
        if not mp3:
            await self.stop_ttfb_metrics()
            yield ErrorFrame(error=f"Edge TTS failed after retries: {last_err}")
            return

        # 2. Decode MP3 → PCM off the event loop (PyAV is sync/CPU-bound).
        try:
            pcm = await asyncio.to_thread(decode_mp3_to_pcm, mp3, self.sample_rate)
        except Exception as e:
            await self.stop_ttfb_metrics()
            yield ErrorFrame(error=f"Edge TTS decode error: {e}")
            return

        await self.stop_ttfb_metrics()

        # 3. Emit in ~40 ms chunks for smooth, interruptible playback.
        bytes_per_chunk = max(2, int(self.sample_rate * 0.04) * 2)  # s16 mono
        for i in range(0, len(pcm), bytes_per_chunk):
            yield TTSAudioRawFrame(
                audio=pcm[i : i + bytes_per_chunk],
                sample_rate=self.sample_rate,
                num_channels=1,
                context_id=context_id,
            )
