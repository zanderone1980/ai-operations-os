/**
 * Scheduler — Cron-like recurring task execution.
 *
 * Evaluates schedules every minute and enqueues jobs when due.
 * No external cron dependencies — pure Node.js timers.
 */

import { JobQueue } from './queue';

export interface ScheduledTask {
  id: string;
  name: string;
  /** Cron-like schedule: { minute?, hour?, dayOfWeek?, dayOfMonth? } */
  schedule: {
    /** Minutes (0-59). Undefined = every minute. */
    minute?: number;
    /** Hours (0-23). Undefined = every hour. */
    hour?: number;
    /** Days of week (0=Sun, 6=Sat). Undefined = every day. */
    dayOfWeek?: number[];
    /** Days of month (1-31). Undefined = every day. */
    dayOfMonth?: number[];
  };
  /** Job type to enqueue when triggered */
  jobType: string;
  /** Job data to pass */
  jobData: Record<string, unknown>;
  /** Whether this schedule is active */
  enabled: boolean;
  /** Last time this schedule fired */
  lastRunAt?: string;
}

/**
 * Simple scheduler that checks schedules every minute.
 */
export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: JobQueue;

  constructor(queue: JobQueue) {
    this.queue = queue;
  }

  /**
   * Register a recurring task.
   */
  register(task: ScheduledTask): void {
    this.tasks.push(task);
    console.log(`[scheduler] Registered: ${task.name} (${task.jobType})`);
  }

  /**
   * Start the scheduler.
   */
  start(): void {
    if (this.timer) return;
    console.log(`[scheduler] Started (${this.tasks.length} tasks registered)`);
    // Check every 60 seconds
    this.timer = setInterval(() => this.tick(), 60_000);
    // Also run immediately
    this.tick();
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[scheduler] Stopped');
  }

  /**
   * Check all schedules and enqueue matching jobs.
   */
  private tick(): void {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();

    for (const task of this.tasks) {
      if (!task.enabled) continue;

      // Check if this task should run now
      if (task.schedule.minute !== undefined && task.schedule.minute !== minute) continue;
      if (task.schedule.hour !== undefined && task.schedule.hour !== hour) continue;
      if (task.schedule.dayOfWeek && !task.schedule.dayOfWeek.includes(dayOfWeek)) continue;
      if (task.schedule.dayOfMonth && !task.schedule.dayOfMonth.includes(dayOfMonth)) continue;

      // Prevent double-firing within the same minute
      if (task.lastRunAt) {
        const lastRun = new Date(task.lastRunAt);
        if (
          lastRun.getFullYear() === now.getFullYear() &&
          lastRun.getMonth() === now.getMonth() &&
          lastRun.getDate() === now.getDate() &&
          lastRun.getHours() === now.getHours() &&
          lastRun.getMinutes() === now.getMinutes()
        ) {
          continue;
        }
      }

      // Fire!
      task.lastRunAt = now.toISOString();
      this.queue.enqueue(task.jobType, task.jobData);
      console.log(`[scheduler] Triggered: ${task.name}`);
    }
  }

  /**
   * List all registered tasks.
   */
  list(): ScheduledTask[] {
    return [...this.tasks];
  }
}
