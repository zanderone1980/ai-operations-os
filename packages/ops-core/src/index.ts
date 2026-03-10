/**
 * @ai-operations/ops-core — Workflow engine and state machine.
 *
 * This package provides the core execution runtime for the AI Operations OS:
 *
 * - **StateMachine** — Enforces valid workflow step state transitions.
 * - **WorkflowEngine** — Drives WorkflowRuns through steps with safety gates.
 * - **IntentClassifier** — Keyword-based heuristic intent classification.
 * - **TaskStore** — In-memory + JSON file task persistence.
 */

// State machine
export { StateMachine, InvalidTransitionError } from './state-machine';
export type { StepEvent } from './state-machine';

// Workflow engine
export { WorkflowEngine } from './engine';
export type {
  WorkflowEvent,
  StepStartEvent,
  StepCompleteEvent,
  StepBlockedEvent,
  StepFailedEvent,
  RunCompleteEvent,
  RunFailedEvent,
  Connector,
  ConnectorRegistry,
  SafetyGate,
  SafetyGateResult,
} from './engine';

// Intent classifier
export { IntentClassifier } from './intent';
export type { ClassificationResult } from './intent';

// LLM-backed intent classifier
export { LLMIntentClassifier } from './llm-classifier';
export type { LLMClassificationResult } from './llm-classifier';

// Task store
export { TaskStore } from './store';
export type { TaskFilter } from './store';

// Structured logger
export { createLogger } from './logger';
export type { Logger, LogLevel, LogEntry } from './logger';
