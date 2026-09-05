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
      }
    ]
  }
};

export default nextConfig;
