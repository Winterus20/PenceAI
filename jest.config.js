/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    transform: {
        '^.+\\.[tj]sx?$': [
            'ts-jest',
            {
                useESM: true,
                isolatedModules: true,
            },
        ],
    },
    testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
    roots: [
        '<rootDir>/tests',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/tests/e2e/',
    ],
    transformIgnorePatterns: [
        '/node_modules/(?!uuid)/',
    ],
    // Paralellik ve performans ayarları
    maxWorkers: process.env.CI ? 2 : '50%',
    testTimeout: 10000,
    slowTestThreshold: 5,
    cacheDirectory: '<rootDir>/.jest-cache',

    collectCoverageFrom: [
        'src/**/*.ts',
        'src/web/react-app/src/**/*.ts',
        'src/web/react-app/src/**/*.tsx',
        '!src/**/*.d.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 10,
            functions: 10,
            lines: 10,
            statements: 10,
        },
    },
};
