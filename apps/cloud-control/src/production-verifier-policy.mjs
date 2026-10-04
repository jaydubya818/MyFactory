import {digest} from '../../../packages/hosted-routing/src/result.ts';

// Protected host policy for the new canary. Never included in producer context,
// source checkout or root-owned harness files copied into the producer resource.
export const productionCanarySource=Object.freeze({repository:'jaydubya818/MyFactory',commit:'8f1d9527d480a0cb500d188874b35398b0ebcbf1',tree:'32483deb1b36516d58dee7be7ae90b927f5e8b78'});
export const productionCanaryPath='fixtures/production-canary/line-endings/normalize.mjs';
export const productionVerifierPolicy=Object.freeze({version:1,id:'production-line-endings-protected-v1',
 source:productionCanarySource,allowedPaths:[productionCanaryPath],
 image:'vercel/sandbox/node@sha256:6ad1291a9fe7d243ee9f23626e6b08614a596431801c55e14cc5ee9d525f28d1',
 timeoutMs:45000,network:'deny-all',checks:[
  {id:'mixed-line-endings',input:'one\r\ntwo\rthree\nfour',expected:{value:'one\ntwo\nthree\nfour'}},
  {id:'consecutive-cr',input:'a\r\r\nb',expected:{value:'a\n\nb'}},
  {id:'unicode-unchanged',input:'café\r\n🌍\r漢字',expected:{value:'café\n🌍\n漢字'}},
  {id:'whitespace-preserved',input:' \tfirst \r\n last\t ',expected:{value:' \tfirst \n last\t '}},
  {id:'nul-preserved',input:'a\u0000b\r',expected:{value:'a\u0000b\n'}},
  {id:'already-normalized',input:'a\nb\n',expected:{value:'a\nb\n'}},
  {id:'empty-string',input:'',expected:{value:''}},
  {id:'reject-number',input:42,expected:{error:true}},
  {id:'reject-null',input:null,expected:{error:true}},
  {id:'reject-array',input:['a'],expected:{error:true}},
  {id:'reject-object',input:{value:'a'},expected:{error:true}},
 ]});
export const productionVerifierPolicySha256=digest(productionVerifierPolicy);
// Candidate code sees one input only. It never evaluates assertions or emits a
// trusted verdict. The separate host compares bounded output to protected data.
export const productionVerifierProbe=`
const input=JSON.parse(process.argv[1]);
try{const {normalizeLineEndings}=await import('/opt/candidate/fixtures/production-canary/line-endings/normalize.mjs');const value=normalizeLineEndings(input);process.stdout.write(JSON.stringify({value}));}
catch{process.stdout.write(JSON.stringify({error:true}));}
`;
