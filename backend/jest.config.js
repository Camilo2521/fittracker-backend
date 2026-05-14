'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  // Cada worker obtiene su propio archivo SQLite (via process.pid en env.js)
  maxWorkers: '50%',
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js',
  ],
  coverageThreshold: {
    global: { lines: 92, functions: 92, branches: 80 },
    // Archivos críticos tienen umbrales propios más altos
    './src/routes/v1/auth.js':     { lines: 95, branches: 80 },
    './src/middleware/featureFlags.js': { lines: 100, branches: 100 },
    './src/utils/metrics.js':      { lines: 100, branches: 85 },
    './src/utils/internalToken.js': { lines: 100, branches: 85 },
  },
  testTimeout: 15000,
  forceExit: true,
  verbose: true,
};
