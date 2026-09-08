import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH, splitForTelegram } from "@/lib/channels/telegram/client";
import { splitForSlack } from "@/lib/channels/slack/client";

/**
 * Both providers refuse a message over their limit. An Agent that writes a long
 * answer should not have it silently dropped, so the answer is split.
 */
describe.each([
    ["telegram", splitForTelegram, MAX_MESSAGE_LENGTH],
    ["slack", splitForSlack, 3000],
])("%s message splitting", (_name, split, limit) => {
    it("leaves a short answer alone", () => {
        expect(split("short answer")).toEqual(["short answer"]);
    });

    it("leaves one exactly at the limit alone", () => {
        const text = "a".repeat(limit);

        expect(split(text)).toEqual([text]);
    });

    it("splits one over the limit", () => {
        const chunks = split("a".repeat(limit + 500));

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every(chunk => chunk.length <= limit)).toBe(true);
    });

    it("loses no text when it splits", () => {
        const text = `${"a".repeat(limit - 5)}\n\n${"b".repeat(600)}`;
        const chunks = split(text);

        expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    });

    it("prefers a paragraph break to cutting mid-sentence", () => {
        const first = "a".repeat(limit - 100);
        const chunks = split(`${first}\n\nsecond paragraph ${"b".repeat(600)}`);

        expect(chunks[0]).toBe(first);
    });

    it("splits a very long answer into as many parts as it needs", () => {
        const chunks = split("a".repeat(limit * 3 + 10));

        expect(chunks.length).toBeGreaterThanOrEqual(4);
        expect(chunks.every(chunk => chunk.length <= limit)).toBe(true);
    });
});
