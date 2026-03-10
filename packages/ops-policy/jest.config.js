/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'ops-policy',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-operations/shared-types$': '<rootDir>/../shared-types/src',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
  ],
};
