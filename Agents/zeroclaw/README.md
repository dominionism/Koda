ZeroClaw runtime

ZeroClaw is the VPS-first agent runtime that will be used for persistent, always-on agent instances.

This directory will contain:
- source (src/)
- build output (dist/) with dist/index.js for bundling into the macOS app for local testing
- Dockerfile and infra/ directory with systemd / cloud-init examples for VPS deployment

Development notes:
- To test the macOS app against a local ZeroClaw checkout, set KODA_AGENT_RUNTIME to point at agents/zeroclaw (or the built dist folder inside it).
