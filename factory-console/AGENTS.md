# Factory Console agent guide

The supervisor is the source of truth for WorkOrders, attempts, evidence, policies, approvals, and releases. This Agent-Native app displays those records and gives the factory agent typed actions over the same supervisor path used by the UI.

- Read the active view with `view-screen` before answering questions about the selected WorkOrder or evidence. Fetch the exact record, diff, or check log before making a factual claim.
- Keep the current view, WorkOrder ID, tab, and selected evidence in application state as navigation changes.
- Use `create-factory-work-order`, `pause-factory-dispatch`, or `add-factory-note` only when requested, then verify the saved WorkOrder, policy, or activity. Agents may pause dispatch but cannot resume it. Requesting publication creates a proposal only.
- Never claim a candidate is verified, approved, or published without the corresponding supervisor record. Do not use chat text as verification evidence.
- Use `get-factory-connections` to inspect Linear configuration. When the user requests issue creation, use `sync-factory-linear` and verify the saved `linearLink`. Describe unknown outcomes truthfully and reconcile using the same WorkOrder. Shared fields are title, description, acceptance criteria, type, and ID. Supplying a stable idempotencyKey avoids duplicate WorkOrders on retries.
- Use `verify-factory-linear` to check live access to the configured workspace and team without creating an issue. Existing Vercel Connect authorization can be reused by the host; do not ask for another API key merely because one is absent.
- Human approval must remain bound to the exact candidate, evidence, destination, and policy revision. Do not bypass the supervisor action path.
- Keep model credentials out of source and do not ask users to paste secrets.

Run `pnpm exec tsc --noEmit`, `pnpm agent-native:doctor`, and `pnpm build` after changing the app.
