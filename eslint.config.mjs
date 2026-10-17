import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const internalModules = (...names) => names.flatMap((name) => [`@/${name}`, `@/${name}/**`]);

// Enforces the dependency rule from docs/PROPUESTA.md section 6.2.
// Later entries override earlier ones for the same files.
const forbidImports = (files, group, message) => ({
  files,
  rules: {
    "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
  },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  forbidImports(
    ["src/contracts/**"],
    internalModules("engine", "extraction", "store", "pipeline", "lib", "components", "app"),
    "contracts/ may only depend on zod.",
  ),
  forbidImports(
    ["src/engine/**"],
    [
      ...internalModules("extraction", "store", "pipeline", "lib", "components", "app"),
      "@anthropic-ai/sdk",
      "@libsql/client",
      "fs",
      "node:fs",
    ],
    "engine/ is pure: it may only depend on contracts/.",
  ),
  {
    // The engine is deterministic: the current time is always injected as `now`.
    files: ["src/engine/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "engine/ never reads the clock: use the injected `now`.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "engine/ never reads the clock: use the injected `now`.",
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: "engine/ never reads the clock: use the injected `now`.",
        },
        {
          selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
          message: "engine/ never reads the clock: use the injected `now`.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(format|formatToParts)$/][arguments.length=0]",
          message: "engine/ never reads the clock: pass the injected `now` to the formatter.",
        },
      ],
    },
  },
  forbidImports(
    ["src/extraction/**"],
    [
      ...internalModules("engine", "store", "pipeline", "lib", "components", "app"),
      "@libsql/client",
    ],
    "extraction/ must not see rules, limits or history.",
  ),
  forbidImports(
    ["src/store/**"],
    [
      ...internalModules("engine", "extraction", "pipeline", "lib", "components", "app"),
      "@anthropic-ai/sdk",
    ],
    "store/ may only depend on contracts/ and @libsql/client.",
  ),
  forbidImports(
    ["src/pipeline/**"],
    internalModules("lib", "components", "app"),
    "pipeline/ must not depend on the frontend.",
  ),
  forbidImports(
    ["src/app/**", "src/components/**", "src/lib/**"],
    [
      ...internalModules("engine", "extraction", "store", "pipeline", "app/api"),
      "@anthropic-ai/sdk",
      "@libsql/client",
    ],
    "The frontend talks to the backend only through src/lib/api-client.ts.",
  ),
  forbidImports(
    ["src/app/api/**"],
    [...internalModules("engine", "extraction", "lib", "components"), "@anthropic-ai/sdk"],
    "API routes go through pipeline/ or store/.",
  ),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
