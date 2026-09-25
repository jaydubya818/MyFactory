# Feedback Hub app builder

`@factory/app-builder` instantiates the versioned `templates/feedback-hub` starter into a new direct child of an existing task-owned directory. It never installs dependencies, starts a server, or claims a live preview.

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

Use the output's README and package scripts to install and run the app. The caller owns the task directory and any later publication or deployment decision.

Run `npm test --workspace @factory/app-builder` from the repository root.
