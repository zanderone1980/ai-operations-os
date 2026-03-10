/**
 * Receipt Routes — Query the cryptographic audit trail.
 *
 * GET  /api/receipts   List receipts with optional filtering
 */

import { pathToRoute, sendJson } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';

interface ReceiptRow {
  id: string;
  action_id: string;
  policy_version: string;
  cord_decision: string;
  cord_score: number;
  cord_reasons: string;
  input: string;
  output: string | null;
  timestamp: string;
  hash: string;
  signature: string;
  prev_hash: string;
}

function rowToReceipt(row: ReceiptRow) {
  return {
    id: row.id,
    actionId: row.action_id,
    policyVersion: row.policy_version,
    cordDecision: row.cord_decision,
    cordScore: row.cord_score,
    cordReasons: JSON.parse(row.cord_reasons || '[]'),
    input: JSON.parse(row.input || '{}'),
    output: row.output ? JSON.parse(row.output) : undefined,
    timestamp: row.timestamp,
    hash: row.hash,
    signature: row.signature,
    prevHash: row.prev_hash,
  };
}

async function listReceipts(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);

  try {
    const rows = stores.db.db
      .prepare('SELECT * FROM receipts ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as ReceiptRow[];

    const receipts = rows.map(rowToReceipt);
    sendJson(res, 200, { receipts });
  } catch (err) {
    sendJson(res, 200, { receipts: [] });
  }
}

export const receiptRoutes: Route[] = [
  pathToRoute('GET', '/api/receipts', listReceipts),
];
