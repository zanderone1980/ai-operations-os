/**
 * Auth Guard — Unit Tests
 *
 * Tests auth-exempt path detection, elevated role requirements,
 * and body size limits.
 */

import { isAuthExempt, requiresElevatedRole, MAX_BODY_SIZE } from '../middleware/auth-guard';

// ── isAuthExempt ────────────────────────────────────────────────────────────

describe('isAuthExempt', () => {
  test('allows /api/auth/register without auth', () => {
    expect(isAuthExempt('/api/auth/register')).toBe(true);
  });

  test('allows /api/auth/login without auth', () => {
    expect(isAuthExempt('/api/auth/login')).toBe(true);
  });

  test('allows all webhook paths without auth', () => {
    expect(isAuthExempt('/api/webhooks/gmail')).toBe(true);
    expect(isAuthExempt('/api/webhooks/calendar')).toBe(true);
    expect(isAuthExempt('/api/webhooks/shopify')).toBe(true);
    expect(isAuthExempt('/api/webhooks/stripe')).toBe(true);
    expect(isAuthExempt('/api/webhooks/generic')).toBe(true);
    expect(isAuthExempt('/api/webhooks/anything')).toBe(true);
  });

  test('allows OAuth callback without auth', () => {
    expect(isAuthExempt('/api/oauth/google/callback')).toBe(true);
  });

  test('requires auth for task routes', () => {
    expect(isAuthExempt('/api/tasks')).toBe(false);
    expect(isAuthExempt('/api/tasks/123')).toBe(false);
  });

  test('requires auth for approval routes', () => {
    expect(isAuthExempt('/api/approvals')).toBe(false);
    expect(isAuthExempt('/api/approvals/123/decide')).toBe(false);
  });

  test('requires auth for spark routes', () => {
    expect(isAuthExempt('/api/spark/chat')).toBe(false);
    expect(isAuthExempt('/api/spark/weights')).toBe(false);
  });

  test('requires auth for connector routes', () => {
    expect(isAuthExempt('/api/connectors')).toBe(false);
    expect(isAuthExempt('/api/gmail/inbox')).toBe(false);
    expect(isAuthExempt('/api/slack/channels')).toBe(false);
    expect(isAuthExempt('/api/notion/search')).toBe(false);
  });

  test('requires auth for auth credential routes (not login/register)', () => {
    expect(isAuthExempt('/api/auth/me')).toBe(false);
    expect(isAuthExempt('/api/auth/credentials')).toBe(false);
    expect(isAuthExempt('/api/auth/credentials/slack')).toBe(false);
  });

  test('requires auth for pipeline routes', () => {
    expect(isAuthExempt('/api/pipeline/run')).toBe(false);
    expect(isAuthExempt('/api/pipeline/simulate')).toBe(false);
  });

  test('requires auth for workflow routes', () => {
    expect(isAuthExempt('/api/workflows')).toBe(false);
  });

  test('requires auth for other OAuth routes (not callback)', () => {
    expect(isAuthExempt('/api/oauth/google/url')).toBe(false);
    expect(isAuthExempt('/api/oauth/status')).toBe(false);
    expect(isAuthExempt('/api/oauth/google/refresh')).toBe(false);
  });
});

// ── requiresElevatedRole ──────────────────────────────────────────────────

describe('requiresElevatedRole', () => {
  test('DELETE always requires elevated role', () => {
    expect(requiresElevatedRole('DELETE', '/api/tasks/123')).toBe(true);
    expect(requiresElevatedRole('DELETE', '/api/auth/credentials/456')).toBe(true);
    expect(requiresElevatedRole('DELETE', '/api/anything')).toBe(true);
  });

  test('POST to approval decide requires elevated role', () => {
    expect(requiresElevatedRole('POST', '/api/approvals/abc-123/decide')).toBe(true);
    expect(requiresElevatedRole('POST', '/api/approvals/some-id/decide')).toBe(true);
  });

  test('GET does not require elevated role', () => {
    expect(requiresElevatedRole('GET', '/api/tasks')).toBe(false);
    expect(requiresElevatedRole('GET', '/api/tasks/123')).toBe(false);
    expect(requiresElevatedRole('GET', '/api/approvals')).toBe(false);
  });

  test('POST to non-decide routes does not require elevated role', () => {
    expect(requiresElevatedRole('POST', '/api/tasks')).toBe(false);
    expect(requiresElevatedRole('POST', '/api/spark/chat')).toBe(false);
    expect(requiresElevatedRole('POST', '/api/workflows')).toBe(false);
    expect(requiresElevatedRole('POST', '/api/pipeline/run')).toBe(false);
  });

  test('PATCH does not require elevated role', () => {
    expect(requiresElevatedRole('PATCH', '/api/tasks/123')).toBe(false);
  });

  test('PUT does not require elevated role', () => {
    expect(requiresElevatedRole('PUT', '/api/tasks/123')).toBe(false);
  });
});

// ── MAX_BODY_SIZE ───────────────────────────────────────────────────────────

describe('MAX_BODY_SIZE', () => {
  test('is 1 MB (1,048,576 bytes)', () => {
    expect(MAX_BODY_SIZE).toBe(1_048_576);
  });
});
