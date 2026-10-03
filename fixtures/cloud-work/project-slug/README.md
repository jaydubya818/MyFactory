# Bounded cloud Work corpus

This is an intentionally incomplete input repository fixture, not production code.
The implementation should trim and lowercase a string, collapse whitespace into
single hyphens, and accept only nonempty names containing ASCII letters, digits,
whitespace and hyphens. Invalid input throws `Error('Invalid project name')`.

Only `fixtures/cloud-work/project-slug/slug.mjs` may change. The visible command is
`node --test fixtures/cloud-work/project-slug/slug.test.mjs`. Initial tests must
fail. The qualification controller must pin the containing repository commit and
tree, materialize them in the cloud, retain the actual candidate, and verify it.

This fixture does not itself qualify cloud Work, a harness, protected verification
or the owner UI. It is distinct from the earlier quantity corpus.
