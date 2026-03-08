/**
 * EscalationManager — Handles escalation paths for denied operations.
 *
 * When an operation is repeatedly denied, the escalation manager determines
 * whether and to whom the issue should be escalated. This prevents tasks
 * from being silently stuck in denial loops.
 */

/** Escalation target with routing information. */
export interface EscalationTarget {
  /** Who to escalate to (e.g., 'owner', 'admin', 'team-lead') */
  role: string;
  /** Notification channel (e.g., 'email', 'slack', 'sms') */
  channel: string;
  /** Urgency level for the notification */
  urgency: 'low' | 'normal' | 'high' | 'critical';
}

/** Configuration for escalation thresholds and targets. */
export interface EscalationConfig {
  /** Number of denials before escalating to the next level */
  thresholds: EscalationThreshold[];
}

/** A single escalation threshold definition. */
export interface EscalationThreshold {
  /** Number of denials that triggers this escalation level */
  denialCount: number;
  /** Who to escalate to at this threshold */
  target: EscalationTarget;
}

/** Tracked state for a single task's escalation history. */
interface EscalationState {
  /** Current denial count */
  denialCount: number;
  /** Whether an escalation has already been triggered */
  escalated: boolean;
  /** The escalation target that was triggered, if any */
  escalatedTo?: EscalationTarget;
  /** Timestamp of the last denial */
  lastDeniedAt: string;
  /** Timestamp of the escalation, if triggered */
  escalatedAt?: string;
}

/** Default escalation configuration. */
const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  thresholds: [
    {
      denialCount: 3,
      target: {
        role: 'owner',
        channel: 'email',
        urgency: 'normal',
      },
    },
    {
      denialCount: 5,
      target: {
        role: 'owner',
        channel: 'sms',
        urgency: 'high',
      },
    },
    {
      denialCount: 10,
      target: {
        role: 'admin',
        channel: 'sms',
        urgency: 'critical',
      },
    },
  ],
};

/**
 * EscalationManager tracks denial counts per task and determines
 * when and to whom an issue should be escalated.
 */
export class EscalationManager {
  private readonly config: EscalationConfig;
  private readonly sortedThresholds: EscalationThreshold[];

  /** Per-task escalation state. Keyed by taskId. */
  private readonly state: Map<string, EscalationState> = new Map();

  /**
   * Create a new EscalationManager.
   * @param config - Escalation configuration. Uses conservative defaults if omitted.
   */
  constructor(config?: EscalationConfig) {
    this.config = config ?? DEFAULT_ESCALATION_CONFIG;
    // Sort thresholds ascending by denialCount for ordered evaluation
    this.sortedThresholds = [...this.config.thresholds].sort(
      (a, b) => a.denialCount - b.denialCount,
    );
  }

  /**
   * Determine whether a task should be escalated based on its denial count.
   *
   * @param taskId      - The task identifier.
   * @param denialCount - The current number of denials for this task.
   * @returns True if the denial count meets or exceeds an escalation threshold.
   */
  shouldEscalate(taskId: string, denialCount: number): boolean {
    // Update tracked state
    this.updateState(taskId, denialCount);

    // Find the highest threshold that the denial count meets
    const threshold = this.findMatchingThreshold(denialCount);
    if (!threshold) {
      return false;
    }

    // Check if we already escalated at this level or higher
    const taskState = this.state.get(taskId);
    if (taskState?.escalated && taskState.escalatedTo) {
      const escalatedThreshold = this.sortedThresholds.find(
        (t) => t.target.role === taskState.escalatedTo!.role &&
               t.target.urgency === taskState.escalatedTo!.urgency,
      );
      if (escalatedThreshold && escalatedThreshold.denialCount >= threshold.denialCount) {
        return false; // Already escalated at this level or higher
      }
    }

    return true;
  }

  /**
   * Get the escalation target for a task based on its denial count.
   *
   * Returns the target for the highest threshold that the task's
   * denial count meets or exceeds.
   *
   * @param taskId - The task identifier.
   * @returns The escalation target, or undefined if no escalation is warranted.
   */
  getEscalationTarget(taskId: string): EscalationTarget | undefined {
    const taskState = this.state.get(taskId);
    if (!taskState) {
      return undefined;
    }

    const threshold = this.findMatchingThreshold(taskState.denialCount);
    return threshold?.target;
  }

  /**
   * Record that an escalation was triggered for a task.
   *
   * @param taskId - The task identifier.
   * @param target - The escalation target that was notified.
   */
  recordEscalation(taskId: string, target: EscalationTarget): void {
    const taskState = this.state.get(taskId);
    if (taskState) {
      taskState.escalated = true;
      taskState.escalatedTo = target;
      taskState.escalatedAt = new Date().toISOString();
    }
  }

  /**
   * Record a denial for a task, incrementing its denial count.
   *
   * @param taskId - The task identifier.
   */
  recordDenial(taskId: string): void {
    const taskState = this.state.get(taskId);
    if (taskState) {
      taskState.denialCount += 1;
      taskState.lastDeniedAt = new Date().toISOString();
    } else {
      this.state.set(taskId, {
        denialCount: 1,
        escalated: false,
        lastDeniedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Get the current escalation state for a task.
   *
   * @param taskId - The task identifier.
   * @returns The escalation state, or undefined if no state exists.
   */
  getState(taskId: string): Readonly<EscalationState> | undefined {
    return this.state.get(taskId);
  }

  /**
   * Clear escalation state for a task (e.g., when the task completes).
   *
   * @param taskId - The task identifier.
   */
  clearState(taskId: string): void {
    this.state.delete(taskId);
  }

  /**
   * Update tracked state for a task.
   */
  private updateState(taskId: string, denialCount: number): void {
    const existing = this.state.get(taskId);
    if (existing) {
      existing.denialCount = denialCount;
      existing.lastDeniedAt = new Date().toISOString();
    } else {
      this.state.set(taskId, {
        denialCount,
        escalated: false,
        lastDeniedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Find the highest threshold that the denial count meets or exceeds.
   */
  private findMatchingThreshold(denialCount: number): EscalationThreshold | undefined {
    // Walk thresholds in reverse (highest first) to find the best match
    for (let i = this.sortedThresholds.length - 1; i >= 0; i--) {
      if (denialCount >= this.sortedThresholds[i].denialCount) {
        return this.sortedThresholds[i];
      }
    }
    return undefined;
  }
}
