/**
 * Next.js configuration for the app router application.
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'logos.composio.dev'
      },
      {
        // Generated agent avatars, see app/api/agent/configure/route.ts.
        protocol: 'https',
        hostname: 'api.dicebear.com'
      }
    ]
  }
};

export default nextConfig;
