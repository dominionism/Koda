FROM ubuntu:24.04

# Pin the agents: the ACP wire shapes are proven against these versions (see
# runtime/tests/fixtures/ for OpenCode; OMP probed live 2026-07-22, same
# nested session/update shapes). Override at build time when re-proving:
#   docker build --build-arg OPENCODE_VERSION=x.y.z --build-arg OMP_VERSION=a.b.c -t koda-runtime image/
ARG OPENCODE_VERSION=1.17.11
ARG OMP_VERSION=17.0.8
# OMP's bin shebang is `#!/usr/bin/env bun` — pinned to the version the
# 2026-07-22 wire probes ran on.
ARG BUN_VERSION=1.3.14

# Install system dependencies and development tools
COPY install.sh /tmp/install.sh
RUN OPENCODE_VERSION=${OPENCODE_VERSION} OMP_VERSION=${OMP_VERSION} BUN_VERSION=${BUN_VERSION} bash /tmp/install.sh && rm /tmp/install.sh

# OMP boot shim — materializes ~/.omp/agent/*.yml from env at start (OMP has
# no env overrides for model/provider config; see omp-launch).
COPY omp-launch /usr/local/bin/omp-launch
RUN chmod +x /usr/local/bin/omp-launch

# Create non-root user
RUN groupadd -r koda && useradd -r -g koda -m -s /bin/bash koda

# Set up workspace
RUN mkdir -p /workspace && chown koda:koda /workspace

USER koda
WORKDIR /workspace

# Bare `docker run` keeps the container idle. The WorkspaceManager overrides
# CMD with the selected agent's acp command (`opencode acp --cwd /workspace`
# or `omp acp`) and creates the container with OpenStdin so the agent's stdin
# stays open (a stdio JSON-RPC server exits on EOF otherwise).
CMD ["sleep", "infinity"]
