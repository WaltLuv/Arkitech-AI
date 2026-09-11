/**
 * Next.js configuration for the app router application.
 */
import type { NextConfig } from "next";

/**
 * Sent on every response.
 *
 * The framing rules are the ones that matter most here, and they are doubled
 * deliberately: X-Frame-Options for older browsers, frame-ancestors for the
 * ones that ignore it. Arkitech has a Watch screen that streams a live browser
 * session and a Take Control button that sends real input into it. Framed by
 * someone else's page, that is a clickjacking path into a signed-in user's
 * browser session, not just a defaced dashboard.
 *
 * This is not a full Content-Security-Policy. A script-src worth having has to
 * be built against what Clerk and Next actually load at runtime, and a guessed
 * one either breaks the app or is loose enough to be decorative. frame-ancestors
 * stands on its own and cannot break a page that was never meant to be framed.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },

  // Stops a browser from guessing a type the server did not send, which is how
  // a stored artifact gets treated as script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // A dashboard URL can carry an agent or run id. Send the origin to other
  // sites, never the path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nothing here uses these, and a compromised dependency should not be the
  // thing that discovers otherwise.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  // Render terminates TLS and serves only https, so this costs nothing and
  // closes the first-request downgrade.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'logos.composio.dev'
      }
    ]
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
