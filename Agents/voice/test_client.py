import asyncio
import os

from livekit import api, rtc
from livekit.rtc import Room, TrackSource, TrackPublishOptions, MediaDevices


async def main():
    token = api.AccessToken(
        os.environ.get("LIVEKIT_API_KEY", "devkey"),
        os.environ.get("LIVEKIT_API_SECRET", "secret"),
    )
    token.with_identity("test-user").with_name("Test User")
    token.with_grants(
        api.VideoGrants(
            room_join=True,
            room="koda-dev",
            can_publish=True,
            can_subscribe=True,
        )
    )

    url = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
    print(f"Connecting to {url} room koda-dev...")

    room = Room()
    await room.connect(url, token.to_jwt())
    print("Connected!")

    # Set up speaker output
    devices = MediaDevices()
    output = devices.open_output()
    print("Speaker output ready")

    # Capture microphone
    capture = devices.open_input(
        enable_aec=True,
        noise_suppression=True,
        auto_gain_control=True,
    )
    print(f"Capturing from microphone (device: {devices.default_input_device()})")

    audio_track = rtc.LocalAudioTrack.create_audio_track("microphone", capture.source)
    options = TrackPublishOptions(source=TrackSource.SOURCE_MICROPHONE)
    await room.local_participant.publish_track(audio_track, options)
    print("Microphone published. Say something to Koda!")

    # Subscribe to remote audio and play through speakers
    async def on_track_subscribed(track, participant, kind):
        if kind == rtc.TrackKind.KIND_AUDIO:
            print(f"Subscribed to audio from {participant.identity}")
            # Stream audio to output player
            audio_stream = rtc.AudioStream(track)
            async for event in audio_stream:
                output.push_frame(event.frame)

    room.on("track_subscribed", on_track_subscribed)

    print("Listening for Koda's responses...")
    try:
        await asyncio.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        await capture.aclose()
        await output.aclose()
        await room.disconnect()
        print("Disconnected.")

if __name__ == "__main__":
    asyncio.run(main())