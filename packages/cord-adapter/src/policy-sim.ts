/**
 * PolicySimulator — Dry-run safety evaluation for projected actions.
 *
 * Runs a list of projected connector actions through the CordSafetyGate
 * without actually executing them. Useful for previewing what CORD would
 * decide before committing to a workflow run.
 */

import { CordSafetyGate, type SafetyResult } from './adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A projected action to simulate through CORD. */
export interface ProjectedAction {
  /** Connector name (e.g., 'gmail', 'shopify'). */
  connector: string;

  /** Operation to perform (e.g., 'send', 'delete'). */
  operation: string;

  /** Optional input data for the operation. */
  input?: Record<string, unknown>;
}

/** Per-action simulation result pairing the action with its safety decision. */
export interface SimulationEntry {
  /** The projected action that was evaluated. */
  action: ProjectedAction;

  /** The CORD safety result for this action. */
  result: SafetyResult;
}

/** Full simulation report for a batch of projected actions. */
export interface SimulationReport {
  /** Individual results for each projected action. */
  entries: SimulationEntry[];

  /** Summary counts by decision type. */
  summary: Record<string, number>;

  /** The highest risk score across all entries. */
  maxScore: number;

  /** Whether any action was hard-blocked. */
  hasHardBlock: boolean;

  /** Whether all actions were allowed. */
  allAllowed: boolean;
}

// ---------------------------------------------------------------------------
// PolicySimulator
// ---------------------------------------------------------------------------

/**
 * PolicySimulator evaluates a batch of projected actions through CordSafetyGate
 * to produce a simulation report. No side effects occur -- this is a pure
 * dry-run analysis.
 *
 * @example
 * ```ts
 * const sim = new PolicySimulator();
 * const report = sim.simulate([
 *   { connector: 'gmail', operation: 'send', input: { to: 'a@b.com' } },
 *   { connector: 'shopify', operation: 'refund', input: { amount: 200 } },
 * ]);
 * console.log(report.summary); // { ALLOW: 1, BLOCK: 1 }
 * ```
 */
export class PolicySimulator {
  /** The safety gate used for evaluations. */
  private readonly gate: CordSafetyGate;

  /**
   * Create a PolicySimulator.
   *
   * @param gate - Optional CordSafetyGate instance. A new one is created if not provided.
   */
  constructor(gate?: CordSafetyGate) {
    this.gate = gate ?? new CordSafetyGate();
  }

  /**
   * Simulate a list of projected actions through CORD without executing them.
   *
   * @param actions - The projected actions to evaluate.
   * @returns A SimulationReport with per-action results and aggregate summary.
   */
  simulate(actions: ProjectedAction[]): SimulationReport {
    const entries: SimulationEntry[] = actions.map((action) => ({
      action,
      result: this.gate.evaluateAction(
        action.connector,
        action.operation,
        action.input ?? {},
      ),
    }));

    const summary: Record<string, number> = {};
    let maxScore = 0;
    let hasHardBlock = false;
    let allAllowed = true;

    for (const entry of entries) {
      const { decision, score, hardBlock } = entry.result;
      summary[decision] = (summary[decision] ?? 0) + 1;

      if (score > maxScore) {
        maxScore = score;
      }
      if (hardBlock) {
        hasHardBlock = true;
      }
      if (decision !== 'ALLOW') {
        allAllowed = false;
      }
    }

    return {
      entries,
      summary,
      maxScore,
      hasHardBlock,
      allAllowed,
    };
  }
}
