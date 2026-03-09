/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'ops-connectors',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-ops/shared-types$': '<rootDir>/../shared-types/src',
  },
};
