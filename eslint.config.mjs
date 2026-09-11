/**
 * Flat config, which is the only format ESLint 9 reads.
 *
 * There was no config file here at all, and the `lint` script called
 * `next lint`, which Next 16 removed. Between them, linting this project was
 * a gate that had never run: `npm run lint` failed with a path error that
 * read like a bad argument rather than a missing config.
 *
 * eslint-config-next 16 exports flat config directly, so it is spread here
 * rather than wrapped in FlatCompat (which cannot serialise it).
 */
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
    {
        ignores: [".next/**", "node_modules/**", "next-env.d.ts", "drizzle/**"],
    },

    ...coreWebVitals,
    ...typescript,

    {
        rules: {
            // Used at a handful of provider boundaries where the SDK's own
            // types are wrong. Worth seeing, not worth failing the build on.
            "@typescript-eslint/no-explicit-any": "warn",

            /**
             * The React Compiler rules, kept visible but not blocking.
             *
             * They are right: these components call setState inside an effect
             * and mutate values they should copy, which costs cascading
             * renders. Fixing them means restructuring the components, and
             * this app is feature-frozen for deployment, so a refactor is the
             * one thing that must not happen here. Warnings keep the list in
             * front of whoever picks the components up next; errors would only
             * teach people to stop running lint.
             */
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/immutability": "warn",

            // Usually a real mistake, but an argument kept for signature shape,
            // or an error deliberately swallowed, is not.
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrors: "none",
                },
            ],
        },
    },
];
