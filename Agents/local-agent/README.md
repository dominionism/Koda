Local agent (legacy)

This directory contains the historical macOS/Agent TypeScript runtime which the app used in development. ZeroClaw will replace this runtime over time, but we keep it here for reference and for developers who prefer the local runtime.

To run locally:

- cd agents/local-agent
- npm install
- npm run dev

Notes:
- The macOS app looks for a runtime at dist/index.js and package.json. For local development, you can set KODA_AGENT_RUNTIME to point at this directory.
