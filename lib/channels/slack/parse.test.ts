import { describe, expect, it } from "vitest";

import { parseSlackEvent } from "@/lib/channels/slack/parse";

const base = {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev123",
    event: {
        type: "message",
        channel: "D456",
        channel_type: "im",
        user: "U789",
        text: "Draft the update",
        ts: "1700000000.000100",
    },
};

describe("parseSlackEvent", () => {
    it("reads a direct message", () => {
        expect(parseSlackEvent(base)).toEqual({
            provider: "slack",
            externalEventId: "Ev123",
            externalChatId: "D456",
            externalUserId: "U789",
            chatKind: "private",
            externalMessageId: "1700000000.000100",
            text: "Draft the update",
            linkCode: null,
            unsupportedKind: null,
        });
    });

    it("uses event_id as the dedup key", () => {
        // Slack reuses event_id across its three retries.
        expect(parseSlackEvent(base)?.externalEventId).toBe("Ev123");
    });

    it("ignores the app's own messages", () => {
        // Otherwise the Team member answers itself, forever.
        expect(
            parseSlackEvent({ ...base, event: { ...base.event, bot_id: "B1" } }),
        ).toBeNull();
    });

    it("ignores edits, deletions and joins", () => {
        for (const subtype of ["message_changed", "message_deleted", "channel_join"]) {
            expect(parseSlackEvent({ ...base, event: { ...base.event, subtype } })).toBeNull();
        }
    });

    it("recognises a channel as not private", () => {
        const parsed = parseSlackEvent({
            ...base,
            event: { ...base.event, channel_type: "channel" },
        });

        expect(parsed?.chatKind).toBe("group");
    });

    it("recognises a multi-person direct message as not private", () => {
        const parsed = parseSlackEvent({ ...base, event: { ...base.event, channel_type: "mpim" } });

        expect(parsed?.chatKind).toBe("group");
    });

    it("names an attachment it cannot read", () => {
        const parsed = parseSlackEvent({
            ...base,
            event: { ...base.event, text: undefined, files: [{}] },
        });

        expect(parsed?.unsupportedKind).toBe("file");
    });

    it("ignores anything that is not an event callback", () => {
        expect(parseSlackEvent({ ...base, type: "url_verification" })).toBeNull();
    });

    it("returns null rather than throwing on an unfamiliar shape", () => {
        expect(parseSlackEvent({} as never)).toBeNull();
        expect(parseSlackEvent({ type: "event_callback", event_id: "E", event: {} } as never)).toBeNull();
    });
});
