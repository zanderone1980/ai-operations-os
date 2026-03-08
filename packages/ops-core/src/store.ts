/**
 * TaskStore — In-memory task store with JSON file persistence.
 *
 * Stores tasks in memory for fast access and writes them to
 * ~/.ai-ops/tasks.json for durability across restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { Task, TaskStatus, TaskIntent, TaskPriority } from '@ai-ops/shared-types';

// ---------------------------------------------------------------------------
// Filter type
// ---------------------------------------------------------------------------

/**
 * Optional filter criteria for listing tasks.
 */
export interface TaskFilter {
  /** Filter by task status. */
  status?: TaskStatus;
  /** Filter by task intent. */
  intent?: TaskIntent;
  /** Filter by task priority. */
  priority?: TaskPriority;
  /** Filter by owner. */
  owner?: string;
  /** Filter by source. */
  source?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Default directory for AI Ops data files. */
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.ai-ops');

/** Default file name for the task store. */
const DEFAULT_STORE_FILE = 'tasks.json';

/**
 * TaskStore provides CRUD operations for Task objects with automatic
 * JSON file persistence.
 *
 * @example
 * ```ts
 * const store = new TaskStore();
 * store.save(myTask);
 *
 * const task = store.get(myTask.id);
 * const urgent = store.list({ priority: 'urgent' });
 *
 * store.update(myTask.id, { status: 'completed' });
 * ```
 */
export class TaskStore {
  /** In-memory task index keyed by task ID. */
  private tasks: Map<string, Task>;

  /** Absolute path to the JSON persistence file. */
  private readonly filePath: string;

  /**
   * Create a new TaskStore.
   *
   * @param storePath - Optional override for the JSON file path.
   *                    Defaults to ~/.ai-ops/tasks.json.
   */
  constructor(storePath?: string) {
    this.filePath = storePath ?? path.join(DEFAULT_STORE_DIR, DEFAULT_STORE_FILE);
    this.tasks = new Map();
    this.load();
  }

  /**
   * Save a task to the store. Overwrites any existing task with the same ID.
   *
   * @param task - The task to save.
   */
  save(task: Task): void {
    this.tasks.set(task.id, { ...task });
    this.persist();
  }

  /**
   * Retrieve a task by its ID.
   *
   * @param id - The task identifier.
   * @returns The task, or `undefined` if not found.
   */
  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  /**
   * List tasks, optionally filtered by one or more criteria.
   *
   * @param filter - Optional filter criteria. All specified fields must match.
   * @returns Array of matching tasks, sorted by createdAt descending (newest first).
   */
  list(filter?: TaskFilter): Task[] {
    let results = Array.from(this.tasks.values());

    if (filter) {
      if (filter.status !== undefined) {
        results = results.filter((t) => t.status === filter.status);
      }
      if (filter.intent !== undefined) {
        results = results.filter((t) => t.intent === filter.intent);
      }
      if (filter.priority !== undefined) {
        results = results.filter((t) => t.priority === filter.priority);
      }
      if (filter.owner !== undefined) {
        results = results.filter((t) => t.owner === filter.owner);
      }
      if (filter.source !== undefined) {
        results = results.filter((t) => t.source === filter.source);
      }
    }

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Return copies to prevent external mutation
    return results.map((t) => ({ ...t }));
  }

  /**
   * Update a task with partial data. Automatically sets `updatedAt`.
   *
   * @param id      - The task identifier.
   * @param updates - Partial task fields to merge.
   * @returns The updated task.
   * @throws {Error} If the task does not exist.
   */
  update(id: string, updates: Partial<Task>): Task {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const updated: Task = {
      ...existing,
      ...updates,
      id, // Prevent ID from being overwritten
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(id, updated);
    this.persist();

    return { ...updated };
  }

  /**
   * Delete a task by its ID.
   *
   * @param id - The task identifier.
   * @returns `true` if the task existed and was removed.
   */
  delete(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) {
      this.persist();
    }
    return existed;
  }

  /**
   * Return the total number of tasks in the store.
   */
  get size(): number {
    return this.tasks.size;
  }

  /**
   * Remove all tasks from the store and persistence file.
   */
  clear(): void {
    this.tasks.clear();
    this.persist();
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /**
   * Load tasks from the JSON file into memory.
   * If the file does not exist or is corrupt, starts with an empty store.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: Task[] = JSON.parse(raw);

        if (Array.isArray(data)) {
          for (const task of data) {
            this.tasks.set(task.id, task);
          }
        }
      }
    } catch {
      // If the file is corrupt or unreadable, start fresh.
      // A warning could be logged here in a production system.
      this.tasks = new Map();
    }
  }

  /**
   * Write the current in-memory tasks to the JSON file.
   * Creates the parent directory if it does not exist.
   */
  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.tasks.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Swallow write errors silently. In a production system this would
      // be surfaced via a logger or error event.
    }
  }
}
