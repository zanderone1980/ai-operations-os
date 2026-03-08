/**
 * Queue — Simple in-process job queue.
 *
 * For MVP: in-memory queue with async processing.
 * Production: swap for BullMQ, SQS, or similar.
 */

export interface QueueJob<T = unknown> {
  id: string;
  type: string;
  data: T;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  result?: unknown;
}

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<unknown>;

/**
 * Simple in-memory job queue with sequential processing.
 */
export class JobQueue {
  private queue: QueueJob[] = [];
  private handlers = new Map<string, JobHandler>();
  private processing = false;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { pollIntervalMs?: number }) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
  }

  /**
   * Register a handler for a job type.
   */
  registerHandler<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Enqueue a new job.
   */
  enqueue<T>(type: string, data: T, options?: { maxAttempts?: number }): QueueJob<T> {
    const job: QueueJob<T> = {
      id: crypto.randomUUID(),
      type,
      data,
      createdAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      status: 'pending',
    };
    this.queue.push(job as QueueJob);
    return job;
  }

  /**
   * Start processing the queue.
   */
  start(): void {
    if (this.pollTimer) return;
    console.log(`[queue] Started (polling every ${this.pollIntervalMs}ms)`);
    this.pollTimer = setInterval(() => this.processNext(), this.pollIntervalMs);
  }

  /**
   * Stop processing the queue.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[queue] Stopped');
  }

  /**
   * Process the next pending job.
   */
  private async processNext(): Promise<void> {
    if (this.processing) return;

    const job = this.queue.find((j) => j.status === 'pending');
    if (!job) return;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      console.error(`[queue] ${job.error}`);
      return;
    }

    this.processing = true;
    job.status = 'processing';
    job.attempts++;

    try {
      job.result = await handler(job);
      job.status = 'completed';
      console.log(`[queue] Job ${job.id} (${job.type}) completed`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        job.error = `Failed after ${job.attempts} attempts: ${errorMsg}`;
        console.error(`[queue] Job ${job.id} (${job.type}) failed permanently: ${errorMsg}`);
      } else {
        job.status = 'pending'; // Retry
        job.error = errorMsg;
        console.warn(`[queue] Job ${job.id} (${job.type}) attempt ${job.attempts} failed, will retry: ${errorMsg}`);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get queue statistics.
   */
  stats(): { pending: number; processing: number; completed: number; failed: number; total: number } {
    const pending = this.queue.filter((j) => j.status === 'pending').length;
    const processing = this.queue.filter((j) => j.status === 'processing').length;
    const completed = this.queue.filter((j) => j.status === 'completed').length;
    const failed = this.queue.filter((j) => j.status === 'failed').length;
    return { pending, processing, completed, failed, total: this.queue.length };
  }
}
