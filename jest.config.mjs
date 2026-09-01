// Unit tests for the pure-TS runtime packages (agents/, mcp-skills/).
// App UI is covered by Playwright e2e instead — see playwright.config.ts.
export default {
  testEnvironment: "node",
  watchman: false, // local watchman binary is broken (icu4c dylib); jest crawls fine without it
  extensionsToTreatAsEsm: [".ts"],
  // Source uses ESM ".js" specifiers that resolve to ".ts" on disk.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      {
        jsc: { target: "es2022", parser: { syntax: "typescript" } },
        module: { type: "es6" },
      },
    ],
  },
  testMatch: ["<rootDir>/(agents|mcp-skills)/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
