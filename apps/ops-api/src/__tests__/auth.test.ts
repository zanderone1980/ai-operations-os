/**
 * Auth Middleware — Unit Tests
 */

import type * as http from 'http';

// Reset modules between tests to handle env changes
let authenticate: typeof import('../middleware/auth').authenticate;
let requireAuth: typeof import('../middleware/auth').requireAuth;
let requireRole: typeof import('../middleware/auth').requireRole;
let setUserLookup: typeof import('../middleware/auth').setUserLookup;

function mockReq(authHeader?: string): http.IncomingMessage {
  return { headers: { authorization: authHeader } } as any;
}

function mockRes(): http.ServerResponse & { _status: number; _body: string } {
  const res: any = {
    _status: 0,
    _body: '',
    writeHead(status: number) { res._status = status; },
    end(body?: string) { res._body = body || ''; },
  };
  return res;
}

beforeEach(async () => {
  jest.resetModules();
  delete process.env.OPS_API_KEY;
});

describe('Auth Middleware', () => {
  describe('dev mode (no OPS_API_KEY)', () => {
    beforeEach(async () => {
      const mod = await import('../middleware/auth');
      authenticate = mod.authenticate;
      requireAuth = mod.requireAuth;
    });

    test('allows all requests as dev-user with admin role', async () => {
      const ctx = await authenticate(mockReq());
      expect(ctx.authenticated).toBe(true);
      expect(ctx.userId).toBe('dev-user');
      expect(ctx.role).toBe('admin');
    });

    test('allows requests even without auth header', async () => {
      const ctx = await authenticate(mockReq());
      expect(ctx.authenticated).toBe(true);
    });
  });

  describe('single-user mode (OPS_API_KEY set)', () => {
    beforeEach(async () => {
      process.env.OPS_API_KEY = 'test-secret-key';
      const mod = await import('../middleware/auth');
      authenticate = mod.authenticate;
      requireAuth = mod.requireAuth;
    });

    test('rejects requests without auth header', async () => {
      const ctx = await authenticate(mockReq());
      expect(ctx.authenticated).toBe(false);
    });

    test('rejects requests with wrong token', async () => {
      const ctx = await authenticate(mockReq('Bearer wrong-key'));
      expect(ctx.authenticated).toBe(false);
    });

    test('accepts correct token', async () => {
      const ctx = await authenticate(mockReq('Bearer test-secret-key'));
      expect(ctx.authenticated).toBe(true);
      expect(ctx.userId).toBe('authenticated-user');
      expect(ctx.role).toBe('admin');
    });

    test('rejects non-Bearer auth', async () => {
      const ctx = await authenticate(mockReq('Basic dGVzdDp0ZXN0'));
      expect(ctx.authenticated).toBe(false);
    });
  });

  describe('multi-user mode (aops_ keys + userLookup)', () => {
    beforeEach(async () => {
      process.env.OPS_API_KEY = 'fallback-key';
      const mod = await import('../middleware/auth');
      authenticate = mod.authenticate;
      setUserLookup = mod.setUserLookup;

      setUserLookup(async (apiKey: string) => {
        if (apiKey === 'aops_valid_operator_key') {
          return { id: 'user-1', role: 'operator' };
        }
        if (apiKey === 'aops_valid_admin_key') {
          return { id: 'user-2', role: 'admin' };
        }
        return null;
      });
    });

    test('authenticates valid aops_ key as operator', async () => {
      const ctx = await authenticate(mockReq('Bearer aops_valid_operator_key'));
      expect(ctx.authenticated).toBe(true);
      expect(ctx.userId).toBe('user-1');
      expect(ctx.role).toBe('operator');
    });

    test('authenticates valid aops_ admin key', async () => {
      const ctx = await authenticate(mockReq('Bearer aops_valid_admin_key'));
      expect(ctx.authenticated).toBe(true);
      expect(ctx.userId).toBe('user-2');
      expect(ctx.role).toBe('admin');
    });

    test('rejects invalid aops_ key', async () => {
      const ctx = await authenticate(mockReq('Bearer aops_unknown_key'));
      expect(ctx.authenticated).toBe(false);
    });

    test('falls back to single-user key', async () => {
      const ctx = await authenticate(mockReq('Bearer fallback-key'));
      expect(ctx.authenticated).toBe(true);
      expect(ctx.userId).toBe('authenticated-user');
    });
  });

  describe('requireAuth', () => {
    beforeEach(async () => {
      process.env.OPS_API_KEY = 'secret';
      const mod = await import('../middleware/auth');
      requireAuth = mod.requireAuth;
    });

    test('returns false and sends 401 for unauthenticated', async () => {
      const res = mockRes();
      const ok = await requireAuth(mockReq(), res);
      expect(ok).toBe(false);
      expect(res._status).toBe(401);
      expect(res._body).toContain('Unauthorized');
    });

    test('returns true and attaches auth to request', async () => {
      const req = mockReq('Bearer secret') as any;
      const res = mockRes();
      const ok = await requireAuth(req, res);
      expect(ok).toBe(true);
      expect(req.auth.authenticated).toBe(true);
    });
  });

  describe('requireRole', () => {
    beforeEach(async () => {
      const mod = await import('../middleware/auth');
      requireRole = mod.requireRole;
      setUserLookup = mod.setUserLookup;

      setUserLookup(async (apiKey: string) => {
        if (apiKey === 'aops_viewer') return { id: 'v1', role: 'viewer' as const };
        if (apiKey === 'aops_admin') return { id: 'a1', role: 'admin' as const };
        return null;
      });
    });

    test('allows admin for admin-only route', async () => {
      const check = requireRole('admin');
      const res = mockRes();
      const ok = await check(mockReq('Bearer aops_admin'), res);
      expect(ok).toBe(true);
    });

    test('rejects viewer for admin-only route', async () => {
      const check = requireRole('admin');
      const res = mockRes();
      const ok = await check(mockReq('Bearer aops_viewer'), res);
      expect(ok).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body).toContain('Forbidden');
    });

    test('allows viewer for viewer-allowed route', async () => {
      const check = requireRole('viewer', 'operator', 'admin');
      const res = mockRes();
      const ok = await check(mockReq('Bearer aops_viewer'), res);
      expect(ok).toBe(true);
    });
  });
});
