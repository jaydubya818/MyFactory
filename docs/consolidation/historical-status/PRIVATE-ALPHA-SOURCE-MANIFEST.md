# Historical pre-scope status — superseded

# Private-alpha source manifest

**LOCAL CANDIDATES QUALIFIED; CANONICAL MERGE BLOCKED ON RELEASE SCOPE AND INDEPENDENT REVIEW.**

| Repository | Unchanged remote canonical main | Qualified candidate checkpoint | Migration head |
|---|---|---|---|
| MyEve | `d64f2f96003818b2f51341b54a2edd6f426a0dae` | `1b72192957d603a60221b7c13937a3af4b68fa47` | 0068; 64 canonical files, immutable legacy ledger bridge |
| Relay | `1da025e4dc234acdc1e6546c4770ccf733611967` | `5053693d5d6352caad4c98df9c8d22b297d5f9c8` | 0028; 29 Drizzle entries |
| MyFactory | `8c5de7794ffa377420ef5dcdbda44aa9fa2328b8` | `6e164ca2f3c58a7bf2d0c905c0908dfea0ceadf9` | SQLite v8 |

Candidate refs are `origin/codex/canonical-consolidation`. Later evidence/documentation commits may descend from these implementation pins; the final handoff reports the exact pushed tip. Remote main remains unchanged.

Accepted MyEve inputs: final Beta `52b3891a2685307cbb50bba97680070700df4cc0` (tested implementation `506bbd1`), Q37 `cf83e3b` within Beta, Product Expansion `ef07717` and Work Canvas handoff through `9caacf6`. Product delta was integrated selectively without replaying initial Beta UX. Source scope and test fixture boundaries remain explicit.

MyFactory `efe9e856f8fffbdb785497444a08d39e54d8f78d` is historical qualified evidence whose source became unrecoverable. `925530a6ba8764df6a7b8637192fe32edcbaff97` is a durable reconstruction, not byte-equivalent recovery. The qualified consolidation successor above contains it. A handoff is incomplete until the exact commit is pushed and remotely verified.

## Required decisions before canonical merge

1. The requested two-owner shared-business journey cannot pass from the available implementation. Product Expansion explicitly leaves membership, shared Goal/Result audiences, revocation and Rooms as unallocated schema proposals. Private-owner isolation passes, but it is not shared-business acceptance. Product-owner decision pending: explicitly defer this release gate for consolidation, or implement/qualify the shared scope before merge. No authority model was invented during cleanup.
2. Final independent review of the combined candidate remains PENDING. Component reviews are retained but do not replace this gate. This session requires explicit authorization before delegating; a request for one read-only reviewer is pending. No review agent has been started.

No canonical merge/push, post-merge qualification, milestone tag or cleanup has occurred. These gates remain required after the decisions. The disconnected Work Canvas preview is not a production approval, email, publication or sharing implementation. Live provider execution and deployment remain NOT_RUN and are outside this consolidation authorization.


Local source readiness is not deployment readiness. Post-merge critical regression, fresh canonical clone, final safety matrix, tags and cleanup remain NOT_RUN.
