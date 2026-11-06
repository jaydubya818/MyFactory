import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import type { CodexAdapter, CodexRunOptions } from '../../../packages/agents/src/index.ts';

/**
 * Native (uncontained) metered execution exists ONLY for synthetic qualification with a fixture stand-in executable. Jay's approval forbids
 * native tester execution, so any real Codex executable is refused regardless of the provider URL (a loopback reverse proxy to the real
 * provider would otherwise reopen native execution). A stand-in is a small script that carries the marker and neither is nor invokes
 * the real `codex` binary. Checked at composition and again before EVERY native run (the file could be swapped afterwards).
 */
export const NATIVE_FIXTURE_MARKER = 'MYFACTORY_NATIVE_FIXTURE_STAND_IN_NOT_CODEX';
const MAX_BYTES = 64 * 1024;
// Any reference that could start the real CLI: the lowercase command token, the npm package, its native vendor binaries.
const REAL_CODEX = /(^|[\s'"`/=(,;])codex(?=$|[\s'"`;),])|@openai\/codex|codex-(?:aarch64|x86_64)|\/vendor\/[^\s'"`]*codex/m;
export class NativeExecutionRefused extends Error { readonly code = 'NATIVE_METERED_EXECUTION_REFUSED'; }

export function assertNativeFixtureStandIn(path: string): void {
  let real: string, text: string;
  try {
    real = realpathSync(path);
    const st = lstatSync(real);
    if (!st.isFile() || st.size > MAX_BYTES) throw Error();
    text = readFileSync(real, 'utf8');
  } catch { throw new NativeExecutionRefused('Native metered execution refused: executable is not a fixture stand-in'); }
  if (!text.startsWith('#!') || !text.includes(NATIVE_FIXTURE_MARKER) || REAL_CODEX.test(text))
    throw new NativeExecutionRefused('Native metered execution refused: only a marked fixture stand-in (never the real Codex) may run uncontained');
}

/** Wraps the native adapter so every run and preflight re-proves the stand-in before any process exists. */
export function fixtureOnlyNativeAdapter(base: CodexAdapter, executable: string): CodexAdapter {
  assertNativeFixtureStandIn(executable);
  return {
    runCodex: (options: CodexRunOptions) => { assertNativeFixtureStandIn(executable); return base.runCodex(options); },
    preflightCodex: () => { assertNativeFixtureStandIn(executable); return base.preflightCodex(); },
  };
}
