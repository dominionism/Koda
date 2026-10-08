import asyncio
import os

import numpy as np
import sounddevice as sd

from livekit import api, rtc
from livekit.rtc import Room, TrackSource, TrackPublishOptions, MediaDevices


async def main():
    token = api.AccessToken(
        os.environ.get("LIVEKIT_API_KEY", "devkey"),
        os.environ.get("LIVEKIT_API_SECRET", "secret"),
    )
    token.with_identity("audio-test").with_name("Audio Test")
    token.with_grants(
        api.VideoGrants(
            room_join=True,
            room="koda-dev",
            can_publish=True,
            can_subscribe=True,
        )
    )

    url = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
    print(f"Connecting to {url}...")

    room = Room()
    await room.connect(url, token.to_jwt())
    print("Connected!")

    capture = MediaDevices().open_input(
        enable_aec=True,
        noise_suppression=True,
        auto_gain_control=True,
    )
    print(f"Capturing from microphone (device: {MediaDevices().default_input_device()})")

    audio_track = rtc.LocalAudioTrack.create_audio_track("microphone", capture.source)
    options = TrackPublishOptions(source=TrackSource.SOURCE_MICROPHONE)
    await room.local_participant.publish_track(audio_track, options)
    print("Microphone published")

    audio_queue: asyncio.Queue[tuple[bytes, int]] = asyncio.Queue(maxsize=100)
    frames_received = 0

    def output_callback(outdata, frames, time, status):
        nonlocal frames_received
        try:
            pcm, sr = audio_queue.get_nowait()
            arr = np.frombuffer(pcm, dtype=np.int16)
            if len(arr) < frames:
                outdata[:len(arr)] = arr.reshape(-1, 1)
                outdata[len(arr):] = 0
            else:
                outdata[:] = arr[:frames].reshape(-1, 1)
            frames_received += len(arr)
        except Exception:
            outdata[:] = 0

    stream = sd.OutputStream(
        samplerate=24000,
        channels=1,
        dtype="int16",
        blocksize=960,
        callback=output_callback,
    )
    stream.start()

    def on_track_subscribed(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"Received audio from {participant.identity}")
            asyncio.create_task(_pump_audio(track, audio_queue))

    async def _pump_audio(track, queue):
        audio_stream = rtc.AudioStream(track)
        async for event in audio_stream:
            if event.frame and event.frame.audio:
                pcm = bytes(event.frame.audio)
                sr = event.frame.sample_rate
                await queue.put((pcm, sr))

    room.on("track_subscribed", on_track_subscribed)

    async def stats():
        while True:
            await asyncio.sleep(5)
            print(f"Frames received: {frames_received}, queue size: {audio_queue.qsize()}")

    asyncio.create_task(stats())

    print("Talk to Koda! Press Ctrl+C to exit.")
    try:
        await asyncio.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        stream.stop()
        stream.close()
        await capture.aclose()
        await room.disconnect()
        print("Disconnected.")


if __name__ == "__main__":
    asyncio.run(main())
