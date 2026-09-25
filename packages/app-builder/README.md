# Feedback Hub app builder

`@factory/app-builder` instantiates the versioned `templates/feedback-hub` starter into a new direct child of an existing task-owned directory. A separate, explicit preview action can install and serve that unchanged scaffold on loopback.

```ts
import { instantiateApp, listAppTemplates } from "@factory/app-builder";

const templates = listAppTemplates(); // [{ id, name, version, description }]

const result = instantiateApp({
  templateId: "feedback-hub",
  taskDirectory: "/absolute/task-owned-directory",
  outputName: "feedback-hub", // optional; this is the default
  productBrief: {
    name: "SellerFi Feedback",
    description: "Track buyer and seller feedback with clear decisions.",
    audience: ["Buyers", "Sellers"],
    goals: ["Review reports", "Record decisions"],
  },
});
```

The builder copies the source template, safely updates `app.json`, and writes `product-brief.json`. It returns `outputDir`, `manifestPath`, a version and SHA-256 digest of the source template, and sorted SHA-256/size entries for each generated file. `build-manifest.json` is excluded from its own file list. Existing output directories are never intentionally replaced. Generated build folders and `node_modules` are omitted from the template copy.

## Explicit local preview

```ts
import { LocalAppPreviewManager } from "@factory/app-builder";

const previews = new LocalAppPreviewManager({
  evidenceDirectory: "/absolute/task-evidence/previews",
  onEvent: (workOrderId, type, payload) => saveEvent(workOrderId, type, payload),
});
const snapshot = await previews.start({
  workOrderId: "work-order-id",
  outputDir: result.outputDir,
  expectedManifestSha256: sha256OfManifestFile,
});
// snapshot.status is building, running, failed, or stopped; running has snapshot.url.
await previews.stop("work-order-id");
await previews.close();
```

The manager checks the manifest digest and every source hash immediately before each phase, rejects extra source files and symlinks, runs fixed install/typecheck/build commands offline with bounded output and time, and starts the production server on `127.0.0.1` using an isolated process with a capped evidence log. Its `status(workOrderId)` method returns the current snapshot. An offline npm cache containing the lockfile's packages is required. The preview is a local convenience for inspecting the unchanged scaffold; it is not independent verification, publication, or deployment. The caller owns preview authorization and any later publication decision.

Run `npm test --workspace @factory/app-builder` from the repository root.
