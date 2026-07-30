import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  identity: {
    accent: "#2563eb",
    category: "operations",
    description:
      "Storage-neutral correlation, evidence, reconciliation, contradiction detection, and visibility primitives for work handed to external systems.",
    docsUrl: "https://github.com/absolutejs/handoff",
    name: "@absolutejs/handoff",
    tagline: "Keep external work visible after it leaves your application.",
  },
  settings: Type.Object({}),
  wiring: [],
});
