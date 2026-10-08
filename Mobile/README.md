# Koda mobile app

Flutter client for the Koda voice loop. The app joins a LiveKit room, publishes
microphone audio, and plays Koda's remote audio response.

## Start the app

Run from the repo root in four terminals:

```bash
# 1. Optional all-local LiveKit transport
# Only needed when Server/.env has LIVEKIT_URL=ws://localhost:7880
cd koda
livekit-server --dev

# 2. Voice agent
cd koda/Server/agent
uv run python main.py

# 3. Token server for blank-field auto-fetch
cd koda/Server/web
../agent/.venv/bin/python serve.py

# 4. Flutter macOS app
cd koda/mobile
flutter run -d macos
```

The token server returns `KODA_PUBLIC_LK_URL` when set, otherwise it returns
`LIVEKIT_URL` from `Server/.env`. That means the app and agent join the same
LiveKit server by default. Set `KODA_PUBLIC_LK_URL` only when a device needs a
different public LiveKit address than the agent process uses internally.

For device targets, use the same `koda/mobile` working directory:

```bash
flutter run -d ios      # connected iPhone or simulator
flutter run -d android  # connected Android device or emulator
```

The app expects a LiveKit URL/token. If the fields are blank, it auto-fetches
from `http://localhost:8800/token`, so the token server above must be running.
For manual local testing, mint a token from the agent directory:

```bash
cd koda/Server/agent
uv run python -m scripts.mint_user_token alice
```

Use the same LiveKit URL as the running voice agent: `ws://localhost:7880` for
all-local dev, or the `wss://...livekit.cloud` value from `Server/.env` when the
agent points at LiveKit Cloud.

## Install dependencies

```bash
cd koda/mobile
flutter pub get
```

## Verify

```bash
cd koda/mobile
flutter analyze
flutter test
```
