<p align="center">
  <img src="Brand/Banner.png" alt="Koda" width="680" />
</p>

<p align="center">
  A voice-first AI pair programmer. Talk to it; it does the engineering.
</p>

---

Koda is a pair-programming partner — a personal development assistant that
operates autonomously with high intelligence while staying conversational and
steered by you. You talk to your own Koda agent, which does real work:
navigating codebases, managing version control, delegating to coding tools, and
reporting back in plain speech. Your phone (or laptop) is just a microphone and a
speaker — all the intelligence lives server-side.

## How it works

Koda runs as **two tiers** behind a LiveKit audio room:

1. **The voice gateway** (`Server/agent/`, Python/[Pipecat]) — the fast
   conversational layer. It handles speech-to-text (Groq Whisper), a lightweight
   intent router, spoken status/holding lines, and text-to-speech. It decides,
   per utterance, whether to answer instantly or hand the work to the brain.
2. **The brain** (a separate [ZeroClaw] deployment, Rust) — the engineer. It
   plans, edits code, runs tools, and commits, then streams what it did back to
   the gateway to be spoken. The gateway talks to it over ACP. This repository
   does not vendor the brain; you point the gateway at your own deployment, or
   run work in disposable `runtime/` boxes instead.

```
 Flutter app  ──(mic audio)──►  LiveKit room  ──►  voice gateway  ──ACP──►  ZeroClaw brain
 (thin client) ◄─(Koda's voice)─             ◄──   (Server/agent)         (does the work)
```

The client is a **thin audio pipe**: join the room, publish the mic, play
Koda's audio. No app-side AI, no custom protocol. See `Context/Guides/Frontend.md`.

## Repository layout

```
Koda/
├── Mobile/           # Flutter voice client (iOS / Android / macOS / web)
├── Server/
│   ├── agent/        # voice gateway: main.py pipeline, acp_client (brain link),
│   │                 #   conversation (router), journal, restart.sh, tests/
│   ├── web/          # serve.py token server + browser dev client
│   └── .env.example  # gateway configuration template
├── runtime/          # @koda/runtime — Docker workspace manager + ACP streaming API
├── Agents/
│   ├── local-agent/  # legacy local agent (TypeScript)
│   ├── voice/        # legacy pre-router voice agent (not the active gateway)
│   └── zeroclaw/     # placeholder — the brain is a separate deployment
├── Website/          # Next.js marketing site
├── Context/          # project knowledge:
│   └── Guides/       #   Backend (self-host), Frontend (build a client)
├── Brand/            # Logo + banner assets
├── Makefile          # dev-workflow targets
└── README.md
```

## Quickstart

The `Makefile` drives the local dev workflow (run targets in separate terminals):

```bash
make doctor      # verify toolchain (uv, flutter, livekit-server)
make install     # install Python (gateway) + Flutter (app) deps

make livekit     # 1. LiveKit transport (dev mode)
make agent       # 2. the voice gateway (needs Server/.env — copy from .env.example)
make app-ios     # 3. the Flutter app (or app-android / app-mac / playground)
```

`make agent` needs `Server/.env` filled in — at minimum a free `GROQ_API_KEY`
and the address of a reachable ZeroClaw brain. Full setup, including running the
brain yourself, is in **`Context/Guides/Backend.md`**. To build a client against
Koda without running any backend, see **`Context/Guides/Frontend.md`**.

## The voice

Koda speaks through free Microsoft Edge neural TTS by default
(`en-GB-SoniaNeural`, no API key). The gateway's `KODA_TTS` setting selects the
engine (`edge` | `groq` | `cartesia` | `kokoro`). How Koda *talks* — turn-taking,
interruption, grounded warmth — shapes the gateway's conversation layer.

## Documentation

- **`Context/Guides/Backend.md`** — self-host the complete voice stack end-to-end.
- **`Context/Guides/Frontend.md`** — build a client; the thin-client LiveKit contract.

## License

See LICENSE.

[Pipecat]: https://github.com/pipecat-ai/pipecat
[ZeroClaw]: https://github.com/zeroclaw-labs/zeroclaw
