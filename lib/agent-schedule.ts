/**
 * Scheduling helper that converts a daily local time in a timezone into the next UTC run time.
 */
import {
    fromZonedTime,
    toZonedTime,
} from "date-fns-tz";

export function calculateNextDailyRun({
    time,
    timezone,
    after = new Date(),
}: {
    time: string;
    timezone: string;
    after?: Date;
}) {
    const [hour, minute] = time
        .split(":")
        .map(Number);

    // Compare in the user's local timezone so daily runs respect their clock.
    const localAfter = toZonedTime(
        after,
        timezone,
    );

    const localCandidate = new Date(localAfter);

    localCandidate.setHours(
        hour,
        minute,
        0,
        0,
    );

    let candidateUtc = fromZonedTime(
        localCandidate,
        timezone,
    );

    // If today's scheduled local time has passed, move to tomorrow's occurrence.
    if (candidateUtc <= after) {
        localCandidate.setDate(
            localCandidate.getDate() + 1,
        );

        candidateUtc = fromZonedTime(
            localCandidate,
            timezone,
        );
    }

    return candidateUtc;
}
