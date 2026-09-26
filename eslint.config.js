// @ts-check
const tseslint = require("typescript-eslint");

// src/lib/* is the intentionally-unchanged ported rule engine (see
// vision.md -> Key Constraints) and is exempt from linting.
module.exports = tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/lib/**"] },
  {
    files: ["src/commands/**/*.ts", "src/io/**/*.ts", "src/cli.ts", "test-files/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // vision.md: new/non-ported files should stay ~500-800 lines so they
      // stay easy to read and cheap for an agent to load into context.
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
);
