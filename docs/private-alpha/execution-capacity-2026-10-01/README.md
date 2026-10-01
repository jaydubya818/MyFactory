# Attempt 4: bounded execution capacity and local-denial repair

Attempt 4 remains a failed live qualification. One Sofie call and two Factory productive calls settled for $0.014937; the workspace remained unchanged. The two Factory calls selected local inspection tools (listing/search, then reading metadata/tests). Local commands themselves did not consume model slots; each subsequent model continuation did.

## 503 origin and limits of evidence

The exact error body and loopback URL identify MyFactory SpendGateway as the source of the 503. There was no third ledger reservation, so no third upstream model dispatch occurred. Two productive slots were already used. The old catch-all maps reservation denial, identity failure, and upstream failure to the same 503. Replaying two successful calls and a continuation reproduced the local operation-limit denial twice before repair (503 instead of the required terminal 409). The historical caught exception, raw HTTP headers, raw model payloads and provider response bodies were not retained; this report does not claim to distinguish an additional identity failure or attribute the local denial to Vercel/OpenAI. Authoritative usage, timestamps, reservations, settlements, local tool events, retry count and immutable snapshot hashes are in attempt4-sanitized.json. Historical evidence remains private and unchanged.

## Repair

- The existing canonical JobManager assembles bounded repository inventory, relevant README/package/tests and allowed target contents from the approved Git base before paid reasoning. Missing targets are explicit. No extra model or execution path is introduced. Oversized/binary/symlink context fails closed; untracked environment files are not loaded.
- The productive prompt asks the existing CLI to implement and run local checks in its first tool batch. The host preserves the final productive slot unless actual allowed-path source changes exist. Model claims cannot satisfy that check. Concurrent requests cannot race the progress check. This is a progress prerequisite, not proof of correctness: protected verification still decides whether a candidate passes.
- A model that ignores supplied context and only inspects is stopped before consuming the last useful slot. Capacity is preserved; no automatic replacement attempt or false success is generated. First-call implementation followed by one completion-of-turn response fits two productive operations; a separate read-only completion receives candidate context and keeps its own slot/reserve.
- Local capacity/admission rejection returns terminal 409 with a fixed non-secret code. The existing event history receives stage, status, upstream HTTP status if known, operation correlation and elapsed time only. No raw exceptions, headers, tokens or provider bodies are logged.
- HTTP and SSE reconnect retries are explicitly zero for the scoped CLI provider. Upstream 503, missing usage or ambiguous transport remains UNKNOWN with its full reservation retained. No automatic retry is safe under this architecture without authoritative non-execution evidence. No fallback, budget expansion, new writer or new Work is introduced.

## Qualification

The exact quantity objective and source fixture traversed the installed CLI with controlled loopback Responses, local edit/test tools, local candidate commit, signed result/custody, independent Docker verification, canonical PARTIAL Result/Proof and final synthetic Sofie explanation: 5/5 operations. PARTIAL truthfully leaves publication/acceptance unestablished. All connected safety counters are zero. The connected suite also forces a terminal observation race fixed in the paired MyEve repair. No real model operation was performed.

Factory tests: 159 passed and one separately gated installed-CLI test; that installed-CLI 503 test passed explicitly. Typechecks, build and source governance passed. The provider/model identity and client-tool-search contracts remain qualified; the standalone legacy search fixture has its own synthetic plan and does not increase the proposed live five-operation envelope.

Official CLI retry controls were checked against https://developers.openai.com/codex/config-reference/ (`request_max_retries`, `stream_max_retries`) and verified using installed codex-cli 0.157.0 against a loopback-only server.

## Remaining limitation

Synthetic qualification proves the execution contract, not that a real model will follow the efficient tool sequence. A fresh paused Work must receive separate owner authorization before any fifth live attempt. Attempts 1–4, their budgets and historical rows must not be reused. Publication stays disabled.
