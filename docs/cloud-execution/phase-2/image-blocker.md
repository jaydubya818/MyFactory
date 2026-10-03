# Image acquisition: resolved through provider-native Sandbox API

Current status: RESOLVED for the supported managed image path, 2026-10-02 07:12 UTC. No owner action is required.

`Sandbox.create()` with SDK 3.5.1 resolves `vercel/sandbox/node:24` through `/api/v3/sandboxes` and returns immutable image `vercel/sandbox/node@sha256:6ad1291a9fe7d243ee9f23626e6b08614a596431801c55e14cc5ee9d525f28d1`. [Discovery evidence](provider-diagnosis/managed-node.json) and [pinned image qualification](provider-diagnosis/image-ebcd8099-c810-4764-bec3-b3c3ed918bb2.json) are CONNECTED PASS. All diagnostic sandboxes were stopped, deleted and confirmed absent.

The earlier inference from direct registry manifest 404 to managed runtime unavailability was incorrect. The supported Sandbox resolver succeeds with the same staging account, region and Node tag. The provider-internal reason for direct registry 404 is unknown. Custom-image TLS failures occurred after authentication and upload initialization, during layer PATCH/PUT transfer/finalization, before manifest publication; their underlying cause remains unknown and is now nonblocking. TLS was not weakened.

Qualification observed Node v24.19.0, Git 2.53.0, linux/x64, dedicated producer uid 1001 without sudo, verified HTTPS CA trust, deny-all public/metadata egress, separate fresh filesystems and clean teardown. Secret/repository checks cover known credential environment names and file locations; they are not an exhaustive image audit. No application credentials, repository, owner data or verifier material were injected.

## Historical blocker at checkpoint 7a69c47

The following records the diagnosis and requested action as of 2026-10-02 05:15 UTC. It is preserved as historical evidence, superseded by the resolution above.

Target: Vercel team `team_p8z8exJRTGfOPk1GC9vUOpv3`, staging project `prj_IRXTY6HOzS2q9wRPdabsJnmddzl4`, private VCR repository `repo_hA2FvWTkS9VauoNnaSAJnDh97lge` (`jaydubya818/myfactory-cloud-staging/factory-worker`).

The project-scoped OIDC login, repository creation, repository listing, private Blob access, database access and hosted Sandbox API read all succeed. The worker builds as linux/amd64 with Node `v24.21.0`, Git `2.39.5`, a non-root `node` user and `/workspace`. Dockerfile base is pinned by digest. No owner data, application keys or paid-model credentials are in the build context.

## Observed failures

1. Documented managed image `vcr.vercel.com/vercel/sandbox/universal:latest`: authenticated manifest lookup returns 404 `not_found`.
2. Documented managed image `vcr.vercel.com/vercel/sandbox/node:24`: independent authenticated HEAD/GET lookup returns 404 `not_found`.
3. Docker legacy build succeeds; push closes the connection during layer finalization. One content-addressed retry fails on the same layer. Retained retry: `image-push.log`.
4. Installed Buildx was initially invisible to the isolated Docker config. Adding its existing plugin directory enables the documented zstd build/upload path. Build succeeds; upload fails with `remote error: tls: bad record MAC`. Retained: `image-buildx.log`; CLI invocation `fd2ab7a4-140f-4a12-8a55-d1f8601b5951`.
5. Official Google `crane` v0.22.1, running on the Mac host independently of Docker Desktop's daemon proxy, also fails uploading the same secret-free image with `remote error: tls: bad record MAC`. Retained: `image-host-upload.log`.

The host-client reproduction means the failure is **not established to be Docker Desktop only**. The failing boundary is authenticated TLS layer upload to VCR; the responsible provider/network component is unknown. TLS validation was never disabled. No global proxy, trust-store, Docker or system network configuration was changed.

Final provider readback: `registry-images.json` contains no published image; `sandbox-inventory.json` contains no sandboxes and no next page. No runnable manifest/digest is available. Partially uploaded registry layers may remain provider-side; their cleanup/storage accounting is not established. This is an image-distribution failure, not a failed paid-model canary or a passing cloud Work attempt.

## Required external action

Restore a working authenticated VCR upload path for this dedicated staging repository (provider/network diagnosis), **or** make an existing compatible Node 24 + Git linux/amd64 image available to this staging project by immutable VCR digest. It must support unprivileged execution and must not contain production credentials/data. Keep the registry private or explicitly shared only as required. Do not disable TLS verification or copy private-alpha publisher credentials as a workaround.

No image-provider or hosting architecture switch has been made. The prepared allocation plan will accept only a digest pinned within `factory-worker` in this staging project; a separately shared image requires deliberate reviewed configuration. Once image access is repaired, inspect its readiness and exact digest before the first bounded infrastructure attempt.

## Work remaining after unblock

The allocation plan and two deterministic boundary tests are prepared; the cloud allocation controller is **not implemented or exposed**. Complete durable allocation/reconciliation, exact source checkout, deny-all execution, artifact collection/hash readback and teardown. Then qualify the existing harness, independent verifier, canonical Result/Proof and product P0 journey. The hosted readiness service deliberately continues to return `ready=false` and HTTP 503. No phase is advanced because the image merely built locally.
