Voice agent (LiveKit)

This directory contains the voice agent formerly at Server/agent. It runs the LiveKit-connected conversational voice pipeline.

Running locally:

- cd agents/voice
- python -m venv .venv
- . .venv/bin/activate
- pip install -r requirements.txt (or use pyproject.toml with poetry)
- LIVEKIT_URL=... GROQ_API_KEY=... uv run python main.py

Notes:
- The macOS app expects the agent runtime to expose a dist/index.js and package.json for Node-based agents. For this Python agent, the macOS app won't try to start it; instead, it can be run separately for voice testing.
