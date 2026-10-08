# Koda Frontend Integration Guide

How to build a client for Koda's voice tier. Written for frontend developers —
you do **not** need to run Koda's backend, and you do not need any of its keys.

## The one thing to understand

Koda's architecture is a **thin client**: all intelligence (speech-to-text,
routing, the brain, text-to-speech) runs server-side. The frontend is a
**dumb audio pipe** into a [LiveKit](https://livekit.io) room:

```
your app  ──(publish mic audio)──►  LiveKit room  ──►  Koda agent (server-side)
your app  ◄──(play remote audio)──  LiveKit room  ◄──  Koda's voice
```

If your app can (1) join a LiveKit room with a token, (2) publish the mic, and
(3) play the remote participant's audio, the integration is **done**. There is
no app-side AI, no websocket protocol of ours, no REST API to call.

## Connection contract

| Thing | Value |
|---|---|
| LiveKit server | `ws://localhost:7880` (dev: `livekit-server --dev` locally) |
| Room name | `koda-dev` (Koda's gateway reads `KODA_ROOM_NAME`, default `koda-dev`) |
| Koda's identity in the room | `koda-agent` — subscribe to and play this participant's audio |
| Your identity | anything else (e.g. `user`) |
| Token grants | `roomJoin: true`, `room: "koda-dev"`, `canPublish: true`, `canSubscribe: true` |

Always join the room named by the gateway's `KODA_ROOM_NAME` rather than
hardcoding `koda-dev`; `koda-dev` is only the default.

## Getting a token

The gateway ships a small dev token server at `Server/web/serve.py`. It serves
the test page and mints join tokens, reading LiveKit credentials from
`Server/.env` — nothing is hardcoded.

```bash
cd Server/web && ../agent/.venv/bin/python serve.py     # http://localhost:8800
```

`GET /token` returns:

```json
{ "token": "<livekit-jwt>", "url": "ws://localhost:7880" }
```

Connect to `url` with `token`, publish the mic, and play `koda-agent`'s audio.
The `url` comes from `KODA_PUBLIC_LK_URL`, then `LIVEKIT_URL`, then request-host
inference; the port is `KODA_WEB_PORT` (default `8800`).

For development you can also mint a join token yourself with any LiveKit server
SDK:

```js
// npm i livekit-server-sdk
import { AccessToken } from "livekit-server-sdk";
const at = new AccessToken("devkey", "secret", { identity: "user" });
at.addGrant({ roomJoin: true, room: "koda-dev", canPublish: true, canSubscribe: true });
console.log(await at.toJwt());
```

(In production tokens are minted by a backend endpoint, never in the app. For
dev, a script-generated token pasted into the app is fine.)

## Client requirements (these matter — they encode Koda's UX rules)

1. **Never fight server-side turn-taking.** All turn-taking logic lives in the
   gateway. The client must not gate, delay, or override it — its only job is
   to stay out of the way.
2. **Keep the mic open, always.** Never mute or gate the mic while Koda is
   speaking, and do not build push-to-talk. Interruption is sacred: the user
   must be able to talk over Koda and cut it off instantly.
3. **Enable echo cancellation + noise suppression** on the mic track
   (`echoCancellation: true, noiseSuppression: true` — WebRTC defaults in
   browsers; set explicitly on mobile). Without AEC on open speakers, Koda
   hears itself. Headphones are the gold path for testing.
4. **Be ready to play audio immediately on join.** Koda **speaks first** — it
   greets the user the moment the first participant joins, grounded in what it
   last worked on. Handle mobile/browser autoplay policies so that greeting
   isn't swallowed (attach the audio element before/at join, after a user
   gesture).
5. **Don't add client-side VAD, transcription, or "listening" gating.**
   Server-side Silero VAD + Whisper handle everything. Visualize-only is fine.
6. **Latency expectations** (for spinners/affordances, not timeouts): simple
   acks ≈ 1s; questions that need the brain may take a few seconds — Koda
   covers the wait with a spoken holding line, so don't add your own audio
   cues on top.

## Developing without Koda's backend

You don't need it. Run your own LiveKit and build the audio pipe:

```bash
brew install livekit          # or: https://docs.livekit.io/home/self-hosting/local/
livekit-server --dev          # ws://localhost:7880, keys devkey/secret
```

Verify with two clients in the room (your app + a second browser tab using
LiveKit's example app): each should hear the other. If that works, your app
will work against the real Koda unchanged.

## Plaintext (dev-phase flags)

There is no TLS yet (deliberate — native-app phase). Mobile platforms block
cleartext by default, so set the standard dev flags:

- **Android** (`android/app/src/main/AndroidManifest.xml`):
  `<application android:usesCleartextTraffic="true" …>`
- **iOS** (`ios/Runner/Info.plist`):
  ```xml
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsArbitraryLoads</key><true/></dict>
  ```

(When Koda gets a domain + TLS these flags go away; the app just switches to
`wss://`.)

### Web testing note

Browsers block the microphone on plain `http://` for any host except
localhost. The dev test page at `http://localhost:8800` is therefore fine for
browser debugging, but a browser cannot capture mic audio from a non-localhost
plaintext origin — use the native app for that case.

## What you do NOT need (and should not ask for)

- `Server/.env`, Groq/API keys, or SSH access to the brain host — the frontend
  never touches any of it.
- To run anything in `Server/agent/` — that's the backend (Python/pipecat
  gateway). It requires infrastructure you host yourself and is not part of
  frontend dev.

## Repo orientation

- `Server/agent/` — the voice gateway (backend; reference only).
- `Server/web/serve.py` — the dev token server used in the examples above.
- `Context/Guides/Backend.md` — how to self-host the full stack if you want
  independent end-to-end testing.
- `Website/` — the marketing site (unrelated to the voice client).
