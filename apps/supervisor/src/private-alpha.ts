import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createSupervisor} from './server.ts';
import {loadRealProvider,validateRealProvider,type RealProviderConfig} from './real-provider.ts';
import {providerAuthorization} from './provider-connection.ts';
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
 if(!process.env.FACTORY_DATA_DIR||!isAbsolute(process.env.FACTORY_DATA_DIR))throw Error('An explicit private-alpha FACTORY_DATA_DIR is required');
 const port=Number(process.env.FACTORY_PORT??8789);
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('A valid private-alpha loopback port is required');
 await providerAuthorization(loadRealProvider(config));
 const supervisor=createSupervisor({realProvider:config});
 supervisor.server.listen(port,'127.0.0.1',()=>console.log(`Private-alpha Factory listening at http://127.0.0.1:${port}; live qualification pending`));
 const shutdown=()=>{void supervisor.close().then(()=>process.exit(0));};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
