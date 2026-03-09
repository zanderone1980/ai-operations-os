import { createApproval, isApprovalExpired } from '../approval';
import type { Approval } from '../approval';

describe('createApproval', () => {
  it('creates an approval with all required fields', () => {
    const approval = createApproval(
      'action-1',
      'task-1',
      'high',
      'Sending email to external domain',
      'Email to external@company.com: "Hello"',
      60000,
    );

    expect(approval.actionId).toBe('action-1');
    expect(approval.taskId).toBe('task-1');
    expect(approval.risk).toBe('high');
    expect(approval.reason).toBe('Sending email to external domain');
    expect(approval.preview).toBe('Email to external@company.com: "Hello"');
    expect(approval.ttlMs).toBe(60000);
  });

  it('generates a unique UUID for id', () => {
    const a1 = createApproval('a-1', 't-1', 'low', 'reason', 'preview');
    const a2 = createApproval('a-2', 't-2', 'low', 'reason', 'preview');
    expect(a1.id).not.toBe(a2.id);
  });

  it('sets requestedAt to an ISO timestamp', () => {
    const before = new Date().toISOString();
    const approval = createApproval('a-1', 't-1', 'medium', 'reason', 'preview');
    const after = new Date().toISOString();

    expect(approval.requestedAt >= before).toBe(true);
    expect(approval.requestedAt <= after).toBe(true);
  });

  it('defaults ttlMs to null when not provided', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview');
    expect(approval.ttlMs).toBeNull();
  });

  it('sets ttlMs to null when explicitly passed null', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview', null);
    expect(approval.ttlMs).toBeNull();
  });

  it('does not set decision fields by default', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview');
    expect(approval.decision).toBeUndefined();
    expect(approval.decidedBy).toBeUndefined();
    expect(approval.decidedAt).toBeUndefined();
    expect(approval.modifications).toBeUndefined();
  });
});

describe('isApprovalExpired', () => {
  it('returns false when ttlMs is null (wait forever)', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview', null);
    expect(isApprovalExpired(approval)).toBe(false);
  });

  it('returns false when ttlMs is undefined', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview');
    expect(isApprovalExpired(approval)).toBe(false);
  });

  it('returns false when a decision has already been made', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview', 1);
    approval.decision = 'approved';
    // Even if enough time has passed, a decided approval is not expired
    expect(isApprovalExpired(approval)).toBe(false);
  });

  it('returns false when TTL has not elapsed', () => {
    const approval = createApproval('a-1', 't-1', 'low', 'reason', 'preview', 60000);
    // Just created, so 60 seconds cannot have elapsed
    expect(isApprovalExpired(approval)).toBe(false);
  });

  it('returns true when TTL has elapsed and no decision made', () => {
    const approval: Approval = {
      id: 'test-id',
      actionId: 'a-1',
      taskId: 't-1',
      risk: 'high',
      reason: 'test',
      preview: 'test',
      requestedAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
      ttlMs: 60000, // 1 minute TTL
    };
    expect(isApprovalExpired(approval)).toBe(true);
  });

  it('returns false when TTL has not quite elapsed', () => {
    const approval: Approval = {
      id: 'test-id',
      actionId: 'a-1',
      taskId: 't-1',
      risk: 'low',
      reason: 'test',
      preview: 'test',
      requestedAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
      ttlMs: 60000, // 1 minute TTL
    };
    expect(isApprovalExpired(approval)).toBe(false);
  });
});
