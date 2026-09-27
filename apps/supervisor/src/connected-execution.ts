import { digest } from "../../../packages/hosted-routing/src/result.ts";
import type { WorkOrder } from "../../../packages/contracts/src/index.ts";
import type { ConnectedExecution, FactoryStorage } from "../../../packages/storage/src/index.ts";
import { ActionError } from "./actions.ts";
import type { FactoryClient } from "./connections.ts";
import { canAccessRepository } from "./connections.ts";
import type { JobManager } from "./jobs.ts";
import type { ProducerResults } from "./producer-results.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;

function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ActionError("Connected execution input must be an object", "invalid_input");
  return value as Record<string,unknown>;
}

function field(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new ActionError(`${name} is invalid`, "invalid_input");
  return value;
}

function workDigest(work: WorkOrder): string {
  const {id,title,description,kind,repositoryPath,baseRef,acceptanceCriteria,
    reproductionCommand,expectedFailureText,checkCommands,allowedPaths,workerProfile}=work;
  return digest({id,title,description,kind,repositoryPath,baseRef,acceptanceCriteria,
    reproductionCommand,expectedFailureText,checkCommands,allowedPaths,workerProfile});
}

export class ConnectedExecutionControl {
  private readonly storage: FactoryStorage;
  private readonly jobs: JobManager;
  private readonly producer: ProducerResults | undefined;
  constructor(storage: FactoryStorage, jobs: JobManager, producer: ProducerResults | undefined) {
    this.storage=storage; this.jobs=jobs; this.producer=producer;
  }

  private owned(client: FactoryClient, id: string): ConnectedExecution {
    const record=this.storage.getConnectedExecution(id);
    if (!record || record.clientId!==client.id) throw new ActionError("Execution not found", "not_found", 404);
    const work=this.storage.getWorkOrder(record.workOrderId);
    if (!work || !canAccessRepository(client,work.repositoryPath))
      throw new ActionError("Execution not found", "not_found", 404);
    return record;
  }

  async describe(client: FactoryClient, workOrderId: string) {
    const work=this.storage.getWorkOrder(field(workOrderId,"workOrderId",uuid));
    if (!work || !canAccessRepository(client,work.repositoryPath))
      throw new ActionError("WorkOrder is outside this connection", "forbidden", 403);
    const pin=await this.jobs.prepareConnectedVersion(work);
    return {...pin,workOrderId:work.id,workDigest:workDigest(work),
      policyRevision:this.storage.getPolicy().revision};
  }

  async prepare(client: FactoryClient, raw: unknown) {
    const input=object(raw);
    const id=field(input.dispatchOperationId,"dispatchOperationId",uuid);
    const workOrderId=field(input.workOrderId,"workOrderId",uuid);
    const requestId=field(input.requestId,"requestId",uuid);
    const factoryId=field(input.factoryId,"factoryId",/^[A-Za-z0-9_-]{1,100}$/);
    const factoryVersion=field(input.factoryVersion,"factoryVersion",hash);
    const deadline=field(input.deadline,"deadline",/^\d{4}-\d\d-\d\dT/);
    const existing=this.storage.getConnectedExecution(id);
    if (existing) {
      if (existing.clientId!==client.id || existing.workOrderId!==workOrderId ||
          existing.requestId!==requestId || existing.factoryId!==factoryId ||
          existing.factoryVersion!==factoryVersion || existing.deadline!==deadline)
        throw new ActionError("Dispatch operation binding conflict","dispatch_conflict",409);
      return this.read(client,id);
    }
    const remaining=Date.parse(deadline)-Date.now();
    if (!Number.isFinite(remaining) || new Date(deadline).toISOString()!==deadline ||
        remaining<=0 || remaining>30*60*1000)
      throw new ActionError("Execution deadline must be within 30 minutes", "invalid_input");
    const work=this.storage.getWorkOrder(workOrderId);
    if (!work || !canAccessRepository(client,work.repositoryPath))
      throw new ActionError("WorkOrder is outside this connection", "forbidden", 403);
    if (work.state!=="queued" || this.jobs.isActive(work.id))
      throw new ActionError("WorkOrder is not available", "not_ready", 409);
    if (this.storage.listRuns(work.id).length>=2)
      throw new ActionError("Attempt limit reached", "attempt_limit", 409);
    if (this.storage.getPolicy().dispatchPaused)
      throw new ActionError("Dispatch is paused", "dispatch_paused", 409);
    const pin=await this.jobs.prepareConnectedVersion(work);
    if (this.jobs.isActive(work.id) || this.storage.getWorkOrder(work.id)?.updatedAt!==work.updatedAt)
      throw new ActionError("WorkOrder changed during preparation", "state_stale", 409);
    if (pin.factoryId!==factoryId || pin.factoryVersion!==factoryVersion)
      throw new ActionError("FactoryVersion or Factory mismatch", "factory_version_conflict", 409);
    try {
      this.storage.createConnectedExecution({dispatchOperationId:id,clientId:client.id,
        factoryId,factoryVersion,requestId,workOrderId,workDigest:workDigest(work),
        policyRevision:this.storage.getPolicy().revision,deadline,model:pin.model,
        executorVersion:pin.executorVersion},work.updatedAt);
      return this.read(client,id);
    } catch(error) {
      throw new ActionError(String(error),"dispatch_conflict",409);
    }
  }

