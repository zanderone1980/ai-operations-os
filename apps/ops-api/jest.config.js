/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'ops-api',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-operations/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@ai-operations/ops-core$': '<rootDir>/../../packages/ops-core/src',
    '^@ai-operations/ops-policy$': '<rootDir>/../../packages/ops-policy/src',
    '^@ai-operations/ops-connectors$': '<rootDir>/../../packages/ops-connectors/src',
    '^@ai-operations/cord-adapter$': '<rootDir>/../../packages/cord-adapter/src',
    '^@ai-operations/codebot-adapter$': '<rootDir>/../../packages/codebot-adapter/src',
    '^@ai-operations/ops-storage$': '<rootDir>/../../packages/ops-storage/src',
    '^@ai-operations/ops-worker$': '<rootDir>/../ops-worker/src',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
  ],
};
