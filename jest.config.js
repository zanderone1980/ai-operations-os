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
};
