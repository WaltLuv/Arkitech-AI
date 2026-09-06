import { describe, expect, it } from "vitest";
import {
    AGENT_SLOT_QUOTA,
    agentSlotLimitMessage,
    hasAgentSlotAvailable,
} from "@/lib/agent-slots";

describe("Agent Slots", () => {
    it("sets the quota to 3", () => {
        expect(AGENT_SLOT_QUOTA).toBe(3);
    });

    it("allows creation below the quota", () => {
        expect(hasAgentSlotAvailable(0)).toBe(true);
        expect(hasAgentSlotAvailable(2)).toBe(true);
    });

    it("refuses exactly at the quota", () => {
        // The boundary is the case that regresses. One below allows, at refuses.
        expect(hasAgentSlotAvailable(3)).toBe(false);
    });

    it("refuses above the quota, which a stale row count could produce", () => {
        expect(hasAgentSlotAvailable(4)).toBe(false);
    });

    it("names the real quota in the message, so the UI cannot contradict it", () => {
        expect(agentSlotLimitMessage()).toContain("3");
    });

    it("accepts an explicit quota, so the rule is testable without editing it", () => {
        expect(hasAgentSlotAvailable(4, 10)).toBe(true);
        expect(hasAgentSlotAvailable(10, 10)).toBe(false);
    });
});
