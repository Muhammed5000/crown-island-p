import 'server-only';

// Pure implementation lives in file-signature-core.ts (no `server-only`) so the
// node:test suite can import it; app code keeps importing from here so the
// server-only poison still guards against client-bundle leakage.
export { imageSignatureMatches } from './file-signature-core';
