// The canary's expected hash (M4's design, research/m4/DESIGN.md, §1.50,
// §1.54; PLAN D-23, M4-Q5): goldens.json's canary, which
// scripts/build-inputs.mjs's canaryOf reads at build time and vite.config.ts
// and vitest.config.ts define beside the build inputs, so the page's module
// holds this one hash of the goldens and nothing else of them. Only
// src/ui/canary.ts imports it, so no other config needs the define:
// src/build-info.ts, which dev/corrections.vitest.config.ts loads with the
// build inputs alone defined, stays as M3 left it (completeness-F24). New
// at M4.

declare global {
  /** goldens.json's canary (scripts/build-inputs.mjs's canaryOf), defined by vite.config.ts and vitest.config.ts. */
  const __TERRIEST_CANARY__: string;
}

export const CANARY_EXPECTED: string = __TERRIEST_CANARY__;
