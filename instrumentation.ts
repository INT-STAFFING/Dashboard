import { assertProductionConfig } from '@/lib/security/config';

// Runs once when a server instance starts (Node and Edge). In a real production
// runtime an unsafe configuration — default/missing AUTH_SECRET, no database —
// aborts startup instead of silently serving with forgeable sessions or
// per-instance in-memory data; previews and `next dev` only log a warning.
export async function register() {
  assertProductionConfig();
}
