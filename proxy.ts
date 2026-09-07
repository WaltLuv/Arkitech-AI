/**
 * Clerk proxy middleware that protects dashboard and API routes while skipping
 * static assets.
 *
 * `/api/health` is deliberately outside the matcher. It reports whether the
 * process, the database and browser configuration are up, and the deployment
 * host polls it to decide whether to send traffic. Running Clerk in front of it
 * makes it answer 500 whenever Clerk itself is misconfigured, which is exactly
 * the moment a truthful answer matters most. It returns booleans and states
 * only, never a value, so it is safe to leave open.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard",
  "/dashboard/:path*",

])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|api/health|[^?]*\\.(?:html|css|js|gif|svg|jpg|jpeg|png|woff|woff2|ico|csv|docx|xlsx|zip|webmanifest)).*)',
    // Always run for API routes, except the public health check.
    '/(api(?!/health)|trpc)(.*)',
  ],
};
