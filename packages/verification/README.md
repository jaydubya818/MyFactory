# Exact commit verification

`verifyCandidate` verifies a full Git commit SHA from a local repository. It uses `git archive`, extracts into a temporary directory under the artifact directory, and compares every exported file's content and executable mode with the commit tree. It rejects archives changed by `export-ignore` or `export-subst`, submodules, unsafe paths, and unsupported tree entries. The working tree and `.git` directory are never mounted in the container.

```ts
import { verifyCandidate } from "@factory/verification";

const controller = new AbortController();
const result = await verifyCandidate({
  repositoryPath: "/path/to/repo",
  candidateSha: "full-commit-sha",
  commands: ["node --test"],
  artifactDir: "/path/to/local-factory-artifacts",
  image: "node:22-bookworm",
  signal: controller.signal,
});
```

The default image is the locally qualified `node:22-bookworm` fixture image. Docker uses `--pull=never`, `--network=none`, a read-only `/src` bind mount, a read-only root filesystem, an unprivileged user, no added capabilities, and no host credential or Docker socket mounts. `/tmp` is a 64 MiB in-container tmpfs. Default limits are 1 CPU, 512 MiB memory, 64 PIDs, and 2 minutes per check. Overrides have hard maximums.

The result contains the commit SHA, tree SHA, one status per command (`passed`, `failed`, or `unavailable`), UTC start and finish times, exit code, log path, a clear reason when unavailable, and a JSON manifest path. It writes the manifest after every check. Cancelling the signal kills the Docker CLI process group and attempts `docker rm -f` for the named container; cleanup failures appear in the reason.

Checks that need to write project files cannot run against this boundary. Recognized read-only filesystem errors are reported as `unavailable`; other nonzero command exits are `failed`. Dependencies must already exist in the export or selected image because network access is disabled. Use a trusted, locally available image. An image tag can change locally, and Docker isolation does not guarantee safety against a compromised host daemon or kernel. The archive and Docker CLI calls have bounded timeouts, but a failed Docker daemon can prevent confirmed container cleanup.

Run `npm test --workspace @factory/verification`. Tests use a temporary Git repository and fake Docker executable; they do not run a real container.

References: [Git archive](https://git-scm.com/docs/git-archive), [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/), [Docker run](https://docs.docker.com/reference/cli/docker/container/run/).
