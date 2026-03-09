/**
 * Storage — Persistent store initialization.
 *
 * Separated into its own module to avoid circular dependencies
 * between server.ts and the route files.
 */

import { createStores } from '@ai-ops/ops-storage';

export const stores = createStores(process.env.OPS_DB_PATH);
