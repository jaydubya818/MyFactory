# MyApps Phase 3B — inactive QE compatibility

Preserved preparation: `4c6e540b40e1db226eefda763e615dfe7cb02e3c`.
Candidate input: `18e59dbedbe04275858327ca47d2bd7ec01a407c`.
Companion MyEve QE candidate: `c640f255fe2b8d1aeecc4c4c99bb28675b2ee5e8`.

This branch adds qualification preparation only. Candidate source is composed into detached test snapshots by MyEve's pinned materializer; no dependency branch is adopted. MyApps controller/custody/verifier/Result bytes remain identical to accepted Phase 2.

The QE candidate adds individually bound criterion checks, a shared report digest and a successor verification-policy identity. MyEve's corresponding Result parser/Proof projection must be qualified with it. Aggregate-only historical evidence is never relabeled. Candidate custody, owner acceptance and MyApps installation remain separate decisions.

Adding MyApps changes the Factory source digest even after QE's own repin. The composed source must fail the installed-source identity guard. A successor FactoryVersion requires the final exact tree plus executor/verifier/custody/configuration/model/pricing identities, and separate operational qualification. No source-identity JSON, installed registration, authority or key is rewritten here.

The MyEve Phase 3B plan and non-executable production authorization envelope identify migration/central SQL ordering and target prerequisites. Production remains NOT_READY and integration NOT_RUN. No paid model operations, deployment, merge, publication, installation or production grants are authorized. Existing external-alpha installation and accepted Phase 2/3 refs remain unchanged.
