// Install the nightly trigger for the governed overnight loop (macOS launchd).
// It only runs scripts/overnight-run.mjs, which is dry-run unless data/overnight.env
// sets FACTORY_OVERNIGHT_LIVE=1. See docs/OVERNIGHT.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("This installer requires macOS launchd.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = join(root, "data/overnight.env");
if (!existsSync(env)) throw new Error("Create data/overnight.env first (see docs/OVERNIGHT.md).");
const label = "com.myfactory.overnight";
const destination = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const args = [process.execPath, `--env-file=${env}`, join(root, "scripts/overnight-run.mjs")];
const times = [[23, 30], [2, 0]];
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${escape(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StartCalendarInterval</key><array>${times.map(([h, m]) => `<dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`).join("")}</array>
<key>RunAtLoad</key><false/>
<key>StandardOutPath</key><string>${escape(join(root, "data/overnight.log"))}</string>
<key>StandardErrorPath</key><string>${escape(join(root, "data/overnight-error.log"))}</string>
</dict></plist>`, { mode: 0o600 });
const domain = `gui/${process.getuid()}`;
try { execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" }); } catch { /* not loaded */ }
execFileSync("/bin/launchctl", ["bootstrap", domain, destination], { stdio: "inherit" });
console.log(`Installed ${label}: runs at 23:30 and 02:00 local. Run now: launchctl kickstart ${domain}/${label}. Remove: launchctl bootout ${domain}/${label}`);
