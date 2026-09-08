/**
 * Sets an account's plan or Agent Slot override.
 *
 * Entitlement is privileged state, so there is deliberately no HTTP route that
 * changes it: an endpoint is a surface to authorise, and this needs none. It
 * runs against the database with credentials only an operator has, which is
 * also why no email address belongs in application source. The owner's account
 * gets its large limit by being run through here once.
 *
 * Values are validated and rejected, never clamped. An operator who types 1000
 * should see that refused rather than silently receive 100, because the second
 * is indistinguishable from having got what they asked for.
 *
 * Usage:
 *   node scripts/set-agent-slot-entitlement.mjs --email a@b.com --plan business
 *   node scripts/set-agent-slot-entitlement.mjs --email a@b.com --override 100
 *   node scripts/set-agent-slot-entitlement.mjs --email a@b.com --clear-override
 *   node scripts/set-agent-slot-entitlement.mjs --email a@b.com            (reads)
 *
 * Never deletes, pauses or renumbers an Agent. An account moved below what it
 * already occupies keeps every Agent and is simply refused a new one.
 */
import { neon } from "@neondatabase/serverless";

const PLAN_TIERS = ["starter", "pro", "business", "enterprise"];
const PLAN_INCLUDED_SLOTS = { starter: 3, pro: 10, business: 25, enterprise: 25 };
const MAX_AGENT_SLOT_ENTITLEMENT = 100;

const args = process.argv.slice(2);
const valueOf = (flag) => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
};

const email = valueOf("--email");
const plan = valueOf("--plan");
const override = valueOf("--override");
const clearOverride = args.includes("--clear-override");

if (!email) {
    console.error("An --email is required.");
    process.exit(1);
}

if (plan !== undefined && !PLAN_TIERS.includes(plan)) {
    console.error(`Unknown plan "${plan}". Expected one of: ${PLAN_TIERS.join(", ")}`);
    process.exit(1);
}

let overrideValue;
if (override !== undefined) {
    if (clearOverride) {
        console.error("Pass either --override or --clear-override, not both.");
        process.exit(1);
    }

    overrideValue = Number(override);

    if (!Number.isInteger(overrideValue) || overrideValue < 0 || overrideValue > MAX_AGENT_SLOT_ENTITLEMENT) {
        console.error(
            `Refusing override "${override}". It must be a whole number from 0 to ${MAX_AGENT_SLOT_ENTITLEMENT}.`,
        );
        process.exit(1);
    }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
}

const sql = neon(connectionString);

const [account] = await sql`
    SELECT "email", "plan_tier", "agent_slot_override" FROM "users" WHERE "email" = ${email}
`;

if (!account) {
    console.error(`No account for ${email}.`);
    process.exit(1);
}

const occupied = Number(
    (await sql`SELECT count(*) AS n FROM "agentConfig" WHERE "email" = ${email}`)[0].n,
);

const describe = (row) => {
    const stored = row.agent_slot_override;
    const usable =
        stored !== null && Number.isInteger(stored) && stored >= 0 && stored <= MAX_AGENT_SLOT_ENTITLEMENT;
    const tier = PLAN_TIERS.includes(row.plan_tier) ? row.plan_tier : "starter";
    const effective = usable ? stored : PLAN_INCLUDED_SLOTS[tier];

    return { tier, override: usable ? stored : null, effective };
};

const before = describe(account);
console.log(`Before: ${before.tier}, override ${before.override ?? "none"}, limit ${before.effective}, occupied ${occupied}`);

if (plan === undefined && override === undefined && !clearOverride) {
    process.exit(0);
}

if (plan !== undefined) {
    await sql`UPDATE "users" SET "plan_tier" = ${plan} WHERE "email" = ${email}`;
}

if (clearOverride) {
    await sql`UPDATE "users" SET "agent_slot_override" = NULL WHERE "email" = ${email}`;
} else if (overrideValue !== undefined) {
    await sql`UPDATE "users" SET "agent_slot_override" = ${overrideValue} WHERE "email" = ${email}`;
}

const [updated] = await sql`
    SELECT "email", "plan_tier", "agent_slot_override" FROM "users" WHERE "email" = ${email}
`;

const after = describe(updated);
console.log(`After:  ${after.tier}, override ${after.override ?? "none"}, limit ${after.effective}, occupied ${occupied}`);

if (occupied > after.effective) {
    console.log(
        `Note: ${occupied} Agents occupy slots against a limit of ${after.effective}. Every one of them is kept and keeps running. New Agents are refused until ${occupied - after.effective + 1} are deleted.`,
    );
}
