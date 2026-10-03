# Hosted CI divergences and repairs

First hosted run: https://github.com/jaydubya818/MyFactory/actions/runs/36977782000 at `b9b71cfc4d82c22b51abca5abb87329eeb41efb7` failed. [Original failure log](evidence/ci-first-run.txt) is retained.

1. Four connected completion tests exercise the actual existing `verifyWorkspaceTree` Docker boundary with `--pull=never`. The fresh runner lacked `node:22-bookworm`. CI now explicitly pulls the existing local verifier image before the suite. No verification policy or cloud runtime was changed, and no test was skipped to obtain a pass. This image is not a qualified cloud runtime.
2. The existing process-start ordering test exposed lost output on Linux: the child could exit while the asynchronous start receipt was awaited, before stdout/stderr consumers were attached. Node can drain unread child pipes at exit. The regression now holds the start callback until the child has actually exited instead of relying on a 30ms delay. This failed locally before the fix with status `failed` instead of `completed`.

The harness now subscribes to bounded output capture immediately. Event interpretation waits for the durable start receipt; failed persistence still rejects completion. Cancellation, output bounds, event-backed completion, exit-code checks and process-group cleanup are unchanged. The [15-test harness regression](evidence/process-capture.txt) passes, including persistence failure and cancellation. This is the only additional harness runtime repair in the Environment Fabric checkpoint; it addresses an observed CI failure rather than redesigning the harness.

The full suite, types, governance and build must pass again for the repaired source, followed by a successful hosted run. Neither local nor hosted deterministic tests establish connected cloud or Mac-off qualification.
