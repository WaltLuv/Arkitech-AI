import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    inserted: [] as Record<string, unknown>[],
    deleted: 0,
    redeemResult: [] as unknown[],
    lastUpdateWhere: null as unknown,
}));

vi.mock("@/db", () => ({
    db: {
        insert: () => ({
            values: (values: Record<string, unknown>) => {
                mocks.inserted.push(values);
                return Promise.resolve([values]);
            },
        }),
        delete: () => ({
            where: () => {
                mocks.deleted += 1;
                return Promise.resolve([]);
            },
        }),
        update: () => ({
            set: () => ({
                where: (clause: unknown) => {
                    mocks.lastUpdateWhere = clause;
                    return { returning: () => Promise.resolve(mocks.redeemResult) };
                },
            }),
        }),
    },
    channelLinkCode: {
        connectionId: "connection_id",
        usedAt: "used_at",
        codeHash: "code_hash",
        expiresAt: "expires_at",
        userEmail: "email",
    },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ op: "and", c }),
    eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
    gt: (col: unknown, v: unknown) => ({ op: "gt", col, v }),
    isNull: (col: unknown) => ({ op: "isNull", col }),
    sql: (parts: TemplateStringsArray) => ({ op: "sql", parts: [...parts] }),
}));

import { hashLinkCode, issueLinkCode, redeemLinkCode } from "@/lib/channels/linking";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted.length = 0;
    mocks.deleted = 0;
    mocks.redeemResult = [];
    mocks.lastUpdateWhere = null;
});

describe("issueLinkCode", () => {
    it("stores only a hash, never the code", async () => {
        const code = await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });

        expect(mocks.inserted[0].codeHash).toBe(hashLinkCode(code));
        expect(JSON.stringify(mocks.inserted[0])).not.toContain(code);
    });

    it("drops any earlier unused code first", async () => {
        // Otherwise restarting setup leaves a second working link alive.
        await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });

        expect(mocks.deleted).toBe(1);
    });

    it("issues a different code every time", async () => {
        const a = await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });
        const b = await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });

        expect(a).not.toEqual(b);
    });

    it("issues a code Telegram will carry in a deep link", async () => {
        // Telegram allows up to 64 characters of A-Z a-z 0-9 _ and - .
        const code = await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });

        expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    });

    it("gives the code an expiry", async () => {
        await issueLinkCode({ connectionId: "conn-1", userEmail: "owner@example.com" });

        expect(mocks.inserted[0].expiresAt).toBeInstanceOf(Date);
        expect((mocks.inserted[0].expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    });
});

describe("redeemLinkCode", () => {
    it("returns the connection and owner for a valid code", async () => {
        mocks.redeemResult = [{ connectionId: "conn-1", userEmail: "owner@example.com" }];

        expect(await redeemLinkCode("some-code")).toEqual({
            connectionId: "conn-1",
            userEmail: "owner@example.com",
        });
    });

    it("returns nothing when the code does not match", async () => {
        mocks.redeemResult = [];

        expect(await redeemLinkCode("wrong-code")).toBeNull();
    });

    it("enforces single use in the statement rather than by reading first", async () => {
        // Two people presenting one code both pass a read; only one can pass a
        // predicate that requires used_at to still be null.
        await redeemLinkCode("some-code");

        const clauses = JSON.stringify(mocks.lastUpdateWhere);

        expect(clauses).toContain("isNull");
        expect(clauses).toContain("gt");
    });

    it("looks the code up by hash, never by the code itself", async () => {
        await redeemLinkCode("some-code");

        const clauses = JSON.stringify(mocks.lastUpdateWhere);

        expect(clauses).not.toContain("some-code");
        expect(clauses).toContain(hashLinkCode("some-code"));
    });
});
