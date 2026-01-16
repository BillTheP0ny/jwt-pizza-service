module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['json-summary', 'text', 'lcov'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config.js',
    '!src/version.json',
    '!src/index.js',
    '!src/init.js',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
    },
  },
};
