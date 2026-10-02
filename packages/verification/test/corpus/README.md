# Permanent Factory qualification corpus

`quantity-safe-integer.json` records the Attempt-8 numeric precision/range escape: implementation-visible checks and protected verification passed, but downstream independent review detected rounded and null output for large positive integer input.

The owner clarified the public contract on 2026-10-02: accept decimal integer quantities from 1 through 9007199254740991 inclusive. Invalid input returns exactly `{"error":"invalid_quantity"}\n`, exit 0, empty stderr. The public corpus includes minimum, maximum, unsafe successors, huge integer, zero, negative, decimal, malformed and whitespace cases.

The captured source is immutable failed-review evidence, not a production implementation. `positiveControl` is a deterministic test double, not a successor candidate. No protected holdout inputs are included in this producer repository.

Required on future FactoryVersion, harness and model qualification changes:

- `npm test` runs the captured failure, byte-exact public checks and independent-review regression.
- `FACTORY_INSTALLED_CLI=1 node --test apps/supervisor/test/numeric-range-checkpoint.test.mjs` qualifies the installed executor against loopback synthetic responses: first-check success, repair, repeated failure and out-of-scope mutation. It verifies host checkpoints, read-only completion, exact-tree commit, signed receipt, fencing and deduplication.
- MyEve owns the independent protected boundary classes and connected lifecycle regression (`FACTORY_NUMERIC_RANGE=1`). Those checks must also pass before a new live qualification.

Synthetic tests do not establish GitHub CI, independent review or owner acceptance for any future candidate. Preserve those downstream gates.
