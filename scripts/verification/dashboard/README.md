# Dashboard verification profile

This image supplies the frozen dependencies of the designated dashboard baseline
`d1619cc870ad63e4442e078e73dad377dfb3ccf6` (tree
`396f4b7240ef2aaccc79e73f1d2757f9d322f69f`). It contains dependencies and the
check runner, not application source. `package.json` and `package-lock.json` are
byte-identical copies from that baseline and must match the candidate.

Run `node scripts/verification/dashboard/build.mjs` from the Factory checkout.
It builds with the pinned multi-platform Node 24.18.1 base image digest. The build needs
anonymous public registry access for locked npm packages, Chromium and Debian
browser libraries. It requires no account credentials. npm lifecycle scripts
are disabled. This is ordinary local image preparation, not provider execution.

The verification command is:

```
node /opt/qdev-dashboard/check.mjs
```

Use the resulting immutable Docker image ID in the host's productive binding.
The existing verifier still mounts the complete candidate read-only and runs
non-root with no network, no added capabilities, a read-only root filesystem and
the fixed browser resource profile (one CPU, 1 GiB, 192 processes, two minutes per
check). Its resource mapping is bound by the producer source digest; the image
ID is bound by the signed execution configuration. The default image's original
512 MiB / 64-process limits are unchanged. Chromium exhausted that original
process budget during the baseline qualification. No dependencies or source files are copied into a writable
workspace. Typecheck, Vite build and the candidate's browser tests run in one
container, with output/cache files in its disposable `/tmp` only. A dependency
or package-script change requires review and a newly built profile.

The profile limits Node's V8 and libuv thread pools to fit the one-CPU envelope.
The preview server invokes the installed Vite executable directly with the
candidate's unchanged Vite configuration. The baseline's browser configuration
and both viewport projects remain in use; only server/output paths are overridden.

This profile's browser suite is project testing evidence. It does not supply the
separately custodied independent acceptance specification, a PASS signature,
publication authority, or evidence of real coding-agent execution.
