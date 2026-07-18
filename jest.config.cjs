const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'api',
      rootDir: path.join(__dirname, 'apps/api'),
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.json',
          },
        ],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      clearMocks: true,
    },
    {
      displayName: 'p2p',
      rootDir: path.join(__dirname, 'apps/p2p'),
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.json',
          },
        ],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      clearMocks: true,
    },
    {
      displayName: 'shared',
      rootDir: path.join(__dirname, 'packages/shared'),
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.json',
          },
        ],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      clearMocks: true,
    },
    {
      displayName: 'contest-service',
      rootDir: path.join(__dirname, 'apps/contest-service'),
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.json',
          },
        ],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      clearMocks: true,
    },
    {
      displayName: 'web',
      rootDir: path.join(__dirname, 'apps/web'),
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.json',
          },
        ],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
      },
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      clearMocks: true,
    },
  ],
};
