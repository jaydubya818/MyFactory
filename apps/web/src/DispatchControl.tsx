import { useEffect, useState } from "react";
import type { FactoryPolicy } from "@factory/contracts";
import { getPolicy, sendAction } from "./api";
import { errorText } from "./domain";

export default function DispatchControl() {
  const [policy, setPolicy] = useState<FactoryPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setPolicy(await getPolicy());
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function changePaused() {
    if (!policy) return;
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const next = await sendAction<FactoryPolicy>("dispatch.set_paused", {
        paused: !policy.dispatchPaused,
        expectedRevision: policy.revision,
      });
      setPolicy(next);
      setNotice(next.dispatchPaused ? "Dispatch paused. New attempts will be held." : "Dispatch resumed. New attempts may start.");
    } catch (cause) {
      setError(errorText(cause));
      await refresh();
    } finally {
      setPending(false);
    }
  }

  return <section className="dispatch-control" aria-labelledby="dispatch-heading">
    <div>
      <p className="eyebrow">Local policy</p>
      <h2 id="dispatch-heading">Dispatch {loading && !policy ? "loading…" : policy?.dispatchPaused ? "paused" : policy ? "active" : "unavailable"}</h2>
      <p>{policy?.dispatchPaused ? "New attempts are held until you resume dispatch. Running attempts continue." : "New attempts may start when their WorkOrders are ready."}</p>
      {policy && <small>Policy revision {policy.revision}</small>}
      {notice && <p className="dispatch-control__notice" role="status">{notice}</p>}
      {error && <p className="dispatch-control__error" role="alert">{error}</p>}
    </div>
    <div className="dispatch-control__actions">
      {policy && <button className={policy.dispatchPaused ? "button button--primary" : "button button--quiet"} type="button" disabled={pending || loading} onClick={() => void changePaused()}>{pending ? "Saving…" : policy.dispatchPaused ? "Resume dispatch" : "Pause dispatch"}</button>}
      {error && <button className="text-button" type="button" onClick={() => void refresh()}>Retry policy</button>}
    </div>
  </section>;
}
