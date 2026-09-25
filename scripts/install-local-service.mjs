import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if(process.platform !== 'darwin') throw new Error('This installer requires macOS launchd.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env=join(root,'data/connections.env');
if(!existsSync(env)) throw new Error('Configure data/connections.env first.');
const label='com.myfactory.supervisor';
const destination=join(homedir(),'Library/LaunchAgents',`${label}.plist`);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const args=[process.execPath,`--env-file=${env}`,join(root,'apps/supervisor/src/server.ts')];
mkdirSync(dirname(destination),{recursive:true});
writeFileSync(destination,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg=>`<string>${escape(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${escape(join(root,'data/supervisor.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(root,'data/supervisor-error.log'))}</string>
</dict></plist>`,{mode:0o600});
const domain=`gui/${process.getuid()}`;
try{execFileSync('/bin/launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'});}catch{}
execFileSync('/bin/launchctl',['bootstrap',domain,destination],{stdio:'inherit'});
console.log(`Installed ${label}. It starts at login and restarts after failure. Stop with: launchctl bootout ${domain}/${label}`);
