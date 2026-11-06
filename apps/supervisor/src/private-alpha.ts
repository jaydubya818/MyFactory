import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {loadRealProvider,validateRealProvider,type RealProviderConfig} from './real-provider.ts';
import {oidcPreflight} from './oidc-preflight.ts';

// Configuration contains a scoped identity or Keychain reference, never credentials.
const file=process.env.FACTORY_REAL_PROVIDER_CONFIG;
if(!file||!isAbsolute(file))throw Error('An absolute FACTORY_REAL_PROVIDER_CONFIG path is required');
const config=JSON.parse(readFileSync(file,'utf8')) as RealProviderConfig;
validateRealProvider(config);
if(process.argv.includes('--check')){
 console.log('Private-alpha provider configuration valid. Credential, provider access and live execution remain unqualified.');
}else if(process.argv.includes('--preflight')){
 if(config.mode!=='VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA')throw Error('OIDC configuration required for non-generating preflight');
 console.log(JSON.stringify(await oidcPreflight(config,loadRealProvider(config))));
}else{
 // Closed (Jay, 2026-11-05): this entry point ran the real Codex natively with no container or hosted limits. Use the LOCAL_V4 host
 // with the metered container route. Refused before any credential, provider or listener is touched.
 throw Error('Legacy private-alpha native execution is closed: use scripts/local-v4-host.mjs with the metered container route');
}
