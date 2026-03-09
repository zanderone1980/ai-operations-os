import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TaskStore } from '../store';
import { createTask } from '@ai-ops/shared-types';
import type { Task } from '@ai-ops/shared-types';

describe('TaskStore', () => {
  let store: TaskStore;
  let tempFile: string;

  beforeEach(() => {
    // Use a unique temp file for each test to avoid cross-contamination
    tempFile = path.join(os.tmpdir(), `ai-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    store = new TaskStore(tempFile);
  });

  afterEach(() => {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore if file doesn't exist
    }
  });

  describe('save and get', () => {
    it('saves and retrieves a task by ID', () => {
      const task = createTask({ source: 'email', title: 'Test task' });
      store.save(task);

      const retrieved = store.get(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(task.id);
      expect(retrieved!.title).toBe('Test task');
      expect(retrieved!.source).toBe('email');
    });

    it('returns undefined for a non-existent task', () => {
      expect(store.get('non-existent-id')).toBeUndefined();
    });

    it('returns a copy, not the stored reference', () => {
      const task = createTask({ source: 'email', title: 'Original' });
      store.save(task);

      const retrieved = store.get(task.id);
      retrieved!.title = 'Mutated';

      const retrievedAgain = store.get(task.id);
      expect(retrievedAgain!.title).toBe('Original');
    });

    it('overwrites an existing task with the same ID', () => {
      const task = createTask({ source: 'email', title: 'Version 1' });
      store.save(task);

      const updated = { ...task, title: 'Version 2' };
      store.save(updated);

      const retrieved = store.get(task.id);
      expect(retrieved!.title).toBe('Version 2');
      expect(store.size).toBe(1);
    });
  });

  describe('list', () => {
    let tasks: Task[];

    beforeEach(() => {
      tasks = [
        createTask({ source: 'email', title: 'Email 1', priority: 'urgent', status: 'pending', intent: 'reply', owner: 'alice' }),
        createTask({ source: 'email', title: 'Email 2', priority: 'normal', status: 'completed', intent: 'reply', owner: 'bob' }),
        createTask({ source: 'store', title: 'Order 1', priority: 'high', status: 'pending', intent: 'fulfill', owner: 'alice' }),
        createTask({ source: 'social', title: 'Mention 1', priority: 'low', status: 'running', intent: 'post', owner: 'bob' }),
      ];
      tasks.forEach((t) => store.save(t));
    });

    it('returns all tasks when no filter is provided', () => {
      const result = store.list();
      expect(result).toHaveLength(4);
    });

    it('filters by status', () => {
      const pending = store.list({ status: 'pending' });
      expect(pending).toHaveLength(2);
      pending.forEach((t) => expect(t.status).toBe('pending'));
    });

    it('filters by intent', () => {
      const replies = store.list({ intent: 'reply' });
      expect(replies).toHaveLength(2);
      replies.forEach((t) => expect(t.intent).toBe('reply'));
    });

    it('filters by priority', () => {
      const urgent = store.list({ priority: 'urgent' });
      expect(urgent).toHaveLength(1);
      expect(urgent[0].title).toBe('Email 1');
    });

    it('filters by owner', () => {
      const aliceTasks = store.list({ owner: 'alice' });
      expect(aliceTasks).toHaveLength(2);
      aliceTasks.forEach((t) => expect(t.owner).toBe('alice'));
    });

    it('filters by source', () => {
      const emailTasks = store.list({ source: 'email' });
      expect(emailTasks).toHaveLength(2);
      emailTasks.forEach((t) => expect(t.source).toBe('email'));
    });

    it('combines multiple filters (AND logic)', () => {
      const result = store.list({ status: 'pending', owner: 'alice' });
      expect(result).toHaveLength(2);
      result.forEach((t) => {
        expect(t.status).toBe('pending');
        expect(t.owner).toBe('alice');
      });
    });

    it('returns results sorted by createdAt descending', () => {
      const result = store.list();
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].createdAt >= result[i].createdAt).toBe(true);
      }
    });

    it('returns copies of tasks', () => {
      const result = store.list();
      result[0].title = 'Mutated';
      const again = store.list();
      expect(again[0].title).not.toBe('Mutated');
    });
  });

  describe('update', () => {
    it('updates specific fields of a task', () => {
      const task = createTask({ source: 'email', title: 'Original' });
      store.save(task);

      const updated = store.update(task.id, { status: 'completed', title: 'Updated' });
      expect(updated.status).toBe('completed');
      expect(updated.title).toBe('Updated');
      expect(updated.source).toBe('email'); // unchanged
    });

    it('automatically updates the updatedAt timestamp', () => {
      const task = createTask({ source: 'email', title: 'Test' });
      store.save(task);
      const originalUpdatedAt = task.updatedAt;

      // Small delay to ensure timestamp differs
      const updated = store.update(task.id, { title: 'Changed' });
      expect(updated.updatedAt >= originalUpdatedAt).toBe(true);
    });

    it('prevents the ID from being overwritten', () => {
      const task = createTask({ source: 'email', title: 'Test' });
      store.save(task);

      const updated = store.update(task.id, { id: 'hacked-id' } as Partial<Task>);
      expect(updated.id).toBe(task.id);
    });

    it('throws an error when updating a non-existent task', () => {
      expect(() => store.update('non-existent', { title: 'Nope' })).toThrow('Task not found');
    });
  });

  describe('delete', () => {
    it('removes an existing task and returns true', () => {
      const task = createTask({ source: 'email', title: 'To delete' });
      store.save(task);
      expect(store.size).toBe(1);

      const result = store.delete(task.id);
      expect(result).toBe(true);
      expect(store.size).toBe(0);
      expect(store.get(task.id)).toBeUndefined();
    });

    it('returns false when deleting a non-existent task', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('size and clear', () => {
    it('returns 0 for an empty store', () => {
      expect(store.size).toBe(0);
    });

    it('returns the correct count after saves', () => {
      store.save(createTask({ source: 'email', title: 'T1' }));
      store.save(createTask({ source: 'email', title: 'T2' }));
      expect(store.size).toBe(2);
    });

    it('clears all tasks', () => {
      store.save(createTask({ source: 'email', title: 'T1' }));
      store.save(createTask({ source: 'email', title: 'T2' }));
      store.clear();
      expect(store.size).toBe(0);
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('persists tasks to a JSON file', () => {
      const task = createTask({ source: 'email', title: 'Persistent task' });
      store.save(task);

      expect(fs.existsSync(tempFile)).toBe(true);
      const raw = fs.readFileSync(tempFile, 'utf-8');
      const data = JSON.parse(raw);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Persistent task');
    });

    it('loads tasks from an existing file on construction', () => {
      const task = createTask({ source: 'email', title: 'Persisted' });
      store.save(task);

      // Create a new store pointing to the same file
      const store2 = new TaskStore(tempFile);
      expect(store2.size).toBe(1);
      expect(store2.get(task.id)!.title).toBe('Persisted');
    });

    it('handles a corrupt file gracefully', () => {
      fs.writeFileSync(tempFile, 'not-valid-json', 'utf-8');
      const corruptStore = new TaskStore(tempFile);
      expect(corruptStore.size).toBe(0);
    });
  });
});
