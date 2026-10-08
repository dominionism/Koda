# Koda v2 Voice Gateway

Pipecat-AI agent that bridges a LiveKit room to a streaming voice pipeline:
**Whisper** STT → **Cerebras** Llama 3.3 70B → **Kokoro** TTS, with **Silero**
VAD on both ends and full barge-in support.

## Quickstart

```bash
# 1. Configure secrets
cp Server/.env.example Server/.env
# Open Server/.env and set LIVEKIT_URL/API credentials plus model provider keys.
# For all-local LiveKit, use ws://localhost:7880 with devkey / secret.
# For LiveKit Cloud, use the cloud wss://...livekit.cloud URL.

# 2. Optional: start local LiveKit only when LIVEKIT_URL=ws://localhost:7880
livekit-server --dev

# 3. Install Python deps and run the agent
cd Server/agent
uv pip install -r requirements.txt
uv run python main.py

# 4. Start the token server for mobile auto-fetch (separate terminal)
cd Server/web
../agent/.venv/bin/python serve.py
```

The first run downloads the Whisper turbo model (~1 GB) and the Kokoro v1
weights (~330 MB) to your local cache.

## Test the full voice loop without Flutter

1. If using all-local LiveKit, start LiveKit Server: `livekit-server --dev`
2. Start the agent: `cd Server/agent && uv run python main.py`
3. Start the token server: `cd Server/web && ../agent/.venv/bin/python serve.py`
4. Mint a user token: `cd Server/agent && uv run python -m scripts.mint_user_token alice`
5. Open https://agents-playground.livekit.io
6. Connect with the `LIVEKIT_URL` from `Server/.env` and the token from step 4
7. Speak. Hear the agent reply. Try interrupting it mid-sentence.

For the Flutter app's blank-field auto-fetch, `Server/web/serve.py` must be
running on port `8800`. `/token` returns `KODA_PUBLIC_LK_URL` when set; otherwise
it returns `LIVEKIT_URL`. That keeps mobile and the agent on the same LiveKit
server by default. Set `KODA_PUBLIC_LK_URL` only when clients need a different
public address than the agent uses internally.

## Layout

```
Server/
├── .env.example         # secret template (copied to .env, gitignored)
├── .gitignore
├── README.md            # this file
├── agent/
│   ├── requirements.txt # pinned Python deps — Pipecat, LiveKit, STT/TTS providers
│   ├── main.py          # the agent entrypoint
│   └── scripts/
│       └── mint_user_token.py
└── web/
    ├── serve.py          # dev token server for mobile auto-fetch
    └── index.html
```

## Configuration knobs

All in `Server/.env`:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — transport shared by agent and token server
- `KODA_PUBLIC_LK_URL` — optional client-facing override for `/token`; usually leave unset
- `CEREBRAS_API_KEY`, `CEREBRAS_MODEL` — brain (default `qwen-3-235b-a22b-instruct-2507`)
- `CARTESIA_MODEL` — TTS model; keep this as only the model name, e.g. `sonic-2`
- `KOKORO_VOICE` — TTS voice (default `af_heart`; try `af_bella`, `am_adam`, etc.)
- `KODA_ROOM_NAME` — LiveKit room (default `koda-dev`)

## Deploying to a VPS

The same code runs unchanged on the VPS. Provide the deploy host with:
- Python 3.11+
- `uv` installed
- LiveKit Server bound to the public WebSocket port (with TLS, behind Caddy)
- A populated `.env` pointing `LIVEKIT_URL` at the public WebSocket address

A `systemd` unit will be added in Phase 5.

## See also

- `../Mobile/` — the Flutter client; start it with `cd Mobile && flutter run -d macos`
