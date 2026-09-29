# MyEve consumer handoff: MyFactory Work spend V2

MyFactory producer candidate: see the new committed SHA in the reconstruction dossier; do not use lost `efe9e856`. This is an additive authenticated connected protocol. The V1 handoff remains historical; V1 budgets cannot authorize any paid model call. MyEve owns its consumer code and remains untouched by this producer change.

## PREPARE

`POST /api/connect/v1/dispatches` retains the existing exact fields and adds `spendContract` for paid admission:

```json
{
  "version": "WORK_LEDGER_V2",
  "pricingRevision": "operator-approved-revision",
  "plannedProductiveOperations": 2,
  "plannedCompletionOperations": 1,
  "maxPaidOperations": 3,
  "completionReserveMicrousd": 1200
}
```

The producer derives `perOperationReserveMicrousd = ceil(contextLimitTokens × inputMicrousdPerMillion / 1000000) + ceil(outputLimitTokens × outputMicrousdPerMillion / 1000000)` from its pinned price card. The complete plan must fit **before** a WorkOrder is created: `maxPaidOperations` equals productive plus completion slots; completion reserve covers every planned completion call; productive slots at the full per-call bound plus the protected completion reserve fit within `floor(maxSpendUsd × 1000000)`. Model, revision, card expiry, slot counts, reserve and ceiling are immutable for the Work ID across generations and attempts. An expired card stops further paid admission. There is no price refresh within an existing Work budget.

The default paid execution mode remains **DISABLED**. `LOCAL_SPEND_FIXTURE` is only a backend-injected loopback synthetic provider; an HTTP client cannot enable it. No real provider call is authorized by V2 preparation.

## Dispatch and completion

`dispatch` retains the exact canonical writer identity. The producer records active authority bound to Work/generation/request/WorkOrder/FactoryVersion/run/dispatch identity. Before each Responses call the gateway validates its current pinned card, reserves the full per-call maximum and atomically checks authority, phase, cancel/deadline, generation, pricing, UNKNOWN, ceiling, phase allowance and operation slots. It checks the same state immediately before provider dispatch. A duplicate `operationId` is denied and cannot redispatch; a genuine new attempt consumes a new slot. Process loss retains slot and full reservation as UNKNOWN.

The trusted host ends the productive gateway session after the coding run, verifies its paid operation settled, switches the durable ledger to `completion`, then starts a **separate** child token/session in read-only sandbox for a mandatory completion summary. The worker cannot select its own phase through a model request/header. Completion must contain at least one settled paid operation and all operations must be settled before candidate commit. A failure or UNKNOWN blocks candidate custody. Protected verification and Gate C result handling remain separate.

An unresolved UNKNOWN blocks **all** new paid operations for that Work, even when headroom remains. It persists across restart, cancellation, generation retry and provider change. Only authoritative settlement of the exact operation can clear it; STOP and timeout do not refund it.

## Connected READ

`GET /api/connect/v1/dispatches/:requestId` returns authenticated `spend` readback. The V2 object preserves V1 fields and adds:

| Field | Meaning |
| --- | --- |
| `contractVersion` | `WORK_LEDGER_V2` for paid eligibility; V1 is read-only history |
| `pricingRevision`, `pricingQualified` | Pinned revision and whether its stored expiry is still current |
| `unknownExposureMicrousd` | Full reserved exposure of unresolved UNKNOWN operations |
| `productiveAllowanceRemainingMicrousd` | Productive cap minus productive settled/retained exposure; excludes protected completion reserve |
| `completionReserveMicrousd`, `completionReserveRemainingMicrousd` | Protected completion total and amount not yet exposed |
| `paidOperationsUsed`, `maxPaidOperations` | Durable total slots used and immutable maximum |
| `plannedProductiveOperations`, `plannedCompletionOperations` | Immutable phase slots |
| `completionOperationsUsed`, `completionOperationSlotsRemaining` | Durable completion slot evidence |
| `perOperationReserveMicrousd` | Producer-derived full price-card bound |
| `authorityState` | `prepared`, `active`, or `fenced` |
| `accountingComplete` | All recorded operations are settled; vacuously true before the first operation |
| `phase` | `productive` or `completion` |
| `operations[].phase` | Host-assigned phase of each operation |

All existing `currency`, `unit`, Work binding, ceiling, settled, retained, available, cancelled and operation fields remain. `availableMicrousd` is **not** the productive allowance. `accountingComplete` does not imply a completed run or Factory authority. MyEve must inspect the exact Work/generation/request identity and the Factory terminal, Gate C and independent verifier evidence separately. `UNKNOWN`, non-current pricing, incomplete accounting, unexpected phase/authority or insufficient plan is a hold; no native fallback may overlap uncertain Factory execution.

## Qualification status

The [fresh reconstruction dossier](evidence/myfactory-private-alpha-reconstruction/REPORT.md) records local negative probes, synthetic connected journey, migration checksum and regressions. Actual paid calls, commercial price-card confirmation and live provider completion remain **NOT_RUN**. This handoff does not authorize deployment, paid execution, Ready, publication, or merge.

## Private-alpha loader boundary

The producer contains an explicit, unactivated loader for `OPENAI_RESPONSES_PRIVATE_ALPHA`. It requires endpoint `https://api.openai.com/v1/responses`, model `gpt-5.4-mini-2026-03-17`, and secret reference `keychain://com.myeve.myfactory.q37/openai-provider`. It reads the Keychain item only when called at runtime and returns no secret in errors. The supervisor does not call this loader by default and `executionAvailability` remains `DISABLED` absent a synthetic loopback fixture. Q37 must not treat loader existence as paid/live qualification or enablement. No real key or provider call was used in the reconstruction.
