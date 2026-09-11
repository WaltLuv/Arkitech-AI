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
 *
 * The two channel webhooks are outside it for the same reason. Their callers
 * are Telegram and Slack, which have no Arkitech session and never will, so
 * Clerk can only fail them: each authenticates its own caller instead, by
 * secret token and by HMAC signature respectively, before reading the body.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
    '/((?!_next|api/health|api/channels/telegram/webhook|api/channels/slack/events|[^?]*\\.(?:html|css|js|gif|svg|jpg|jpeg|png|woff|woff2|ico|csv|docx|xlsx|zip|webmanifest)).*)',
    // Always run for API routes, except the public health check and the two
    // provider webhooks, which authenticate their own callers.
    '/(api(?!/health|/channels/telegram/webhook|/channels/slack/events)|trpc)(.*)',
  ],
};
