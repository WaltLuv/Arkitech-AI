/**
 * Translating what a person did on their screen into what the browser should
 * receive. Pure functions, so every rule here is testable without a browser.
 *
 * The client renders a scaled screenshot and reports where, in that rendered
 * image, the pointer went. Nothing the client says about coordinates is
 * trusted beyond arithmetic: a point outside the rendered image, a scroll of
 * absurd size, or a key name the browser does not know is refused rather than
 * clamped into something plausible.
 */

export type Viewport = { width: number; height: number };

/** The size, in CSS pixels, at which the client displayed the frame. */
export type RenderedBox = { width: number; height: number };

export type Point = { x: number; y: number };

export type MouseButton = "left" | "right" | "middle";

export type Modifier = "Control" | "Shift" | "Alt" | "Meta";

/** What a client may ask the browser to do. Every variant is validated. */
export type ClientAction =
    | { type: "click"; x: number; y: number; button?: MouseButton; clickCount?: 1 | 2 }
    | { type: "move"; x: number; y: number }
    | { type: "drag"; path: Point[] }
    | { type: "scroll"; x: number; y: number; deltaX: number; deltaY: number }
    | { type: "key"; key: string; modifiers?: Modifier[] }
    | { type: "text"; text: string }
    | { type: "resize"; width: number; height: number };

/** The same actions with coordinates in browser viewport pixels. */
export type BrowserAction =
    | { type: "click"; x: number; y: number; button: MouseButton; clickCount: 1 | 2 }
    | { type: "move"; x: number; y: number }
    | { type: "drag"; path: Point[] }
    | { type: "scroll"; x: number; y: number; deltaX: number; deltaY: number }
    | { type: "key"; combination: string }
    | { type: "text"; text: string }
    | { type: "resize"; width: number; height: number };

export type MappingResult =
    | { ok: true; action: BrowserAction }
    | { ok: false; reason: string };

export const MAX_SCROLL_DELTA = 4000;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_DRAG_POINTS = 200;

export const MIN_VIEWPORT: Viewport = { width: 320, height: 480 };
export const MAX_VIEWPORT: Viewport = { width: 1920, height: 1200 };

/** The viewport the agent always works in. Restored after a takeover. */
export const AGENT_VIEWPORT: Viewport = { width: 1280, height: 800 };

const isFinitePositive = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;

const isFiniteNumber = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);

/**
 * Scales a point from the rendered image to the viewport.
 *
 * A point up to half a pixel outside the rendered box is tolerated, because a
 * touch on the very edge of a phone screen rounds that way. Anything further
 * out is refused: it cannot be an honest position on the image.
 */
export function mapPoint(point: Point, rendered: RenderedBox, viewport: Viewport): Point | null {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
    if (!isFinitePositive(rendered?.width) || !isFinitePositive(rendered?.height)) return null;
    if (!isFinitePositive(viewport?.width) || !isFinitePositive(viewport?.height)) return null;

    const tolerance = 0.5;
    if (point.x < -tolerance || point.y < -tolerance) return null;
    if (point.x > rendered.width + tolerance || point.y > rendered.height + tolerance) return null;

    const scaleX = viewport.width / rendered.width;
    const scaleY = viewport.height / rendered.height;

    const x = Math.min(viewport.width - 1, Math.max(0, Math.round(point.x * scaleX)));
    const y = Math.min(viewport.height - 1, Math.max(0, Math.round(point.y * scaleY)));

    return { x, y };
}

/** Scroll distance scales like position, and is capped so a bug cannot fling a page. */
export function mapScrollDelta(delta: number, renderedSize: number, viewportSize: number): number | null {
    if (!isFiniteNumber(delta)) return null;
    if (!isFinitePositive(renderedSize) || !isFinitePositive(viewportSize)) return null;

    const scaled = Math.round(delta * (viewportSize / renderedSize));
    return Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, scaled));
}

/**
 * Keys the browser accepts, by the names a KeyboardEvent reports. Single
 * printable characters are also accepted. Anything else is refused: an
 * unknown key name is far more likely to be a bug or an injection than a key.
 */
