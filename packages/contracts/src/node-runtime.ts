/** Node-only transport prerequisite. This grants no execution or installation authority. */
export function assertPatchedNodeRuntime(node = process.versions.node, undici = process.versions.undici): void {
  const version = /^24\.(\d+)\.(\d+)$/.exec(node ?? "");
  const transport = /^(\d+)\.(\d+)\.(\d+)$/.exec(undici ?? "");
  if (!version || Number(version[1]) < 22 || (Number(version[1]) === 22 && Number(version[2]) < 1) ||
      !transport || Number(transport[1]) !== 7 || Number(transport[2]) < 30 ||
      (Number(transport[2]) === 30 && Number(transport[3]) < 1)) {
    throw new Error("PATCHED_NODE_RUNTIME_REQUIRED");
  }
}
