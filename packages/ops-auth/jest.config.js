/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  displayName: 'ops-auth',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
  ],
};