const NAMED_KEYS = new Set([
    "Enter", "Tab", "Backspace", "Delete", "Escape", "Space",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Home", "End", "PageUp", "PageDown", "Insert",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);

const MODIFIERS: Modifier[] = ["Control", "Shift", "Alt", "Meta"];

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/**
 * Builds a Playwright-style key combination such as `Control+a` or `Enter`.
 * A modifier on its own is not a keypress and is refused.
 */
export function mapKey(key: string, modifiers: Modifier[] = []): string | null {
    if (typeof key !== "string" || key.length === 0) return null;
    if (!Array.isArray(modifiers)) return null;

    const recognised = MODIFIERS.filter(m => modifiers.includes(m));
    if (recognised.length !== modifiers.length) return null;

    let name: string;
    if (key === " ") name = "Space";
    else if (NAMED_KEYS.has(key)) name = key;
    else if ([...key].length === 1 && !CONTROL_CHARACTER.test(key)) name = key;
    else return null;

    return [...recognised, name].join("+");
}

/**
 * Text for a soft keyboard's `input` event. Control characters other than a
 * newline or tab are removed; a form field has no use for them and they are
 * how terminal-style injection travels.
 */
export function sanitiseText(text: string): string | null {
    if (typeof text !== "string") return null;
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return null;

    const cleaned = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
    return cleaned.length === 0 ? null : cleaned;
}

/**
 * A phone rotating or a window resizing may change the viewport, within the
 * bounds a real browser session can render. Beyond them the request is
 * clamped, not refused: a phone is a legitimate shape for a page.
 */
export function clampViewport(requested: Viewport): Viewport | null {
    if (!requested || !isFinitePositive(requested.width) || !isFinitePositive(requested.height)) return null;

    const width = Math.round(Math.max(MIN_VIEWPORT.width, Math.min(MAX_VIEWPORT.width, requested.width)));
    const height = Math.round(Math.max(MIN_VIEWPORT.height, Math.min(MAX_VIEWPORT.height, requested.height)));

    return { width, height };
}

export type TouchGesture =
    | { type: "tap"; x: number; y: number }
    | { type: "pan"; x: number; y: number; deltaX: number; deltaY: number }
    | { type: "long_press"; x: number; y: number };

export const TAP_SLOP_PX = 10;
export const LONG_PRESS_MS = 500;

/**
 * Decides what a touch was, from where it started and ended and how long it
 * lasted. A tap is a click; a pan scrolls the page under the finger, which is
 * why its delta is inverted: dragging a finger up moves the content up, and
 * that is a positive scroll; a long press is a context click.
 */
export function classifyTouch(start: Point, end: Point, durationMs: number): TouchGesture | null {
    if (!start || !isFiniteNumber(start.x) || !isFiniteNumber(start.y)) return null;
    if (!end || !isFiniteNumber(end.x) || !isFiniteNumber(end.y)) return null;
    if (!isFiniteNumber(durationMs) || durationMs < 0) return null;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const moved = Math.hypot(dx, dy) > TAP_SLOP_PX;

    if (moved) return { type: "pan", x: start.x, y: start.y, deltaX: -dx, deltaY: -dy };
    if (durationMs >= LONG_PRESS_MS) return { type: "long_press", x: start.x, y: start.y };
    return { type: "tap", x: start.x, y: start.y };
}

/** A touch gesture expressed as the action the client would send for it. */
export function touchGestureToAction(gesture: TouchGesture): ClientAction {
    switch (gesture.type) {
        case "tap":
            return { type: "click", x: gesture.x, y: gesture.y, button: "left", clickCount: 1 };
        case "long_press":
            return { type: "click", x: gesture.x, y: gesture.y, button: "right", clickCount: 1 };
        case "pan":
            return {
                type: "scroll",
                x: gesture.x, y: gesture.y,
                deltaX: gesture.deltaX, deltaY: gesture.deltaY,
            };
    }
}

/**
 * Maps a whole client action into browser space, refusing anything malformed.
 * This is the only path input takes to the browser, so every variant is
 * validated here rather than in the route.
 */
export function mapClientAction(
    action: ClientAction,
    rendered: RenderedBox,
    viewport: Viewport,
): MappingResult {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return { ok: false, reason: "action is not an object with a type" };
    }

    switch (action.type) {
        case "click": {
            const point = mapPoint(action, rendered, viewport);
            if (!point) return { ok: false, reason: "click outside the rendered frame" };

            const button = action.button ?? "left";
            if (!["left", "right", "middle"].includes(button)) {
                return { ok: false, reason: "unknown mouse button" };
            }
            const clickCount = action.clickCount ?? 1;
            if (clickCount !== 1 && clickCount !== 2) {
                return { ok: false, reason: "clickCount must be 1 or 2" };
            }

            return { ok: true, action: { type: "click", ...point, button, clickCount } };
        }

        case "move": {
            const point = mapPoint(action, rendered, viewport);
            if (!point) return { ok: false, reason: "move outside the rendered frame" };
            return { ok: true, action: { type: "move", ...point } };
        }

        case "drag": {
            if (!Array.isArray(action.path) || action.path.length < 2) {
                return { ok: false, reason: "drag needs at least two points" };
            }
            if (action.path.length > MAX_DRAG_POINTS) {
                return { ok: false, reason: "drag path too long" };
            }
            const path: Point[] = [];
            for (const raw of action.path) {
                const point = mapPoint(raw, rendered, viewport);
                if (!point) return { ok: false, reason: "drag point outside the rendered frame" };
                path.push(point);
            }
            return { ok: true, action: { type: "drag", path } };
        }

        case "scroll": {
            const point = mapPoint(action, rendered, viewport);
            if (!point) return { ok: false, reason: "scroll origin outside the rendered frame" };

            const deltaX = mapScrollDelta(action.deltaX, rendered.width, viewport.width);
            const deltaY = mapScrollDelta(action.deltaY, rendered.height, viewport.height);
            if (deltaX === null || deltaY === null) {
                return { ok: false, reason: "scroll delta is not a number" };
            }

            return { ok: true, action: { type: "scroll", ...point, deltaX, deltaY } };
        }

        case "key": {
            const combination = mapKey(action.key, action.modifiers ?? []);
            if (!combination) return { ok: false, reason: "unknown key" };
            return { ok: true, action: { type: "key", combination } };
        }

        case "text": {
            const text = sanitiseText(action.text);
            if (!text) return { ok: false, reason: "text is empty, too long, or not text" };
            return { ok: true, action: { type: "text", text } };
        }

        case "resize": {
            const size = clampViewport(action);
            if (!size) return { ok: false, reason: "resize needs positive dimensions" };
            return { ok: true, action: { type: "resize", ...size } };
        }

        default:
            return { ok: false, reason: `unknown action type ${(action as { type: string }).type}` };
    }
}
