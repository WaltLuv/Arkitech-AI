/**
 * Database client setup for Neon serverless Postgres with the Drizzle schema attached.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

// A well-formed placeholder so importing this module during a build without
// DATABASE_URL set does not throw. neon() validates the string's shape eagerly;
// 'postgresql://placeholder-url' is not valid and fails the production build.
const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://user:password@placeholder.neon.tech/dbname';

const sql = neon(databaseUrl);
export const db = drizzle({ client: sql, schema });
export * from '@/db/schema';
