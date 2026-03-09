/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'ops-api',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-ops/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@ai-ops/ops-core$': '<rootDir>/../../packages/ops-core/src',
    '^@ai-ops/ops-policy$': '<rootDir>/../../packages/ops-policy/src',
    '^@ai-ops/ops-connectors$': '<rootDir>/../../packages/ops-connectors/src',
    '^@ai-ops/cord-adapter$': '<rootDir>/../../packages/cord-adapter/src',
    '^@ai-ops/codebot-adapter$': '<rootDir>/../../packages/codebot-adapter/src',
    '^@ai-ops/ops-storage$': '<rootDir>/../../packages/ops-storage/src',
    '^@ai-ops/ops-worker$': '<rootDir>/../ops-worker/src',
  },
};
