/**
 * receipts command — Verify the receipt chain integrity.
 *
 * Usage: ai-ops receipts verify
 */

import * as path from 'path';
import * as os from 'os';

import { createStores } from '@ai-ops/ops-storage';
import {
  verifyReceiptChain,
  type ActionReceipt,
} from '@ai-ops/shared-types';

const DB_PATH = path.join(os.homedir(), '.ai-ops', 'data.db');
const HMAC_KEY = 'ai-ops-demo-receipt-signing-key';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

export async function receiptsVerify(): Promise<void> {
  console.log(`${c.dim}Loading receipts from database...${c.reset}`);
  console.log();

  const stores = createStores(DB_PATH);

  try {
    // Load receipts ordered by timestamp so the chain is in order
    const rows = stores.db.db
      .prepare('SELECT * FROM receipts ORDER BY timestamp ASC')
      .all() as Record<string, unknown>[];

    if (rows.length === 0) {
      console.log(`${c.yellow}No receipts found in database.${c.reset}`);
      console.log(`${c.dim}Run "ai-ops demo" first to load seed data.${c.reset}`);
      return;
    }

    // Convert rows to ActionReceipt objects
    const receipts: ActionReceipt[] = rows.map((row) => ({
      id: row.id as string,
      actionId: row.action_id as string,
      policyVersion: row.policy_version as string,
      cordDecision: row.cord_decision as string,
      cordScore: row.cord_score as number,
      cordReasons: JSON.parse(row.cord_reasons as string) as string[],
      input: JSON.parse(row.input as string) as Record<string, unknown>,
      output: row.output ? (JSON.parse(row.output as string) as Record<string, unknown>) : undefined,
      timestamp: row.timestamp as string,
      hash: row.hash as string,
      signature: row.signature as string,
      prevHash: row.prev_hash as string,
    }));

    // Print receipt summary
    console.log(`${c.bold}Receipt Chain Summary${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
    console.log();

    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i];
      const connector = (r.input.connector as string) ?? '?';
      const operation = (r.input.operation as string) ?? '?';
      const decision = r.cordDecision === 'ALLOW'
        ? `${c.green}ALLOW${c.reset}`
        : r.cordDecision === 'CHALLENGE'
          ? `${c.yellow}CHALLENGE${c.reset}`
          : `${c.red}${r.cordDecision}${c.reset}`;

      console.log(
        `  ${c.bold}#${i + 1}${c.reset}  ` +
        `${c.cyan}${connector}.${operation}${c.reset}  ` +
        `score=${r.cordScore}/99  ` +
        `decision=${decision}`
      );
      console.log(
        `      ${c.dim}hash=${r.hash.slice(0, 16)}...  ` +
        `prev=${r.prevHash === 'genesis' ? 'genesis' : r.prevHash.slice(0, 16) + '...'}${c.reset}`
      );
    }

    console.log();

    // Verify chain
    const result = verifyReceiptChain(receipts, HMAC_KEY);

    console.log(`${c.bold}Verification Result${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
    console.log();
    console.log(`  ${c.bold}Total Receipts:${c.reset}  ${receipts.length}`);

    if (result.valid) {
      console.log(`  ${c.bold}Chain Status:${c.reset}    ${c.green}${c.bold}VALID${c.reset}`);
      console.log();
      console.log(`  ${c.green}All ${receipts.length} receipts verified -- hashes linked, signatures match.${c.reset}`);
    } else {
      console.log(`  ${c.bold}Chain Status:${c.reset}    ${c.red}${c.bold}INVALID${c.reset}`);
      if (result.brokenAt !== undefined) {
        console.log(`  ${c.bold}Broken At:${c.reset}       Receipt #${result.brokenAt + 1}`);
      }
      if (result.reason) {
        console.log(`  ${c.bold}Reason:${c.reset}          ${result.reason}`);
      }
      console.log();
      console.log(`  ${c.red}Chain integrity compromised. Investigate the broken link.${c.reset}`);
      process.exitCode = 1;
    }

    console.log();
  } finally {
    stores.db.close();
  }
}