  async start(client: FactoryClient, id: string) {
    let record=this.owned(client,id);
    if (["COMPLETED","FAILED","CANCELLED","FENCED"].includes(record.state) || record.stopRequestedAt)
      throw new ActionError("DENIED_TERMINAL_FENCE", "terminal_fence", 409);
    if (record.state!=="PREPARED") return this.read(client,id);
    const work=this.storage.getWorkOrder(record.workOrderId)!;
    if (Date.now()>=Date.parse(record.deadline) || workDigest(work)!==record.workDigest ||
      work.state!=="queued" || this.storage.getPolicy().revision!==record.policyRevision ||
      this.storage.getPolicy().dispatchPaused || this.storage.listRuns(work.id).length>=2) {
      this.storage.transitionConnectedExecution(id,["PREPARED"],"FENCED",{terminalAt:new Date().toISOString()});
      throw new ActionError("Prepared execution expired or its bounds changed", "terminal_fence", 409);
    }
    record=this.storage.transitionConnectedExecution(id,["PREPARED"],"STARTING");
    try {
      await this.jobs.startRun(work,{dispatchOperationId:id,requestId:record.requestId,
        factoryVersion:record.factoryVersion,model:record.model,deadline:record.deadline});
      const current=this.storage.getConnectedExecution(id)!;
      if (current.state==="STARTING") this.storage.transitionConnectedExecution(id,["STARTING"],"RUNNING");
      return this.read(client,id);
    } catch(error) {
      const current=this.storage.getConnectedExecution(id)!;
      if (current.state==="STARTING") this.storage.transitionConnectedExecution(id,["STARTING"],"UNKNOWN");
      throw error;
    }
  }

  async stop(client: FactoryClient, id: string) {
    const record=this.owned(client,id);
    if (["COMPLETED","FAILED","CANCELLED","FENCED"].includes(record.state)) return this.read(client,id);
    if (record.state==="PREPARED") {
      this.storage.transitionConnectedExecution(id,["PREPARED"],"FENCED",
        {stopRequestedAt:new Date().toISOString(),terminalAt:new Date().toISOString()});
      return this.read(client,id);
    }
    if (!record.stopRequestedAt) this.storage.transitionConnectedExecution(id,
      ["STARTING","RUNNING","UNKNOWN","STOPPING"],"STOPPING",{stopRequestedAt:new Date().toISOString()});
    if (this.jobs.isActive(record.workOrderId,record.runId??undefined)) {
      try { await this.jobs.cancelRun(this.storage.getWorkOrder(record.workOrderId)!); }
      catch(error) { if (!(error instanceof ActionError && error.code==="not_running")) throw error; }
    }
    return this.read(client,id);
  }

  read(client: FactoryClient, id: string) {
    let record=this.owned(client,id);
    if (record.state==="PREPARED" && Date.now()>=Date.parse(record.deadline))
      record=this.storage.transitionConnectedExecution(id,["PREPARED"],"FENCED",
        {terminalAt:new Date().toISOString()});
    let resultManifestDigest=record.resultManifestDigest;
    let quiescent=record.state==="FENCED";
    if (record.runId) {
      const run=this.storage.getRun(record.runId);
      if (!run || run.workOrderId!==record.workOrderId || run.attemptNumber!==record.attemptNumber)
        throw new ActionError("Execution identity changed", "execution_conflict", 409);
      if (this.producer && !this.jobs.isActive(record.workOrderId,run.id)) {
        const observed=this.producer.read(run);
        if (["COMPLETED","FAILED","CANCELLED"].includes(observed.state) && observed.result) {
          const state=observed.state;
          resultManifestDigest=observed.result.manifestDigest;
          if (record.state!==state) record=this.storage.transitionConnectedExecution(id,
            ["STARTING","RUNNING","STOPPING","UNKNOWN"],state,
            {terminalAt:new Date().toISOString(),resultManifestDigest});
          quiescent=true;
        } else if (observed.state==="UNKNOWN" && record.state!=="UNKNOWN") {
          record=this.storage.transitionConnectedExecution(id,["STARTING","RUNNING","STOPPING"],"UNKNOWN");
        }
      }
    } else if (!quiescent && record.stopRequestedAt && !this.jobs.isActive(record.workOrderId)) {
      record=this.storage.transitionConnectedExecution(id,["STOPPING","UNKNOWN"],"FENCED",
        {terminalAt:new Date().toISOString()});
      quiescent=true;
    } else if (record.state==="STARTING" && !this.jobs.isActive(record.workOrderId)) {
      record=this.storage.transitionConnectedExecution(id,["STARTING"],"UNKNOWN");
    }
    return { ...record, quiescent, resultManifestDigest,
      resultUrl:record.runId && resultManifestDigest
        ? `/api/connect/v1/work-orders/${record.workOrderId}/runs/${record.runId}/result` : null };
  }
}
