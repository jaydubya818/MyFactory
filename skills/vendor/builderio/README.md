# Pinned Builder.io Factory instructions

These files come from [BuilderIO/skills](https://github.com/BuilderIO/skills) at commit `fd8f20a879b507cf09feba08663a1edf7a949353` (2026). The source repository's MIT license is copied as `LICENSE`. `MANIFEST.sha256` records the hashes of the copied upstream files.

The nine `SKILL.md` files and their Factory documentation are reference instructions for the agent. They do not install connectors, create schedules, grant permissions, or enforce application policy. The local supervisor implements those capabilities separately.

To verify this copy, run `shasum -a 256 -c MANIFEST.sha256` from this directory. Update it only by reviewing a new upstream commit, copying the selected files, and regenerating the manifest. Historical runs must retain the commit and hashes they used.
