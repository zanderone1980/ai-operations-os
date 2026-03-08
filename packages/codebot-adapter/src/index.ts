/**
 * @ai-ops/codebot-adapter — Bridge to codebot-ai for workflow execution.
 *
 * Provides CodeBotAdapter for step-level execution, CodeBotExecutor for
 * agent-driven multi-tool runs, and ReceiptBuilder for hash-chained
 * audit receipts.
 */

export { CodeBotAdapter } from './adapter';
export type { StepResult } from './adapter';

export { CodeBotExecutor } from './executor';
export type { ExecutionEvent, ExecutionEventType, ExecutorOptions } from './executor';

export { ReceiptBuilder } from './receipt';
export type { ReceiptStepData } from './receipt';
