# Sofie staging access approval boundary

The VCR image blocker is resolved. The dedicated staging infrastructure-only
lifecycle passed: exact source, deterministic checks, private artifact custody,
readback and confirmed sandbox deletion. This does not establish canonical cloud
Work, the Codex harness, independent verification, Mac-off or Playwright P0.

The next deployed client is `sofie-cloud-qualification`
(`prj_XU7fJW735PtsnKoAYtGfzdnsotIB`). Its separately provisioned empty owner-side
Neon database has the canonical MyEve migrations. Factory execution state and
custody remain exclusively in `myfactory-cloud-staging`
(`prj_IRXTY6HOzS2q9wRPdabsJnmddzl4`).

## Concrete requested action

Create one named Protection Bypass for Automation secret on the dedicated
**MyFactory staging project**, and store that secret only in Sofie's isolated
staging backend configuration and the operator's protected qualification setup.
Send it as the `x-vercel-protection-bypass` header alongside the separate
Factory application bearer credential. Never use URL query parameters, expose it
to the browser, or pass it to a producer/verifier sandbox.

This provider secret applies to **all deployments within this staging project**
until revoked; it is not path-scoped. Possession bypasses provider deployment
protection and certain provider security checks. The canonical Factory API still
requires its independent staging client credential and exact source/Work grants.
It grants no Factory database, artifact store, worker-control, signing, verifier
or publication credentials. No existing production project or resource changes.

References: [Vercel protection-bypass behavior](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
and [creation API](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation).

## Why this requires Jay

Automatic approval review rejected creation of this persistent project-scoped
bypass because that security change and its scope were not explicitly approved.
The rejected action did not execute. No new bypass was created, and no existing
bypass was copied into Sofie to circumvent that rejection. Ordinary staging
application/signing credentials were created separately as sensitive preview-only
variables under the previously authorized staging scope.

The project already had one provider bypass entry from earlier operator work;
this does not authorize extending that credential to a new hosted client. Its
value was not retrieved or redistributed in this step. Existing deployment
protection remains enabled.

## Qualification status at this boundary

- Provider image and infrastructure-only hosted lifecycle: CONNECTED PASS.
- Hosted queue infrastructure receipt after requester exit: CONNECTED PASS.
- Canonical PostgreSQL dispatch/custody/cancellation/terminal/limit tests:
  CONNECTED PASS in isolated schemas, 8 checks.
- Deterministic worker/source/Git candidate/patch/signature pipeline: local
  deterministic test PASS; **not a cloud Work PASS**.
- New canonical hosted Work execution: NOT_RUN.
- Qualified Codex harness in cloud: NOT_RUN.
- Independent cloud verifier: NOT_RUN.
- Sofie/browser-off/restart/Mac-off/P0 Golden Journey: NOT_RUN.
- Public cloud admission: DISABLED. Paid model calls: 0. Publication effects: 0.

After approval, qualify the deployed authenticated client contract first, then
resume the existing deterministic cloud Work/harness/verifier/product gates.
Do not use the image or deployment success as authorization for a paid canary.
