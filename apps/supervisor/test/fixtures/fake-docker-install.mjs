// Installs the synthetic Docker CLI (fake-docker.mjs) and a private container state directory under `root` for container-mode tests.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installFakeDocker(root, image = {}) {
  const bin = join(root, 'fake-docker-bin'); mkdirSync(bin, { mode: 0o700 }); mkdirSync(join(bin, 'fake-docker-state'));
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!${process.execPath}\nimport ${JSON.stringify(fileURLToPath(new URL('./fake-docker.mjs', import.meta.url)))};\n`, { mode: 0o755 });
  const imageId = image.id ?? 'sha256:' + 'e'.repeat(64);
  writeFileSync(join(bin, 'fake-docker-state', 'image.json'), JSON.stringify({ ...image, id: imageId }));
  const stateDirectory = join(root, 'container-state'); mkdirSync(stateDirectory, { mode: 0o700 });
  const read = name => JSON.parse(readFileSync(join(bin, 'fake-docker-state', name), 'utf8'));
  return { bin, docker, stateDirectory, profile: { imageId, dockerExecutable: docker, stateDirectory }, read, stateFile: join(bin, 'fake-docker-state', 'state.json') };
}
