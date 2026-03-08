/**
 * Library exports for @ai-ops/ops-worker.
 * Import this (via package.json main) to use pipeline/queue/scheduler
 * without triggering side effects.
 */

export { JobQueue } from './queue';
export type { QueueJob, JobHandler } from './queue';

export { Scheduler } from './scheduler';
export type { ScheduledTask } from './scheduler';

export { WorkflowExecutor } from './executor';
export type { ExecutorOptions, ExecutorEvent } from './executor';

export { runPipeline, defaultBuildWorkflow } from './pipeline';
export type { PipelineEvent, PipelineConfig } from './pipeline';
