import { describe, expect, it } from "vitest";
import {
    AGENT_VIEWPORT,
    MAX_SCROLL_DELTA,
    MAX_TEXT_LENGTH,
    MAX_VIEWPORT,
    MIN_VIEWPORT,
    classifyTouch,
    clampViewport,
    mapClientAction,
    mapKey,
    mapPoint,
    mapScrollDelta,
    sanitiseText,
    touchGestureToAction,
} from "./input-mapping";

/**
 * Mobile and desktop control, as arithmetic. A phone shows the 1280x800 agent
 * viewport in a 360px-wide image; a tap at (180, 100) on that image must land
 * at (640, 356) in the browser. These tests are what "mobile control works"
 * means offline; dispatch over a live session is verified separately.
 */
const phone = { width: 360, height: 225 };
const desktop = { width: 1280, height: 800 };

describe("coordinate transformation", () => {
    it("scales a phone tap to the agent viewport", () => {
        expect(mapPoint({ x: 180, y: 112.5 }, phone, AGENT_VIEWPORT)).toEqual({ x: 640, y: 400 });
    });

    it("is the identity when rendered size equals the viewport", () => {
        expect(mapPoint({ x: 100, y: 50 }, desktop, AGENT_VIEWPORT)).toEqual({ x: 100, y: 50 });
    });

    it("keeps the far edge inside the viewport", () => {
        const point = mapPoint({ x: 360, y: 225 }, phone, AGENT_VIEWPORT);
        expect(point).toEqual({ x: 1279, y: 799 });
    });

    it("tolerates half a pixel of edge rounding", () => {
        expect(mapPoint({ x: -0.4, y: 0 }, phone, AGENT_VIEWPORT)).toEqual({ x: 0, y: 0 });
        expect(mapPoint({ x: 360.4, y: 0 }, phone, AGENT_VIEWPORT)).toEqual({ x: 1279, y: 0 });
    });

    it("refuses a point outside the rendered frame", () => {
        expect(mapPoint({ x: -5, y: 10 }, phone, AGENT_VIEWPORT)).toBeNull();
        expect(mapPoint({ x: 10, y: 400 }, phone, AGENT_VIEWPORT)).toBeNull();
    });

    it("refuses non-numeric or degenerate input", () => {
        expect(mapPoint({ x: NaN, y: 1 }, phone, AGENT_VIEWPORT)).toBeNull();
        expect(mapPoint({ x: 1, y: 1 }, { width: 0, height: 225 }, AGENT_VIEWPORT)).toBeNull();
        expect(mapPoint({ x: 1, y: 1 }, phone, { width: 1280, height: -1 })).toBeNull();
        expect(mapPoint(undefined as unknown as { x: number; y: number }, phone, AGENT_VIEWPORT)).toBeNull();
    });

    it("handles a portrait phone against a portrait viewport without distortion", () => {
        const portraitRender = { width: 390, height: 780 };
        const portraitViewport = { width: 780, height: 1560 };
        expect(mapPoint({ x: 195, y: 390 }, portraitRender, portraitViewport)).toEqual({ x: 390, y: 780 });
    });
});

describe("scrolling", () => {
    it("scales a finger pan by the same ratio as position", () => {
        // 360 rendered px maps to 1280 viewport px, so a 90px pan is 320px.
        expect(mapScrollDelta(90, phone.width, AGENT_VIEWPORT.width)).toBe(320);
        expect(mapScrollDelta(-90, phone.width, AGENT_VIEWPORT.width)).toBe(-320);
    });

    it("caps an absurd delta instead of flinging the page", () => {
        expect(mapScrollDelta(1e9, phone.width, AGENT_VIEWPORT.width)).toBe(MAX_SCROLL_DELTA);
        expect(mapScrollDelta(-1e9, phone.width, AGENT_VIEWPORT.width)).toBe(-MAX_SCROLL_DELTA);
    });

    it("refuses a non-numeric delta", () => {
        expect(mapScrollDelta(Infinity, phone.width, AGENT_VIEWPORT.width)).toBeNull();
        expect(mapScrollDelta("10" as unknown as number, phone.width, AGENT_VIEWPORT.width)).toBeNull();
    });
});

describe("touch and pointer behaviour", () => {
    it("treats a short still touch as a tap", () => {
        expect(classifyTouch({ x: 10, y: 10 }, { x: 12, y: 11 }, 120)).toEqual({ type: "tap", x: 10, y: 10 });
    });

    it("treats a long still touch as a long press", () => {
        expect(classifyTouch({ x: 10, y: 10 }, { x: 10, y: 10 }, 600)).toEqual({ type: "long_press", x: 10, y: 10 });
    });

    it("treats movement beyond the slop as a pan with inverted delta", () => {
        const gesture = classifyTouch({ x: 100, y: 200 }, { x: 100, y: 120 }, 300);
        expect(gesture).toEqual({ type: "pan", x: 100, y: 200, deltaX: -0, deltaY: 80 });
    });

    it("turns a tap into a left click, a long press into a right click, a pan into a scroll", () => {
        expect(touchGestureToAction({ type: "tap", x: 1, y: 2 }))
            .toEqual({ type: "click", x: 1, y: 2, button: "left", clickCount: 1 });
        expect(touchGestureToAction({ type: "long_press", x: 1, y: 2 }))
            .toEqual({ type: "click", x: 1, y: 2, button: "right", clickCount: 1 });
        expect(touchGestureToAction({ type: "pan", x: 1, y: 2, deltaX: 3, deltaY: 4 }))
            .toEqual({ type: "scroll", x: 1, y: 2, deltaX: 3, deltaY: 4 });
    });

    it("refuses a malformed touch", () => {
        expect(classifyTouch({ x: NaN, y: 0 }, { x: 0, y: 0 }, 10)).toBeNull();
        expect(classifyTouch({ x: 0, y: 0 }, { x: 0, y: 0 }, -1)).toBeNull();
    });
});

