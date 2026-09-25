# Factory Console agent guide

The supervisor is the source of truth for WorkOrders, attempts, evidence, policies, approvals, and releases. This Agent-Native app displays those records and gives the factory agent typed actions over the same supervisor path used by the UI.

- Read the active view with `view-screen` before answering questions about the selected WorkOrder or evidence. Fetch the exact record, diff, or check log before making a factual claim.
- Keep the current view, WorkOrder ID, tab, and selected evidence in application state as navigation changes.
- Use `add-factory-note` for a requested safe record change and verify it appears in the WorkOrder activity. Requesting publication creates a proposal only.
- Never claim a candidate is verified, approved, or published without the corresponding supervisor record. Do not use chat text as verification evidence.
- Human approval must remain bound to the exact candidate, evidence, destination, and policy revision. Do not bypass the supervisor action path.
- Keep model credentials out of source and do not ask users to paste secrets.

Run `pnpm exec tsc --noEmit`, `pnpm agent-native:doctor`, and `pnpm build` after changing the app.
