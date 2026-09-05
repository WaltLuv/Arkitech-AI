import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        // Resolves the "@/*" alias from tsconfig.json so tests import the same
        // specifiers the app does. Native in Vite; no plugin needed.
        tsconfigPaths: true,
    },
    test: {
        // These are unit tests over lib/, not component tests. Anything needing
        // a DOM should set its own environment via a docblock.
        environment: "node",
        include: ["**/*.test.ts", "**/*.test.tsx"],
        exclude: ["node_modules/**", ".next/**"],
    },
});
