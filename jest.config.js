/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    '<rootDir>/packages/shared-types',
    '<rootDir>/packages/ops-core',
    '<rootDir>/packages/ops-policy',
    '<rootDir>/packages/ops-connectors',
    '<rootDir>/packages/ops-storage',
    '<rootDir>/packages/spark-engine',
    '<rootDir>/apps/ops-api',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
};
