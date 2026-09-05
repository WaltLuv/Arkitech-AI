import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "@/lib/api-error";

describe("getApiErrorMessage", () => {
    const fallback = "Unable to create agent";

    it("reads the message the API put on response.data.error", () => {
        const error = { response: { data: { error: "Agent is not active!" } } };

        expect(getApiErrorMessage(error, fallback)).toBe("Agent is not active!");
    });

    it.each([
        ["a network error with no response", new Error("Network Error")],
        ["a thrown string", "boom"],
        ["null", null],
        ["undefined", undefined],
        ["a response with no body", { response: {} }],
        ["a body with no error field", { response: { data: {} } }],
        ["a non-string error field", { response: { data: { error: { code: 500 } } } }],
        ["an empty error message", { response: { data: { error: "" } } }],
    ])("falls back for %s", (_label, error) => {
        expect(getApiErrorMessage(error, fallback)).toBe(fallback);
    });
});
