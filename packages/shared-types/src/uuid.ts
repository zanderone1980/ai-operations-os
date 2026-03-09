/**
 * Node 18-safe UUID v4 generator.
 *
 * `crypto.randomUUID()` is only a global in Node 19+.
 * This uses the `node:crypto` module which works in Node 16+.
 */

import { randomUUID } from 'node:crypto';

export { randomUUID };
