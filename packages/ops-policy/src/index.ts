/**
 * @ai-ops/ops-policy — Business rules and autonomy levels.
 *
 * This package handles policy evaluation, autonomy management,
 * escalation paths, and budget tracking for the AI Operations OS.
 */

// Rule engine
export { RuleEngine } from './rules';
export type { EvaluationContext, EvaluationResult } from './rules';

// Autonomy manager
export { AutonomyManager } from './autonomy';
export type { AutonomyDecision } from './autonomy';

// Escalation manager
export { EscalationManager } from './escalation';
export type {
  EscalationTarget,
  EscalationConfig,
  EscalationThreshold,
} from './escalation';

// Budget tracker
export { BudgetTracker } from './budget';
