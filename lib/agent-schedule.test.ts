import { describe, expect, it } from "vitest";
import { calculateNextDailyRun } from "./agent-schedule";

const iso = (date: Date) => date.toISOString();

describe("calculateNextDailyRun", () => {
    it("schedules later the same day when the local time has not passed yet", () => {
        // 12:00Z is 07:00 EST, so today's 09:00 slot is still ahead.
        const next = calculateNextDailyRun({
            time: "09:00",
            timezone: "America/New_York",
            after: new Date("2026-03-05T12:00:00Z"),
        });

        expect(iso(next)).toBe("2026-03-05T14:00:00.000Z");
    });

    it("rolls to tomorrow when the local time has already passed", () => {
        // 15:00Z is 10:00 EST, so today's 09:00 slot is gone.
        const next = calculateNextDailyRun({
            time: "09:00",
            timezone: "America/New_York",
            after: new Date("2026-03-05T15:00:00Z"),
        });

        expect(iso(next)).toBe("2026-03-06T14:00:00.000Z");
    });

    it("keeps the local wall-clock time across a spring-forward DST boundary", () => {
        // New York moves EST -> EDT at 02:00 on 2026-03-08. The next 09:00 local
        // run is therefore 13:00Z, not the 14:00Z a naive +24h would produce.
        const next = calculateNextDailyRun({
            time: "09:00",
            timezone: "America/New_York",
            after: new Date("2026-03-07T15:00:00Z"),
        });

        expect(iso(next)).toBe("2026-03-08T13:00:00.000Z");
    });

    it("handles timezones offset by a fraction of an hour", () => {
        // Asia/Kolkata is UTC+05:30 year round.
        const next = calculateNextDailyRun({
            time: "09:00",
            timezone: "Asia/Kolkata",
            after: new Date("2026-03-05T00:00:00Z"),
        });

        expect(iso(next)).toBe("2026-03-05T03:30:00.000Z");
    });

    it("treats a slot exactly equal to `after` as already passed", () => {
        // The comparison is `<=`, so the boundary rolls forward rather than
        // scheduling a run for the current instant.
        const next = calculateNextDailyRun({
            time: "09:00",
            timezone: "America/New_York",
            after: new Date("2026-03-05T14:00:00Z"),
        });

        expect(iso(next)).toBe("2026-03-06T14:00:00.000Z");
    });
});
