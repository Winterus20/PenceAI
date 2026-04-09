/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/web/react-app/src/$1',
    },
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: true,
                isolatedModules: true,
            },
        ],
    },
    testMatch: ['**/tests/**/*.test.ts'],
    // Frontend testleri icin ayarlar
    roots: [
        '<rootDir>/tests',
    ],
    // Test path ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
    ],
    // Coverage ayarlari
    collectCoverageFrom: [
        'src/**/*.ts',
        'src/web/react-app/src/**/*.ts',
        'src/web/react-app/src/**/*.tsx',
        '!src/**/*.d.ts',
    ],
    // Frontend testleri icin globals
    globals: {
        'ts-jest': {
            useESM: true,
            isolatedModules: true,
        },
    },
};
