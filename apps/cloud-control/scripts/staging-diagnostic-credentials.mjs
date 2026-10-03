import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { stagingProjectId, stagingTeamId } from '../src/config.mjs';
export async function diagnosticCredentials() {
const config = JSON.parse(await readFile('/private/tmp/myfactory-staging-docker/config.json', 'utf8'));
const stored = config.auths['vcr.vercel.com']?.auth;
let auth;
if (stored) auth = Buffer.from(stored, 'base64').toString();
else {
  if (config.credsStore !== 'osxkeychain') throw Error('UNSUPPORTED_CREDENTIAL_HELPER');
  const entry = JSON.parse(execFileSync('/Applications/Docker.app/Contents/Resources/bin/docker-credential-osxkeychain', ['get'], {input:'vcr.vercel.com\n', encoding:'utf8', stdio:['pipe','pipe','ignore']}));
  auth = entry.Username + ':' + entry.Secret;
}
if (!auth.startsWith('oidc:')) throw Error('PROJECT_OIDC_REQUIRED');
const token = auth.slice(5);
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
if (claims.project_id !== stagingProjectId || claims.owner_id !== stagingTeamId) throw Error('STAGING_IDENTITY_MISMATCH');
return {token, projectId:stagingProjectId, teamId:stagingTeamId};
}