describe("keyboard forwarding", () => {
    it("passes named keys through", () => {
        expect(mapKey("Enter")).toBe("Enter");
        expect(mapKey("ArrowDown")).toBe("ArrowDown");
        expect(mapKey(" ")).toBe("Space");
    });

    it("passes single printable characters, including non-Latin ones", () => {
        expect(mapKey("a")).toBe("a");
        expect(mapKey("é")).toBe("é");
        expect(mapKey("日")).toBe("日");
    });

    it("builds modifier combinations in a stable order", () => {
        expect(mapKey("a", ["Control"])).toBe("Control+a");
        expect(mapKey("Tab", ["Shift", "Control"])).toBe("Control+Shift+Tab");
    });

    it("refuses unknown key names, control characters and bogus modifiers", () => {
        expect(mapKey("Bogus")).toBeNull();
        expect(mapKey("\u0007")).toBeNull();
        expect(mapKey("")).toBeNull();
        expect(mapKey("a", ["Hyper" as never])).toBeNull();
        expect(mapKey("a", "Control" as never)).toBeNull();
    });
});

describe("text entry", () => {
    it("passes ordinary text, newlines and tabs", () => {
        expect(sanitiseText("hello\tworld\n")).toBe("hello\tworld\n");
    });

    it("strips other control characters", () => {
        expect(sanitiseText("a\u0000b\u001bc")).toBe("abc");
    });

    it("refuses empty, oversized and non-string text", () => {
        expect(sanitiseText("")).toBeNull();
        expect(sanitiseText("\u0000")).toBeNull();
        expect(sanitiseText("x".repeat(MAX_TEXT_LENGTH + 1))).toBeNull();
        expect(sanitiseText(42 as unknown as string)).toBeNull();
    });
});

describe("viewport resize", () => {
    it("accepts a phone-shaped viewport", () => {
        expect(clampViewport({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
    });

    it("clamps to the supported range instead of refusing", () => {
        expect(clampViewport({ width: 100, height: 100 })).toEqual(MIN_VIEWPORT);
        expect(clampViewport({ width: 5000, height: 5000 })).toEqual(MAX_VIEWPORT);
    });

    it("refuses non-positive dimensions", () => {
        expect(clampViewport({ width: 0, height: 100 })).toBeNull();
        expect(clampViewport({ width: NaN, height: 100 })).toBeNull();
    });
});

describe("mapClientAction", () => {
    it("maps a phone click into the viewport with defaults filled", () => {
        const result = mapClientAction({ type: "click", x: 180, y: 112.5 }, phone, AGENT_VIEWPORT);
        expect(result).toEqual({
            ok: true,
            action: { type: "click", x: 640, y: 400, button: "left", clickCount: 1 },
        });
    });

    it("maps a drag path point by point and refuses one that leaves the frame", () => {
        const ok = mapClientAction(
            { type: "drag", path: [{ x: 0, y: 0 }, { x: 180, y: 112.5 }] }, phone, AGENT_VIEWPORT,
        );
        expect(ok).toEqual({ ok: true, action: { type: "drag", path: [{ x: 0, y: 0 }, { x: 640, y: 400 }] } });

        const bad = mapClientAction(
            { type: "drag", path: [{ x: 0, y: 0 }, { x: 900, y: 0 }] }, phone, AGENT_VIEWPORT,
        );
        expect(bad.ok).toBe(false);
    });

    it("maps a scroll origin and delta together", () => {
        const result = mapClientAction(
            { type: "scroll", x: 180, y: 112.5, deltaX: 0, deltaY: 90 }, phone, AGENT_VIEWPORT,
        );
        expect(result).toEqual({
            ok: true,
            action: { type: "scroll", x: 640, y: 400, deltaX: 0, deltaY: 320 },
        });
    });

    it("refuses shapes a real client would never send", () => {
        expect(mapClientAction({ type: "click", x: 1, y: 1, button: "laser" as never }, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "click", x: 1, y: 1, clickCount: 3 as never }, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "drag", path: [{ x: 1, y: 1 }] }, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "explode" } as never, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction(null as never, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "key", key: "Bogus" }, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "text", text: "" }, phone, AGENT_VIEWPORT).ok).toBe(false);
        expect(mapClientAction({ type: "resize", width: -1, height: 10 }, phone, AGENT_VIEWPORT).ok).toBe(false);
    });

    it("never lets a rendered size of zero produce a coordinate", () => {
        const result = mapClientAction({ type: "click", x: 0, y: 0 }, { width: 0, height: 0 }, AGENT_VIEWPORT);
        expect(result.ok).toBe(false);
    });
});
