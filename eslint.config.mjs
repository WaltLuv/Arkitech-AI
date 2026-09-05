// eslint-config-next ships native flat configs from v16, so these are spread
// directly rather than wrapped in FlatCompat.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            "next-env.d.ts",
            "drizzle/**",
        ],
    },
    ...coreWebVitals,
    ...typescript,
];

export default config;
