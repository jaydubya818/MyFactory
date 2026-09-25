# Phase 0 defect fixture

This disposable Node project contains one intentional defect. Use a copied Git repository for a coding-agent exercise; leave this source fixture unchanged so the reproduction stays available.

## Defect report

**Title:** A business with zero annual revenue appears to have no reported revenue.

**Why it matters:** A buyer needs to distinguish a seller-reported `$0` from missing financial data. The formatter currently treats both values as missing.

**Reproduce:** Run `npm test`. The `shows a reported zero instead of treating it as missing` test fails: the function returns `Not provided` for `0`.

**Acceptance criteria:**

1. Numeric `0` formats as `$0`.
2. `null` and `undefined` continue to format as `Not provided`.
3. Positive revenue continues to format as US dollars with thousands separators and no fractional digits.
4. `npm test` passes after the fix.

The fixture has no third-party dependencies or install step. It uses Node's built-in test runner.

## Copy to a disposable Git repository

Run these commands from the MyFactory workspace root:

```sh
fixture_repo="$(mktemp -d /tmp/sellerfi-phase-0-XXXXXX)"
cp -R evals/phase-0-defect/. "$fixture_repo/"
git -C "$fixture_repo" init -b main
git -C "$fixture_repo" add .
git -C "$fixture_repo" -c user.name='Fixture User' -c user.email='fixture@example.invalid' commit -m 'Add reproducible revenue display defect'
cd "$fixture_repo"
npm test
```

The test is expected to fail at this point. The new repository has no remote and contains no credentials. Record its initial commit before starting a local agent attempt.
