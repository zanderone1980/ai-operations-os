/**
 * @ai-operations/ops-storage — SQLite persistence layer for AI Operations OS.
 *
 * Provides typed store classes for tasks, workflows, and approvals,
 * all backed by a single SQLite database.
 */

export { Database } from './database';
export { TaskStore } from './task-store';
export type { TaskFilter } from './task-store';
export { WorkflowStore } from './workflow-store';
export type { WorkflowRunFilter } from './workflow-store';
export { ApprovalStore } from './approval-store';
export type { ApprovalFilter } from './approval-store';
export { UserStore } from './user-store';
export type { User, CreateUserInput } from './user-store';
export { CredentialStore } from './credential-store';
export type { StoredCredential } from './credential-store';
export { SparkStore } from './spark-store';
export type { SparkEpisodeFilter, SparkPredictionFilter, SparkInsightFilter, SparkMemoryTokenFilter, SparkMemoryEdgeFilter } from './spark-store';
export { AuditStore } from './audit-store';
export type { AuditEntry, AuditEventType, AuditFilter } from './audit-store';

import { Database } from './database';
import { TaskStore } from './task-store';
import { WorkflowStore } from './workflow-store';
import { ApprovalStore } from './approval-store';
import { UserStore } from './user-store';
import { CredentialStore } from './credential-store';
import { SparkStore } from './spark-store';
import { AuditStore } from './audit-store';

export interface Stores {
  tasks: TaskStore;
  workflows: WorkflowStore;
  approvals: ApprovalStore;
  users: UserStore;
  credentials: CredentialStore;
  spark: SparkStore;
  audit: AuditStore;
  db: Database;
}

/**
 * Convenience factory: create a Database and all stores in one call.
 *
 * @param dbPath — Path to the SQLite file. Defaults to ~/.ai-ops/data.db.
 */
export function createStores(dbPath?: string): Stores {
  const db = new Database(dbPath);
  return {
    tasks: new TaskStore(db.db),
    workflows: new WorkflowStore(db.db),
    approvals: new ApprovalStore(db.db),
    users: new UserStore(db.db),
    credentials: new CredentialStore(db.db),
    spark: new SparkStore(db.db),
    audit: new AuditStore(db.db),
    db,
  };
}
