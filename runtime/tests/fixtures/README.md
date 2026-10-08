# Protocol fixtures

`opencode_acp_observed_session_flow.jsonl` is a byte-for-byte vendored copy of
Koda-Backend `operator/tests/fixtures/opencode_acp_observed_session_flow.jsonl`
— a session recorded from real OpenCode **1.17.11** over ACP (see that repo's
`operator/docs/opencode-acp-protocol-observations.md` for how it was captured).

It is the shared protocol authority for both repos. `acp-client.test.ts`
replays it against `AcpClient` so the client's wire shapes can never silently
drift from what real OpenCode accepts. If the backend re-records the fixture,
re-vendor it here unchanged.

`opencode_acp_observed_toolcall_flow.jsonl` was captured 2026-07-18 from the
same pinned OpenCode **1.17.11** running inside the `koda-runtime` container
(a real file-write task: 3 `tool_call` + 6 `tool_call_update`, ending in a
verified write of `/workspace/hello.txt`). Agent→client lines only; the 56
`agent_thought_chunk` lines were elided down to two representatives — nothing
else was altered. It is the authority for the tool-call event shapes, which
the original session fixture does not contain (that run used no tools).
