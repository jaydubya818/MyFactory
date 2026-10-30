import {existsSync} from 'node:fs';

// The local V4 preparation is deliberately pinned to one reviewed runtime profile (macOS arm64, Node 24.18.1, Homebrew git 2.48.1 with
// pinned helper digests). Tests that drive real preparation run only where that exact profile exists; elsewhere they are reported as
// skipped with this reason and are never weakened. The pin itself is not configurable.
export const pinnedProfile = process.platform === 'darwin' && process.arch === 'arm64' && process.versions.node === '24.18.1'
  && existsSync('/opt/homebrew/Cellar/git/2.48.1/bin/git');
export const skipReason = 'requires the pinned local V4 preparation profile (darwin/arm64, Node 24.18.1, Homebrew git 2.48.1); not available on this runner';
export const profileTest = (test) => (name, ...rest) => pinnedProfile ? test(name, ...rest) : test(name, { skip: skipReason }, () => {});
