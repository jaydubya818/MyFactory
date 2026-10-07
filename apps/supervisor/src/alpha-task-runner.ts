import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export interface RunResult { exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }
export interface Workspace { dir: string; scratch: string; dispose(): Promise<void> }
export interface IsolationReport { fsConfined: boolean; networkDenied: boolean; envScrubbed: boolean; detail: string }
/** Where untrusted candidate code runs. The verifier never executes candidate code in its own process. */
export interface VerifierRunner {
  readonly id: string;
  isolation(): Promise<IsolationReport>;
  /** Writes exactly the given in-memory files (already digest-checked) into a fresh private directory. */
  workspace(files: Record<string, string>): Promise<Workspace>;
  node(ws: Workspace, args: string[], options: { timeoutMs: number }): Promise<RunResult>;
}

const OUTPUT_LIMIT = 262_144;
/** The only environment candidate code ever sees: no credentials, no ambient configuration. */
export function scrubbedEnvironment(scratch: string): Record<string, string> {
  return { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: scratch, NODE_ENV: "test", CI: "1", LANG: "C", NO_COLOR: "1" };
}
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const NO_NETWORK = "(version 1)(allow default)(deny network*)";

function safeRelative(path: string): boolean {
  return path.length > 0 && path.length < 200 && !path.startsWith("/") && !path.includes("\0") && !path.includes("\\") &&
    path.split("/").every((p) => p !== "" && p !== "." && p !== ".." && p.toLowerCase() !== ".git");
}

function spawnBounded(file: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const finish = (exitCode: number | null) => { if (settled) return; settled = true; clearTimeout(timer); done({ exitCode, timedOut, stdout, stderr }); };
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    child.stdout.on("data", (c: Buffer) => { if (stdout.length < OUTPUT_LIMIT) stdout += c.toString("utf8"); else kill(); });
    child.stderr.on("data", (c: Buffer) => { if (stderr.length < OUTPUT_LIMIT) stderr += c.toString("utf8"); });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Local runner. Filesystem confinement uses the Node permission model (read: the
 * workspace only; write: its scratch directory only; no child processes, workers
 * or addons). Network denial uses the macOS sandbox profile when present and is
 * PROVEN by a live self-test before it is claimed; on any host where it cannot
 * be proven the report says so and the verifier degrades to PARTIAL.
 * A cloud runner supplies the same interface with an external deny-all resource.
 */
export function localNodeRunner(options: { network?: "auto" | "none" } = {}): VerifierRunner {
  let cached: Promise<IsolationReport> | undefined;
  const wrap = (args: string[]): { file: string; args: string[] } =>
    process.platform === "darwin" && existsSync(SANDBOX_EXEC) && options.network !== "none"
      ? { file: SANDBOX_EXEC, args: ["-p", NO_NETWORK, process.execPath, ...args] }
      : { file: process.execPath, args };
  const runner: VerifierRunner = {
    id: "local-node-permission-v1",
    async workspace(files) {
      const base = await realpath(await mkdtemp(join(tmpdir(), "alpha-verify-")));
      const dir = join(base, "tree"), scratch = join(base, "scratch");
      await mkdir(dir, { mode: 0o700 }); await mkdir(scratch, { mode: 0o700 });
      for (const [path, text] of Object.entries(files)) {
        if (!safeRelative(path) || typeof text !== "string") { await rm(base, { recursive: true, force: true }); throw new Error("VERIFIER_PATH_REJECTED"); }
        const target = resolve(dir, path);
        if (!target.startsWith(dir + sep)) { await rm(base, { recursive: true, force: true }); throw new Error("VERIFIER_PATH_REJECTED"); }
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, text, { flag: "wx", mode: 0o600 });
      }
      return { dir, scratch, dispose: () => rm(base, { recursive: true, force: true }) };
    },
    async node(ws, args, { timeoutMs }) {
      const flags = ["--permission", `--allow-fs-read=${ws.dir}`, `--allow-fs-read=${ws.scratch}`, `--allow-fs-write=${ws.scratch}`];
      const w = wrap([...flags, ...args]);
      return spawnBounded(w.file, w.args, { cwd: ws.dir, env: scrubbedEnvironment(ws.scratch), timeoutMs });
    },
    isolation() {
      cached ??= (async () => {
        const ws = await runner.workspace({ "probe.mjs": "" });
        const server = createServer();
        try {
          await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
          const port = (server.address() as { port: number }).port;
          const script = [
            "import fs from 'node:fs'; import net from 'node:net';",
            "const bad = [];",
            "try { fs.readFileSync('/etc/hosts'); bad.push('read'); } catch {}",
            "try { fs.writeFileSync('/private/tmp/alpha-verifier-escape', 'x'); bad.push('write'); } catch {}",
            "const extra = Object.keys(process.env).filter((k) => !['PATH','HOME','TMPDIR','NODE_ENV','CI','LANG','NO_COLOR','PWD','SHLVL','_','__CF_USER_TEXT_ENCODING'].includes(k));",
            "if (extra.length) bad.push('env');",
            `await new Promise((r) => { const s = net.connect(${port}, '127.0.0.1'); s.on('connect', () => { bad.push('net'); s.destroy(); r(); }); s.on('error', () => r()); setTimeout(r, 2000); });`,
            "process.stdout.write('RESULT ' + JSON.stringify(bad));",
          ].join("\n");
          const run = await runner.node(ws, ["--input-type=module", "-e", script], { timeoutMs: 8000 });
          const match = /RESULT (\[.*\])/.exec(run.stdout);
          const bad: string[] = match ? JSON.parse(match[1]!) : ["selftest"];
          return {
            fsConfined: !bad.includes("read") && !bad.includes("write") && !bad.includes("selftest"),
            networkDenied: !bad.includes("net") && !bad.includes("selftest"),
            envScrubbed: !bad.includes("env") && !bad.includes("selftest"),
            detail: bad.length ? `isolation self-test violations: ${bad.join(",")}` : "isolation self-test clean",
          };
        } catch { return { fsConfined: false, networkDenied: false, envScrubbed: false, detail: "isolation self-test could not run" }; }
        finally { server.close(); await ws.dispose(); }
      })();
      return cached;
    },
  };
  return runner;
}
