/**
 * Shared Inngest client used by route handlers and background functions.
 */
// src/inngest/client.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "arkitech-ai" });