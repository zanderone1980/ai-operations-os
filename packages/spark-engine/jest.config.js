/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'spark-engine',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-ops/shared-types$': '<rootDir>/../shared-types/src',
    '^@ai-ops/ops-storage$': '<rootDir>/../ops-storage/src',
    '^@ai-ops/cord-adapter$': '<rootDir>/../cord-adapter/src',
  },
};
