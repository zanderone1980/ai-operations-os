/**
 * @ai-operations/ops-auth
 *
 * Authentication, password hashing, and encrypted credential vault
 * for the AI Operations OS. Zero external dependencies — uses
 * only Node.js built-in crypto module.
 */

// JWT
export { signToken, verifyToken, decodeToken } from './jwt';
export type { JwtPayload, JwtHeader } from './jwt';

// Password hashing
export { hashPassword, verifyPassword } from './password';

// Credential vault (AES-256-GCM)
export { encrypt, decrypt, getVaultKey } from './vault';
