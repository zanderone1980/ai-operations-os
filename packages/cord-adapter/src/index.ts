/**
 * @ai-operations/cord-adapter — Bridge to cord-engine for safety evaluation.
 *
 * Provides CordSafetyGate for action evaluation, PolicySimulator for
 * dry-run analysis, and ForensicEngine for session timeline inspection.
 */

export { CordSafetyGate } from './adapter';
export type { SafetyResult } from './adapter';

export { PolicySimulator } from './policy-sim';
export type { ProjectedAction, SimulationEntry, SimulationReport } from './policy-sim';

export { ForensicEngine } from './forensic';
export type { TimelineEvent, ForensicTimeline } from './forensic';
