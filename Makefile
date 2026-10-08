# Koda v2 — voice-to-voice dev workflow.
#
# Run targets in separate terminals:
#   1. `make livekit`   → LiveKit Server (transport)
#   2. `make agent`     → Pipecat voice gateway (brain)
#   3. either `make app-mac`  → Flutter macOS desktop client
#      or     `make app-ios`  → Flutter iOS device
#      or     `make app-android` → Flutter Android device
#      or     `make playground` → instructions for browser-only testing
#
# Initial setup:
#   make doctor               — verify toolchain
#   make install              — install Python + Flutter deps
#   cp Server/.env.example Server/.env  → fill in GROQ_API_KEY
#   make token                — mint a user token to paste into the app
#
# Conventions:
#   Server/      — Python Pipecat agent + .env + LiveKit deploy material
#   Mobile/      — Flutter cross-platform client
#   Context/     — project knowledge: Glossary, Constitution, ADRs, Plans

UV          ?= $(HOME)/.local/bin/uv
FLUTTER     ?= /opt/homebrew/bin/flutter
LIVEKIT     ?= /opt/homebrew/bin/livekit-server
AGENT_DIR   := Server/agent
MOBILE_DIR  := Mobile

.PHONY: help doctor install install-agent install-mobile livekit agent token web \
        app-mac app-ios app-android playground analyze test fmt clean-mobile

help:
	@awk 'BEGIN{FS=":.*##"; printf "\nKoda v2 — make targets\n\n"} /^[a-zA-Z_-]+:.*?##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Print toolchain versions
	@echo "─ uv ────────────────"; $(UV) --version || echo "  not installed"
	@echo "─ flutter ───────────"; $(FLUTTER) --version | head -1 || echo "  not installed"
	@echo "─ livekit-server ────"; $(LIVEKIT) --version 2>&1 | head -1 || echo "  not installed"
	@echo "─ python ────────────"; python3 --version

install: install-agent install-mobile ## Install all deps (Python + Flutter)

install-agent: ## Install agent Python deps (uv venv @ py3.13 + pinned requirements)
	cd $(AGENT_DIR) && { [ -d .venv ] || $(UV) venv --python 3.13; } && $(UV) pip install -r requirements.txt

install-mobile: ## Install Flutter packages
	cd $(MOBILE_DIR) && $(FLUTTER) pub get

livekit: ## Start the local LiveKit Server in dev mode (devkey/secret)
	$(LIVEKIT) --dev

agent: ## Run the Pipecat voice gateway (requires Server/.env)
	cd $(AGENT_DIR) && $(UV) run python main.py

token: ## Mint a LiveKit JWT for a human participant (override IDENTITY)
	cd $(AGENT_DIR) && $(UV) run python -m scripts.mint_user_token $(IDENTITY)

web: ## Serve the dev token server + browser client (http://localhost:8800)
	cd Server/web && ../agent/.venv/bin/python serve.py

app-mac: ## Run the Flutter app on macOS desktop (requires full Xcode)
	cd $(MOBILE_DIR) && $(FLUTTER) run -d macos

app-ios: ## Run the Flutter app on a connected iOS device or simulator
	cd $(MOBILE_DIR) && $(FLUTTER) run -d ios

app-android: ## Run the Flutter app on a connected Android device or emulator
	cd $(MOBILE_DIR) && $(FLUTTER) run -d android

playground: ## Print instructions for testing the pipeline via LiveKit Agents Playground
	@echo "Browser-only test path (no Flutter / Xcode needed):"
	@echo "  1. In one terminal: make livekit"
	@echo "  2. In another:      make agent"
	@echo "  3. In a third:      make token"
	@echo "  4. Open https://agents-playground.livekit.io"
	@echo "  5. Paste URL ws://localhost:7880 and the token from step 3"
	@echo "  6. Speak. Confirm Koda answers and that interrupting works."

analyze: ## Static-analyze both server and mobile codebases
	cd $(AGENT_DIR) && $(UV) run python -c "import main" && echo "agent imports OK"
	cd $(MOBILE_DIR) && $(FLUTTER) analyze

test: ## Run mobile widget tests
	cd $(MOBILE_DIR) && $(FLUTTER) test

fmt: ## Format Dart sources
	cd $(MOBILE_DIR) && $(FLUTTER) format lib test

clean-mobile: ## Wipe Flutter build artifacts
	cd $(MOBILE_DIR) && $(FLUTTER) clean
