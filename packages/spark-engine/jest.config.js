/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'spark-engine',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-operations/shared-types$': '<rootDir>/../shared-types/src',
    '^@ai-operations/ops-storage$': '<rootDir>/../ops-storage/src',
    '^@ai-operations/cord-adapter$': '<rootDir>/../cord-adapter/src',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
  ],
};
