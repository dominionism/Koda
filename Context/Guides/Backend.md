# Koda Backend — Self-Hosting Guide

How to run the **complete** Koda voice stack yourself, so you can test a
frontend end-to-end without depending on anyone else's machine.

> **Do you actually need this?** For frontend work, usually no — see
> `Frontend.md`: the client is a thin LiveKit audio pipe and develops fully
> standalone. Self-host only when you want independent end-to-end testing.

## The three pieces

```
frontend ──► LiveKit server ──► voice gateway (this repo) ──ssh/local──► ZeroClaw brain
              :7880              Server/agent/ (Python)             (separate runtime)
```

The gateway in this repository is the only Koda component you build here. The
**brain** is a separate ZeroClaw runtime deployment that you provide yourself —
this repo does not ship it, and Koda assumes no particular ZeroClaw install.

## Prerequisites

- **Python 3.13+** (the gateway needs `audioop-lts`) and [`uv`](https://docs.astral.sh/uv/).
- **A LiveKit server** — for local development, the `livekit-server` binary.
- **A Groq API key** — free tier is fine; it powers fast routing/status and
  Whisper speech-to-text.
- **A brain host** — a machine that can run the ZeroClaw agent runtime and is
  reachable from the gateway. It may be the same machine you run the gateway on
  (see `KODA_ORCH_HOST=local` below).

## 1. LiveKit (dev mode)

```bash
brew install livekit         # mac; see livekit.io for linux
livekit-server --dev         # ws://localhost:7880, keys devkey/secret
```

## 2. The brain — a ZeroClaw deployment you provide

The brain is **not** part of this repository. It is a ZeroClaw runtime that
speaks the agent-client protocol back to the gateway. Deploy it separately on
the machine that will act as your brain host, following that project's own
instructions to build and install the binary.

Once installed, the runtime lives at a path you choose — the guide below uses
the conventional `~/.zeroclaw/bin/zeroclaw`, and the shipped
`Server/.env.example` uses that same location on the brain host.

Give the agent an operating manual. The brain expects an `AGENTS.md` in its
agent workspace, and you must supply your own — the gateway repository does
**not** provide one:

```bash
# on the brain host
${EDITOR:-vi} ~/.zeroclaw/agents/default/workspace/AGENTS.md
```

Configure the runtime itself (model provider, pacing, tool-iteration limits)
per the ZeroClaw project's documentation. The settings the voice tier cares
about most are a working model provider + API key and a tool-iteration ceiling
high enough for real builds.

The brain host must be **SSH-reachable from the gateway machine** (key-based,
no password prompt) **unless** the brain and gateway share one machine — in
that case set `KODA_ORCH_HOST=local` (see below) and the gateway spawns the
brain directly, with no sshd required.

## 3. The voice gateway (this repo)

```bash
cd Server/agent
uv venv --python 3.13 && uv pip install -r requirements.txt   # or `make install` from repo root
cp ../.env.example ../.env                      # then fill it in (see comments)
./restart.sh                                    # starts the gateway; logs /tmp/koda-gateway.log
```

### `Server/.env` essentials

Start from `Server/.env.example`, which documents every key. The ones you must
set are:

- **`GROQ_API_KEY`** — your key from https://console.groq.com (free tier OK).
- **LiveKit keys** — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`;
  `livekit-server --dev` defaults are `ws://localhost:7880` / `devkey` / `secret`.
- **The brain connection** — three variables that tell the gateway where the
  brain lives and what to run:

  | Variable | Meaning | Typical value |
  |---|---|---|
  | `KODA_ORCH_HOST` | SSH target for the brain host | `you@your-brain-host` |
  | `KODA_ORCH_BIN` | Path to the ZeroClaw binary **on that host** | `~/.zeroclaw/bin/zeroclaw` |
  | `KODA_PROJECT_DIR` | Where the brain reads/writes code | `~/.zeroclaw/agents/default/workspace` |

  The gateway spawns `ssh $KODA_ORCH_HOST $KODA_ORCH_BIN acp` and keeps that
  session warm.

  **Same-machine brain:** set `KODA_ORCH_HOST=local` and the gateway spawns
  `$KODA_ORCH_BIN acp` directly — no SSH, one less failure point, and slightly
  lower latency.

### Alternative: the runtime bridge

Instead of routing work to a ZeroClaw brain, you can run spoken **work**
requests in a fresh, disposable box from the Runtime Layer in `runtime/`.
Recall, status, and greeting still use the brain; only work execution moves.

```bash
# terminal 1 — the runtime HTTP server (Docker must be running)
cd runtime && KODA_API_KEY=<a-secret-of-your-choosing> node dist/server-entry.js

# Server/.env
#   KODA_USE_RUNTIME_JOBS=1
#   KODA_RUNTIME_URL=http://localhost:3100
#   KODA_RUNTIME_TOKEN=<the same secret you passed as KODA_API_KEY>
```

See `runtime/README.md` for the full runtime setup, including the coding-CLI
image and model/provider configuration. When `KODA_USE_RUNTIME_JOBS=0`
(default), work runs on the ZeroClaw brain as described above.

## 4. Point your frontend at it

Room `koda-dev` on your `ws://localhost:7880`, token contract per
`Frontend.md`. Join — Koda greets you first.

## Sanity checks, in dependency order

1. **Brain alone:** on the brain host or via SSH, run the ZeroClaw binary in
   one-shot mode (e.g. `zeroclaw agent --agent default --message "say hi"`) and
   confirm it answers.
2. **SSH path:** `ssh <KODA_ORCH_HOST> '<KODA_ORCH_BIN> --help'` — must run
   without a password prompt. (Skip when `KODA_ORCH_HOST=local`.)
3. **Gateway:** `tail -f /tmp/koda-gateway.log` — look for `[acp] connected`
   and the session-open greeting.
4. **End to end:** join the room from your client and expect the spoken
   greeting.

## Notes

- **Restarts:** use `Server/agent/restart.sh` — it preserves the brain session
  (Koda's memory). `--fresh` starts a clean one.
- **TTS** is chosen by `KODA_TTS` (`edge` | `groq` | `cartesia` | `kokoro`). The
  default is **Sonia via Edge** (`en-GB-SoniaNeural`; `KODA_TTS=edge` or unset —
  free & unlimited, no key, one consistent voice, no fallback; `KODA_EDGE_VOICE`
  overrides). File paths/extensions are spoken correctly by the `speakable()`
  normalizer (`text_normalize.py`). **Orpheus via Groq** (`KODA_TTS=groq`) is a
  selectable alternate; **Kokoro** runs fully locally (free) but wants fast CPU
  cores; **Cartesia** is optional/paid. See `Server/.env.example`.
- The gateway machine and your frontend must reach the same LiveKit server;
  everything else is private to the gateway↔brain pair.
