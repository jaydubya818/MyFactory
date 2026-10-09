export interface LocalExecutionConfiguration {
  provider: 'local-docker'; providerVersion: '1'; implementationSha256: string;
  runtimeSha256: string; hostQualificationSha256: string; image: string;
  policySha256: string; verificationPolicySha256: string;
  evidenceClass: 'DETERMINISTIC'; modelProvider: 'none';
  harnessSha256: string;
  resources: { vcpus: 1; memoryMb: 256; pids: 64; timeoutMs: number; maxArtifactBytes: 256000 };
}
export interface LocalExecutionEvidence {
  provider: 'local-docker'; runtimeSha256: string; hostQualificationSha256: string;
  ownerScope: string; delegationDigest: string; producerAllocation: string | null; verifierAllocation: string | null;
  candidateCommit: string | null; candidateTree: string | null; custodySha256: string | null;
  producerDestroyed: true; verifierDestroyed: true; policySha256: string;
}
const deny = () => { throw Error('LOCAL_PROVENANCE_DENIED'); };
const exact = (v: any, keys: string) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(',').sort().join(',')) deny();
};
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validateLocalConfiguration(c: any) {
  const l = c.local;
  exact(l, 'provider,providerVersion,implementationSha256,runtimeSha256,hostQualificationSha256,image,policySha256,verificationPolicySha256,evidenceClass,modelProvider,harnessSha256,resources');
  if (l.provider !== 'local-docker' || l.providerVersion !== '1' || l.evidenceClass !== 'DETERMINISTIC' || l.modelProvider !== 'none'
    || c.workerProfile !== 'container' || c.platform !== 'linux' || c.nodeVersion !== '24' || !['x64','arm64'].includes(c.architecture)
    || c.executor !== 'deterministic-qualification' || c.executorVersion !== '1' || c.model !== 'fixture/deterministic'
    || c.verificationImage !== l.image || !/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(l.image)) deny();
  for (const key of ['implementationSha256','runtimeSha256','hostQualificationSha256','policySha256','verificationPolicySha256','harnessSha256']) if (!hash(l[key])) deny();
  exact(l.resources,'vcpus,memoryMb,pids,timeoutMs,maxArtifactBytes');
  const r=l.resources;
  if(r.vcpus!==1||r.memoryMb!==256||r.pids!==64||r.maxArtifactBytes!==256000||!Number.isSafeInteger(r.timeoutMs)||r.timeoutMs<10000||r.timeoutMs>180000||c.timeoutMs!==r.timeoutMs) deny();
}
export function validateLocalEvidence(manifest: any) {
  const l=manifest.execution.configuration.local,b=manifest.execution.localBinding,p=manifest.localExecution,v=manifest.verification,c=manifest.candidate;
  exact(p,'provider,runtimeSha256,hostQualificationSha256,ownerScope,delegationDigest,producerAllocation,verifierAllocation,candidateCommit,candidateTree,custodySha256,producerDestroyed,verifierDestroyed,policySha256');
  if(p.provider!=='local-docker'||p.runtimeSha256!==l.runtimeSha256||p.hostQualificationSha256!==l.hostQualificationSha256
    ||p.ownerScope!==b.ownerScope||p.delegationDigest!==b.delegationDigest||p.policySha256!==l.policySha256
    ||p.candidateCommit!==(c?.commit??null)||p.candidateTree!==(c?.tree??null)
    ||(c?!hash(p.custodySha256):p.custodySha256!==null)
    ||[p.producerAllocation,p.verifierAllocation].some(id=>id!==null&&!/^sbx_[a-f0-9]{64}$/.test(id))
    ||(p.verifierAllocation!==null&&p.producerAllocation===p.verifierAllocation)
    ||p.producerDestroyed!==true||p.verifierDestroyed!==true) deny();
  if(v&&(p.custodySha256!==v.custodySha256||p.producerAllocation!==v.producerSessionId||p.verifierAllocation!==v.providerSessionId))deny();
  if(!v&&p.verifierAllocation!==null)deny();
  if(manifest.status==='COMPLETED'&&(!c||!v||!p.producerAllocation||!p.verifierAllocation||v.outcome!=='PASS'))deny();
}

export function validateLocalBinding(b: any) {
 exact(b,'ownerScope,delegationDigest,repository,sourceSnapshotSha256');
 if(typeof b.ownerScope!=='string'||!/^[A-Za-z0-9:_-]{1,200}$/.test(b.ownerScope)||!hash(b.delegationDigest)||!hash(b.sourceSnapshotSha256)
  ||typeof b.repository!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(b.repository))deny();
}

export function validateLocalHostQualification(configuration: LocalExecutionConfiguration, report: any) {
 exact(report,'runtimeSha256,policySha256,checks');
 exact(report.checks,'uid,rootDenied,absent,noCredentials,caps,seccomp,noNewPrivileges,networkBlocked,resourceLimits,crossWorkFilesystem,processTreeCleanup,separatePidNamespace');
 if(report.runtimeSha256!==configuration.runtimeSha256||report.policySha256!==configuration.policySha256
  ||report.checks.uid!==1000||Object.entries(report.checks).some(([key,value])=>key!=='uid'&&value!==true))deny();
}
