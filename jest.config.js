/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    '<rootDir>/packages/shared-types',
    '<rootDir>/packages/ops-core',
    '<rootDir>/packages/ops-policy',
    '<rootDir>/packages/ops-connectors',
    '<rootDir>/packages/ops-storage',
    '<rootDir>/apps/ops-api',
  ],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    'apps/ops-api/src/**/*.ts',
    '!**/__tests__/**',
    '!**/dist/**',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThresholds: {
    global: {
      branches: 60,
      functions: 70,
      lines: 75,
      statements: 75,
    },
  },
};
