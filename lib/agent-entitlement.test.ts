import { describe, expect, it } from "vitest";
import {
    AGENT_SLOT_PLAN_TIERS,
    DEFAULT_AGENT_SLOT_PLAN_TIER,
    MAX_AGENT_SLOT_ENTITLEMENT,
    PLAN_INCLUDED_AGENT_SLOTS,
    agentSlotLimitMessage,
    describeAgentSlotEntitlement,
    hasAgentSlotAvailable,
    isValidAgentSlotOverride,
    resolveAgentSlotPlanTier,
    resolveEffectiveAgentSlots,
} from "@/lib/agent-entitlement";

describe("Agent Slot plans", () => {
    it("gives each plan the agreed number of slots", () => {
        expect(PLAN_INCLUDED_AGENT_SLOTS.starter).toBe(3);
        expect(PLAN_INCLUDED_AGENT_SLOTS.pro).toBe(10);
        expect(PLAN_INCLUDED_AGENT_SLOTS.business).toBe(25);
    });

    it("keeps 3 as Starter's allotment rather than a universal rule", () => {
        // The number that used to be AGENT_SLOT_QUOTA. It survives as one
        // plan's entitlement, and nothing else may assume it.
        expect(DEFAULT_AGENT_SLOT_PLAN_TIER).toBe("starter");
        expect(PLAN_INCLUDED_AGENT_SLOTS[DEFAULT_AGENT_SLOT_PLAN_TIER]).toBe(3);
    });

    it("never includes more than the ceiling with any plan", () => {
        for (const tier of AGENT_SLOT_PLAN_TIERS) {
            expect(PLAN_INCLUDED_AGENT_SLOTS[tier]).toBeLessThanOrEqual(MAX_AGENT_SLOT_ENTITLEMENT);
        }
    });
});

describe("Resolving a plan", () => {
    it("reads a real plan as itself", () => {
        expect(resolveAgentSlotPlanTier("business")).toBe("business");
    });

    it("treats a legacy null plan as Starter", () => {
        // Every account predating the entitlement migration has no plan and
        // must keep exactly the capacity it had.
        expect(resolveAgentSlotPlanTier(null)).toBe("starter");
        expect(resolveEffectiveAgentSlots({ planTier: null })).toBe(3);
    });

    it("treats an unknown plan as Starter rather than trusting it", () => {
        expect(resolveAgentSlotPlanTier("enterprise_unlimited")).toBe("starter");
        expect(resolveEffectiveAgentSlots({ planTier: "BUSINESS" })).toBe(3);
        expect(resolveEffectiveAgentSlots({ planTier: 25 })).toBe(3);
    });
});

describe("Overrides", () => {
    it("accepts whole numbers from zero to the ceiling", () => {
        expect(isValidAgentSlotOverride(0)).toBe(true);
        expect(isValidAgentSlotOverride(100)).toBe(true);
        expect(isValidAgentSlotOverride(MAX_AGENT_SLOT_ENTITLEMENT)).toBe(true);
    });

    it("refuses anything a slot count cannot be", () => {
        expect(isValidAgentSlotOverride(-1)).toBe(false);
        expect(isValidAgentSlotOverride(101)).toBe(false);
        expect(isValidAgentSlotOverride(2.5)).toBe(false);
        expect(isValidAgentSlotOverride(NaN)).toBe(false);
        expect(isValidAgentSlotOverride(Infinity)).toBe(false);
        expect(isValidAgentSlotOverride("25")).toBe(false);
        expect(isValidAgentSlotOverride(null)).toBe(false);
        expect(isValidAgentSlotOverride(undefined)).toBe(false);
    });

    it("supersedes the plan when it is valid", () => {
        expect(resolveEffectiveAgentSlots({ planTier: "starter", agentSlotOverride: 100 })).toBe(100);
        expect(resolveEffectiveAgentSlots({ planTier: "business", agentSlotOverride: 5 })).toBe(5);
    });

    it("gives an operator account a large limit without naming anyone in source", () => {
        // The owner override is an account value, not an email in a constant.
        expect(resolveEffectiveAgentSlots({ planTier: "enterprise", agentSlotOverride: 100 })).toBe(100);
    });

    it("falls back to the plan when a stored override is unusable", () => {
        // The read path fails safe. A bad value that reached the database
        // must never widen an entitlement, only fail to narrow one.
        expect(resolveEffectiveAgentSlots({ planTier: "pro", agentSlotOverride: -5 })).toBe(10);
        expect(resolveEffectiveAgentSlots({ planTier: "pro", agentSlotOverride: 10_000 })).toBe(10);
        expect(resolveEffectiveAgentSlots({ planTier: "pro", agentSlotOverride: 1.5 })).toBe(10);
        expect(resolveEffectiveAgentSlots({ planTier: "pro", agentSlotOverride: "999" })).toBe(10);
    });

    it("lets zero freeze an account without deleting an Agent", () => {
        const frozen = describeAgentSlotEntitlement({
            planTier: "business",
            agentSlotOverride: 0,
            occupiedSlots: 4,
        });

        expect(frozen.effectiveLimit).toBe(0);
        expect(frozen.availableSlots).toBe(0);
        expect(frozen.isAtLimit).toBe(true);
        expect(frozen.occupiedSlots).toBe(4);
    });
});

