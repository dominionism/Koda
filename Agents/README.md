Agents workspace

This folder contains agent runtimes used by Koda. The goal is to group "intelligence" runtimes in a single discoverable place.

Structure

- zeroclaw/       — ZeroClaw runtime (Node/TypeScript) — primary VPS-hosted agent
- voice/          — LiveKit voice agent (Python)
- local-agent/    — Legacy local agent runtime (TypeScript) used by the macOS app (deprecated)

Development

- Set KODA_AGENT_RUNTIME to point at a runtime directory during local development so the macOS app can pick it up without bundling.
- Each agent should include a dist/ entrypoint (dist/index.js) and a package.json (or pyproject.toml for Python agents).
