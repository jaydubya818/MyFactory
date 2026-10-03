import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {qualifiedImage} from './infrastructure-plan.mjs';
// Protected inputs stay in the Factory control plane. The producer receives
// neither this module nor verifier credentials/files. Candidate is immutable
// before any of these inputs crosses into the separate verifier resource.
export const cloudVerifierPolicy=Object.freeze({version:1,id:'project-slug-protected-v1',image:qualifiedImage,timeoutMs:45000,network:'deny-all',checks:[
 {id:'trim-and-case',input:'  Blue Sky  ',expected:{value:'blue-sky'}},
 {id:'repeated-space',input:'Two   words',expected:{value:'two-words'}},
 {id:'digits-and-hyphens',input:'API-2 Preview',expected:{value:'api-2-preview'}},
 {id:'tab-newline',input:'One\tTwo\nThree',expected:{value:'one-two-three'}},
 {id:'blank',input:'   ',expected:{error:true}},
 {id:'empty',input:'',expected:{error:true}},
 {id:'punctuation',input:'unsafe/name',expected:{error:true}},
 {id:'unicode',input:'café',expected:{error:true}},
 {id:'number',input:42,expected:{error:true}},
 {id:'null',input:null,expected:{error:true}},
]});
export const cloudVerifierPolicySha256=digest(cloudVerifierPolicy);
// No assertion or expected result is evaluated by candidate-controlled code.
// The host compares only a bounded JSON value from this separate process.
export const cloudVerifierProbe=`
const input=JSON.parse(process.argv[1]);
try{const {projectSlug}=await import('/opt/candidate/fixtures/cloud-work/project-slug/slug.mjs');const value=projectSlug(input);process.stdout.write(JSON.stringify({value}));}
catch{process.stdout.write(JSON.stringify({error:true}));}
`;
