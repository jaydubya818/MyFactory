import type { ReactNode } from "react";
import type { WorkOrderState } from "@factory/contracts";
import { workOrderStates } from "./domain";

type IconName = "plus" | "refresh" | "arrow" | "chevron" | "close" | "check" | "inbox" | "overview" | "builder" | "sparkle";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const contents: Record<IconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.5-2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    inbox: <><path d="M4 5h16l2 10v5H2v-5L4 5Z" /><path d="M2 15h6l2 3h4l2-3h6" /></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    builder: <><rect x="3" y="8" width="9" height="12" rx="1.5" /><rect x="12" y="4" width="9" height="12" rx="1.5" /><path d="M7 4h2M16 20h2" /></>,
    sparkle: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" /><path d="m19 17 .6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z" /></>,
  };

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {contents[name]}
    </svg>
  );
}

export function StatusPill({ state }: { state: WorkOrderState }) {
  const meta = workOrderStates[state];
  return <span className={`status-pill status-pill--${meta.tone}`}><span className="status-dot" />{meta.label}</span>;
}

export function EmptyMessage({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-message">
      <div className="empty-message__mark"><Icon name="inbox" size={24} /></div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
