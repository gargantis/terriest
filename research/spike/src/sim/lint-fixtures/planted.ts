// Planted violations of PLAN D-1 and D-38, kept so a test can show that the
// spike's lint catches them in src/sim. `eslint .` skips this folder
// (eslint.config.mjs); test/eslint-config.test.ts lints this file with the
// real config and ignores off, and expects exactly these three errors.
// Nothing imports it.

// hermet/exact-ops: sin is implementation-approximated.
export const sine = (x: number): number => Math.sin(x);

// no-restricted-syntax: a destructured member, which exact-ops can't see.
const { cos } = Math;
export const cosine = (x: number): number => cos(x);

// no-restricted-syntax: an alias, which exact-ops can't see either.
const M = Math;
export const tangent = (x: number): number => M.tan(x);
