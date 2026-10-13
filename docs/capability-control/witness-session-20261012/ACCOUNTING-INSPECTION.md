# Terminal reservation and lease inspection

The approved terminal receipt reports a Factory admission outcome. It is not a financial release instruction.

MyEve `journey-accounting.ts` projects attributed cost from original model calls and validated Factory ledger observations. `factory-spend.ts` validates original operation identities and forbids releasing dispatched, UNKNOWN, or settled exposure. Neither file performs a reservation mutation.

MyEve migration 0052 `engineering_model_transition` and `EngineeringConversationBudget.releaseUndispatched` provide an exact, locked release of a RESERVED Sofie/native model call. They require the original owner, actor, call ID, dispatch token and request hash, serialize against dispatch, preserve admitted call count, and reject non-RESERVED state. Factory preparation is not one of those model-call purposes and has no qualified mapping to this operation. Reusing it for a Factory decline would invent authority. External Alpha shared accounting deliberately never refunds the full allowance, including cancellation and expiry.

Decision: retain the complete existing Factory preparation reservation for DEFINITELY_NOT_ADMITTED and ADMISSION_UNCERTAIN. The budget impact is the original held amount: available allowance does not increase. Do not infer a numeric amount from the outcome label or release any UNKNOWN exposure. The existing $2.52 UNKNOWN exposure remains unchanged. A later release requires a separately qualified original reservation operation.

Relay owns a separate lease and budget lifecycle. Canonical lease validation binds account, agent, task, action intent and budget reservation, and rejects expired or revoked authority. `expireBudgetReservations` expires only RESERVED rows under the account lock; UNKNOWN rows are not eligible. `reconcileBudgetReservation` requires original reservation and idempotent authoritative usage. Neither is called by a Factory terminal receipt. A decline cannot issue another lease or release its reservation. Expiration removes execution eligibility; it does not prove Factory cleanup or settle UNKNOWN accounting.

The existing maintenance caller `expireFederationContent` derives accounts from expired federation requests. Its existence does not establish an installed Factory-specific maintenance schedule. Retain HOLD until the original Relay owner qualifies the actual expiry/reconciliation call path for the installed binding. Do not silently assume automatic financial release or add a competing lifecycle.

This is source-only inspection. No installed rows, grants, spending ceilings, historical receipts or shared accounting contracts were changed.
