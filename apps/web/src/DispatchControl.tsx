import { useEffect, useRef, useState } from "react";
import type { FactoryPolicy } from "@factory/contracts";
import { getPolicy, sendAction } from "./api";
import { errorText } from "./domain";

export default function DispatchControl() {
  const [policy, setPolicy] = useState<FactoryPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  /** Re-fetches the current policy. Only clears the refresh-specific error;
   *  action errors from changePaused() persist until the next action attempt. */
  async function refresh() {
    setLoading(true);
    try {
      setPolicy(await getPolicy());
      setRefreshError(null);
    } catch (cause) {
      setRefreshError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (actionError) errorRef.current?.focus();
  }, [actionError]);

  async function changePaused() {
    if (!policy) return;
    setPending(true);
    setNotice(null);
    setActionError(null);
    setRefreshError(null);
    try {
      const next = await sendAction<FactoryPolicy>("dispatch.set_paused", {
        paused: !policy.dispatchPaused,
        expectedRevision: policy.revision,
      });
      setPolicy(next);
      setNotice(next.dispatchPaused ? "Dispatch paused. New attempts will be held." : "Dispatch resumed. New attempts may start.");
    } catch (cause) {
      setActionError(errorText(cause));
      // Re-fetch the policy to reflect true server state, but do NOT clear actionError.
      try {
        setPolicy(await getPolicy());
      } catch {
        // Ignore secondary refresh failures; actionError is already shown.
      }
    } finally {
      setPending(false);
    }
  }

  const visibleError = actionError ?? refreshError;

  return <section className="dispatch-control" aria-labelledby="dispatch-heading">
    <div>
      <p className="eyebrow">Local policy</p>
      <h2 id="dispatch-heading">Dispatch {loading && !policy ? "loading…" : policy?.dispatchPaused ? "paused" : policy ? "active" : "unavailable"}</h2>
      <p>{policy?.dispatchPaused ? "New attempts are held until you resume dispatch. Running attempts continue." : "New attempts may start when their WorkOrders are ready."}</p>
      {policy && <small>Policy revision {policy.revision}</small>}
      {notice && <p className="dispatch-control__notice" role="status">{notice}</p>}
      {visibleError && (
        <p
          ref={errorRef}
          className="dispatch-control__error"
          role="alert"
          tabIndex={-1}
        >
          {visibleError}
        </p>
      )}
    </div>
    <div className="dispatch-control__actions">
      {policy && (
        <button
          className={policy.dispatchPaused ? "button button--primary" : "button button--quiet"}
          type="button"
          disabled={pending || loading}
          onClick={() => void changePaused()}
        >
          {pending ? "Saving…" : policy.dispatchPaused ? "Resume dispatch" : "Pause dispatch"}
        </button>
      )}
      {visibleError && (
        <button className="text-button" type="button" onClick={() => { setActionError(null); void refresh(); }}>
          Retry policy
        </button>
      )}
    </div>
  </section>;
}
