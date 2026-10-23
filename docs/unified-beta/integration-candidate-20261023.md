# Cross-platform integration candidate — 2026-10-23

Record only. No production deploy, no migrations, no credential changes, no paid Factory execution, no tester-activation.

## Merged Factory line

| Field | Value |
|---|---|
| GitHub PR | [#21](https://github.com/jaydubya818/MyFactory/pull/21) **MERGED** |
| Merge commit | `9fb3d1a2b068095c7f8b52c627aec83516642f2b` |
| Second parent (head) | `1da82a739b2dd411ac63cdf261963effd5451d94` |
| Base | `beta/unified-candidate-20261022` @ `36535dedc3f670ae16253d75e2f596bc635ce1df` |
| Rollback anchor | `36535dedc3f670ae16253d75e2f596bc635ce1df` |
| `main` | unchanged at `57af525` |
| Vercel `git.deploymentEnabled` | `false` |
| GitHub deployments from this SHA | none |
| Post-merge CI | Environment Fabric [40018399751](https://github.com/jaydubya818/MyFactory/actions/runs/40018399751) **success** on `9fb3d1a` |

Successor files on this line still carry `merge: HOLD` / `deployment: HOLD` / `installedAuthority: NONE` as **qualification labels**. Those are not GitHub merge state. Installed testers are not repinned.

Current Factory sourceDigest on this line: `92c6f5ebae7d0a1a9ca32ab12ef6d7e4c74d806a6f9ed7b000c753fe589a1e7a` (`qa-remediation-confirm-seam-successor.json`).

## Cross-platform pins

| System | State | Pin | Notes |
|---|---|---|---|
| **Relay** | Merged | PR [#40](https://github.com/jaydubya818/relay/pull/40) `fce3f8fe` on `main` | QA-01/08/10/11/35/36. Owner-browser and Relay qualification CI succeeded. |
| **MyFactory** | Merged onto beta candidate | `9fb3d1a` | QA-06/07/08/09/23/24/25/37/39/41/42. Human-presence gate fail-closed. Receipt URL uses deskPort on loopback. |
| **MyEve testers** | Open, **do not merge from this record** | PR [#99](https://github.com/jaydubya818/MyEveBot/pull/99) `5895b129` | Live tester installations and conversations stay on this pin. |
| **MyEve composed CI fixture** | Test-only | `c8eec458` | Environment Fabric checkout only. Not an installed pin. |

## Contract checks run after merge

Local on `9fb3d1a`:

- `cloud-source-identity.mjs` matches `source-identity.json`
- `check-producer-governance.mjs` PASS (151 reviewed sources)
- hosted-intake + QA regressions + pricing-qualification + source-identity-qualification: 19/19 pass

Envelope contract (`MYFACTORY_REQUEST_V1` / `MYFACTORY_RECEIPT_V1`) is unchanged. Receipt `workOrderUrl` remains `http://127.0.0.1:${deskPort}/?workOrder=<id>` (loopback, server-generated id). Relay #40 does not instantiate `HostedIntake`.

Authentication, accounting, owner isolation, Result/Proof, and UNKNOWN recovery were not loosened on this line. Production HTTP capability preflight still requires `FACTORY_EXTERNAL_ALPHA_CAPABILITY_*`. Confirm human-presence: only an injected **function** overrides the platform default; omitted key and forwarded `undefined` keep Touch ID on darwin.

## Next qualified integration candidate

**Candidate id:** `factory-9fb3d1a + relay-fce3f8fe + myeve-tester-5895b129`

**Allowed now**

1. Local no-paid integration: Relay Deep Agent → `FactoryClient` → `GET /api/connect/v1/actions` (`execution.mode: "DISABLED"`) → `POST /api/connect/v1/actions` `workorder.create` / read. Do **not** call `/dispatches/:id/dispatch`.
2. Keep MyEve #99 testers on `5895b129`.
3. Keep Factory production (`main` / Vercel production) off this SHA.

**Not authorized by this record**

- Merge to `main`
- Production deploy, migrations, credential rotation
- Paid Factory execution / dispatch
- Tester-activation or installed FactoryVersion repin
- Changing MyEve live tester conversations

**Still required before describing this tuple as live-qualified**

1. Independent review of the merged beta-candidate tree (head moved after the original `f00ccd8` QUALIFIED SHA).
2. Fresh installation / owner / paid-path qualification for FactoryVersion `02123c60…` if that identity is ever proposed for an install.
3. A separately authorized MyEve change if testers should consume Factory `9fb3d1a`.
