import { relative, isAbsolute } from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// web/ is a standalone project inside the FaamOffice monorepo. The monorepo's
// root `eslint .` (ESLint 10) looks configs up per directory and would load this
// file with plugins built for this project's ESLint 9, which crashes. When ESLint
// runs from outside web/, skip these files: web is linted by its own
// `npm run lint` (run inside web/).
const cwdInsideWeb = (() => {
  const rel = relative(import.meta.dirname, process.cwd());
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
})();

const eslintConfig = cwdInsideWeb
  ? defineConfig([
      ...nextVitals,
      ...nextTs,
      globalIgnores([".next/**", ".next-*/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "data/**"]),
    ])
  : defineConfig([globalIgnores(["**/*"])]);

export default eslintConfig;
