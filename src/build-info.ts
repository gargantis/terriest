// The build's inputs (design §1.31, M3-Q3; PLAN D-21, C-13): the hash
// scripts/build-inputs.mjs takes of the src/core sources peers must agree
// on and of the simulation's goldens, defined at build time by
// vite.config.ts and vitest.config.ts, so goldens.json never enters the
// page's bundle. The page hands it to buildHash (src/core/session/build.ts),
// since src/core imports nothing outside it but src/config.ts.
//
// The globals are declared here: tsc takes a src/build-info.d.ts beside
// this file for its own output and leaves it out of the program.

declare global {
  /** scripts/build-inputs.mjs's hash, defined by vite.config.ts and vitest.config.ts. */
  const __TERRIEST_BUILD_INPUTS__: string;
  interface ImportMetaEnv {
    /** npm run dev:local's relay port (scripts/dev-local.mjs), read only under import.meta.env.DEV (src/net/dev-relay.ts). */
    readonly VITE_TERRIEST_LOCAL_RELAY_PORT?: string;
  }
}

export const BUILD_INPUTS: string = __TERRIEST_BUILD_INPUTS__;
