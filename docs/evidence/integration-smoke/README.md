# Supervisor integration smoke — 2026-09-24

The repeatable command `npm run smoke:docker` copied the intentionally broken fixture to a temporary Git repository, started a persisted WorkOrder, ran its reproduction command against the input commit in offline Docker, applied a **simulated** one-line coding step, committed that scoped change through the supervisor, and reran `npm test` against the exact candidate commit in offline Docker. The coding step was simulated to avoid a second paid Codex call; the real Codex CLI path was separately exercised in [the Phase 0 baseline](../../phase-0-baseline.md).

| Evidence | Result |
|---|---|
| Input commit | `5e510268c9e5715e8d484d748b8a0aea4890081e` |
| Candidate commit | `7d8afa379d233f650302b879d68a5e879f3bf0d0` |
| WorkOrder and Run | `ready_for_review` |
| Baseline reproduction | Failed with the configured expected failure text |
| Candidate `npm test` | Passed; one Check persisted against the candidate SHA |
| History | Started → reproduction → implementation → committed → checked → ready for review |

The [baseline manifest](reproduction/verification-EaW0rt/manifest.json), [baseline log](reproduction/verification-EaW0rt/check-001.log), [candidate manifest](verification/verification-KqvazE/manifest.json), [candidate log](verification/verification-KqvazE/check-001.log), and [patch](candidate.patch) are copied from that run. Manifest paths still refer to the temporary run directory where they were generated. This smoke does not qualify a target repository or GitHub publication.