describe("Describing an account's position", () => {
    it("reports a Business account mid-hire", () => {
        const seat = describeAgentSlotEntitlement({ planTier: "business", occupiedSlots: 15 });

        expect(seat).toMatchObject({
            planTier: "business",
            includedSlots: 25,
            override: null,
            effectiveLimit: 25,
            occupiedSlots: 15,
            availableSlots: 10,
            isAtLimit: false,
            isOverEntitlement: false,
        });
    });

    it("reports being exactly at the limit", () => {
        const seat = describeAgentSlotEntitlement({ planTier: "pro", occupiedSlots: 10 });

        expect(seat.availableSlots).toBe(0);
        expect(seat.isAtLimit).toBe(true);
        expect(seat.isOverEntitlement).toBe(false);
    });

    it("never reports negative availability after a downgrade", () => {
        // 14 Agents on a 10-slot plan is zero available, not minus four.
        const seat = describeAgentSlotEntitlement({ planTier: "pro", occupiedSlots: 14 });

        expect(seat.occupiedSlots).toBe(14);
        expect(seat.effectiveLimit).toBe(10);
        expect(seat.availableSlots).toBe(0);
        expect(seat.isAtLimit).toBe(true);
        expect(seat.isOverEntitlement).toBe(true);
    });

    it("exposes the override it actually used", () => {
        expect(describeAgentSlotEntitlement({ planTier: "starter", agentSlotOverride: 40, occupiedSlots: 0 }).override).toBe(40);
        expect(describeAgentSlotEntitlement({ planTier: "starter", agentSlotOverride: 4000, occupiedSlots: 0 }).override).toBeNull();
    });
});

describe("Whether another Agent may be created", () => {
    it("allows below the limit and refuses at it, on every plan", () => {
        expect(hasAgentSlotAvailable(2, 3)).toBe(true);
        expect(hasAgentSlotAvailable(3, 3)).toBe(false);
        expect(hasAgentSlotAvailable(9, 10)).toBe(true);
        expect(hasAgentSlotAvailable(10, 10)).toBe(false);
        expect(hasAgentSlotAvailable(24, 25)).toBe(true);
        expect(hasAgentSlotAvailable(25, 25)).toBe(false);
    });

    it("refuses above the limit, which a downgrade produces", () => {
        expect(hasAgentSlotAvailable(14, 10)).toBe(false);
    });
});

describe("The refusal message", () => {
    it("names the real limit, so the UI cannot contradict the server", () => {
        expect(agentSlotLimitMessage({ effectiveLimit: 25, occupiedSlots: 25 })).toContain("25");
    });

    it("tells an over-entitled account its Agents are safe", () => {
        // The failure mode of the plain message here is that it reads like
        // the missing four Agents were taken away.
        const message = agentSlotLimitMessage({ effectiveLimit: 10, occupiedSlots: 14 });

        expect(message).toContain("14");
        expect(message).toContain("10");
        expect(message).toMatch(/keep working/i);
    });
});
