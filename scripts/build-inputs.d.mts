/** The repo-relative paths buildInputs hashes, in path order (design §1.31). */
export function buildInputFiles(root: string): string[];
/** The build inputs' hash for the build hash: 16 hex digits (design §1.31, M3-Q3). */
export function buildInputs(root: string): string;
/** goldens.json's canary hash, for src/canary-expected.ts's define (M4's design §1.54, M4-Q5). */
export function canaryOf(root: string): string;
