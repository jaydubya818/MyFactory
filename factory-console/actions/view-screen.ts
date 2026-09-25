/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { getFactoryPolicy, getFactoryWorkOrder } from "../server/lib/factory-supervisor";

export default defineAction({
  description:
    "See what the user is currently looking at. For a Factory WorkOrder, returns persisted data for the active detail section and selected evidence. Call this before making claims about the current screen.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    if (navigation?.view === "factory" && typeof navigation.workOrderId === "string") {
      try {
        const [detail, policy] = await Promise.all([getFactoryWorkOrder(navigation.workOrderId), getFactoryPolicy()]);
        const activeTab = navigation.activeTab;
        const selectedEvidenceId = navigation.selectedEvidenceId;
        const latestRun = [...detail.runs].sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null;
        screen.factory = {
          workOrder: detail.workOrder,
          policy,
          activeTab: activeTab ?? "overview",
          selectedEvidenceId: selectedEvidenceId ?? null,
          selectedEvidence:
            detail.checks.find((check) => check.id === selectedEvidenceId) ??
            detail.events.find((event) => String(event.id) === selectedEvidenceId) ??
            (latestRun?.candidateCommit === selectedEvidenceId ? { candidateCommit: latestRun.candidateCommit } : null),
          ...(activeTab === "activity" ? { events: detail.events.slice(-20) } : {}),
          ...(activeTab === "changes" ? { latestRun, externalActions: detail.externalActions } : {}),
          ...(activeTab === "verification" ? { checks: detail.checks } : {}),
          ...(activeTab === "decisions" ? { publicationRequests: detail.publicationRequests, publicationApprovals: detail.publicationApprovals, decisionEvents: detail.events.filter((event) => /approval|clarif|decision|login|environment|human/i.test(event.type)) } : {}),
          ...(!activeTab || activeTab === "overview" ? { latestRun } : {}),
        };
      } catch (error) {
        screen.factoryError = error instanceof Error ? error.message : "Factory detail could not be read.";
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
