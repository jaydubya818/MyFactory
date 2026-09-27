# MyEve consumer handoff: MyFactory Work spend

This is an interface handoff only. MyEve remains read-only in this producer task. The producer candidate SHA is recorded in the final task report.

## Existing connected calls

`POST /api/connect/v1/dispatches` retains the existing authenticated `PrepareRequest` shape, including `requestId`, `workId`, `workGeneration`, `deadline`, and `maxSpendUsd`. `maxSpendUsd` is a positive USD amount (at least 0.000001 and at most 20). Preparation creates a durable Work budget in integer micro-USD with `floor(maxSpendUsd × 1,000,000)`. The ceiling is immutable for that Work ID. A later generation/request can use only its remaining balance and cannot replace a cancelled budget. `dispatch` still requires the exact existing writer identity and remains unavailable in default paid mode.

`GET /api/connect/v1/dispatches/:requestId` adds authenticated `spend` readback. For a non-fixture request it has:

```json
{
  "status": "KNOWN or UNKNOWN",
  "currency": "USD",
  "unit": "microUSD",
  "workId": "exact Work UUID",
  "workGeneration": 1,
  "requestId": "exact preparation UUID",
  "workOrderId": "exact MyFactory UUID",
  "deadline": "ISO timestamp",
  "ceilingMicrousd": 1000000,
  "settledMicrousd": 0,
  "retainedMicrousd": 0,
  "availableMicrousd": 1000000,
  "cancelled": false,
  "operations": []
}
```

Every operation binds `operationId`, Work/generation, `dispatchIdentity`, request, WorkOrder, FactoryVersion, run, model, pricing revision, reserved amount, state, and, when settled, provider request ID, authoritative usage and actual amount. `status=UNKNOWN` means at least one operation retains its full reservation. `availableMicrousd` is ceiling minus settled spend and all outstanding/UNKNOWN reservations. Do not interpret it as a provider invoice or refund uncertain exposure.

## Consumer admission and reconciliation

1. Preserve `workId` across generation retries, new attempts, and provider changes. Never issue a fresh Work ID to refresh the budget for the same Work.
2. Compare readback Work/generation/request/WorkOrder against the selected Factory writer binding. A mismatch is a hold, not a fallback to native execution.
3. Require exact terminal Factory reconciliation and Gate C candidate attestation separately. Spend evidence does not grant writer, candidate, publication or Ready authority.
4. Keep an UNKNOWN spend outcome in Current Truth and do not assume release of exposure on STOP, timeout, crash or response loss. The producer denies additional calls once retained plus settled exposure reaches the ceiling.
5. Treat `execution.mode=DISABLED` or `spendEnforced=false` as a hard no-start. `LOCAL_FIXTURE` and `LOCAL_SPEND_FIXTURE` are synthetic test modes only.

## Qualification pin

Local synthetic ledger, gateway and installed CLI-to-loopback routing checks passed. Real paid provider completion, commercial price revision and live credential routing have **not** been qualified. MyEve should consume the interface for local qualification while retaining the live MyFactory gate at **NOT READY**. Do not activate paid dispatch, merge a release gate, or infer a Gate C/Ready result from this handoff.
