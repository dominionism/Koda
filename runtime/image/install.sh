#!/bin/bash
set -euo pipefail

# Installs development tools for the Koda runtime container.
# Called from Dockerfile — not intended to run standalone.

export DEBIAN_FRONTEND=noninteractive

echo "==> Updating apt and installing base packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  git \
  curl \
  wget \
  build-essential \
  ca-certificates \
  gnupg \
  python3 \
  python3-pip \
  python3-venv

echo "==> Installing Node.js LTS via NodeSource"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y --no-install-recommends nodejs

echo "==> Installing OpenCode (ACP server) ${OPENCODE_VERSION:?OPENCODE_VERSION must be set (see Dockerfile ARG)}"
npm install -g "opencode-ai@${OPENCODE_VERSION}"

echo "==> Installing Bun ${BUN_VERSION:?BUN_VERSION must be set (see Dockerfile ARG)} (OMP's bin runs on bun, not node)"
npm install -g "bun@${BUN_VERSION}"

echo "==> Installing OMP / oh-my-pi (ACP server) ${OMP_VERSION:?OMP_VERSION must be set (see Dockerfile ARG)}"
npm install -g "@oh-my-pi/pi-coding-agent@${OMP_VERSION}"

echo "==> Verifying both agents launch"
opencode --version
omp --version

npm cache clean --force

echo "==> Cleaning up apt cache"
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "==> Done"
