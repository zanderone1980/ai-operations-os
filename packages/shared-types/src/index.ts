/**
 * @ai-ops/shared-types — Core data models for AI Operations OS.
 */

// Task
export type { Task, TaskSource, TaskIntent, TaskPriority, TaskStatus } from './task';
export { createTask } from './task';

// Workflow
export type { WorkflowRun, WorkflowStep, WorkflowState, StepStatus, CordDecision } from './workflow';
export { createWorkflowRun, createStep } from './workflow';

// Action
export type { Action, ActionStatus } from './action';
export { createAction } from './action';

// Approval
export type { Approval, RiskLevel, ApprovalDecision } from './approval';
export { createApproval, isApprovalExpired } from './approval';

// Receipt
export type { ActionReceipt } from './receipt';
export {
  GENESIS_HASH,
  computeReceiptHash,
  signReceipt,
  verifyReceipt,
  verifyReceiptChain,
} from './receipt';

// Policy
export type { PolicyRule, PolicyConfig, AutonomyLevel } from './policy';
export { DEFAULT_POLICY } from './policy';

// SPARK
export type {
  SparkCategory,
  PredictedOutcome,
  ActualOutcome,
  Prediction,
  OutcomeSignal,
  LearningEpisode,
  SparkWeightEntry,
  SparkWeights,
  WeightHistoryEntry,
} from './spark';
export { SENTINEL_CATEGORIES } from './spark';

// JSON Schemas
export {
  TaskSchema,
  ApprovalSchema,
  ActionReceiptSchema,
  WorkflowRunSchema,
  WorkflowStepSchema,
  SCHEMAS,
} from './schemas';
