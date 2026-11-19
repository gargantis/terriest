/** The repo-relative paths buildInputs hashes, in path order (design §1.31). */
export function buildInputFiles(root: string): string[];
/** The build inputs' hash for the build hash: 16 hex digits (design §1.31, M3-Q3). */
export function buildInputs(root: string): string;
