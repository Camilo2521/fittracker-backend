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
    global: { lines: 70, functions: 70, branches: 60 },
  },
  testTimeout: 15000,
  forceExit: true,
  verbose: true,
};
