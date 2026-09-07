/**
 * The agent's hands: the OpenAI Agents `Computer` over a Browserbase session,
 * with the control lease checked before every single action.
 *
 * The gate is what makes Pause, Take control and Return mean something. The
 * worker does not learn about a handover by being told; it learns by being
 * refused at the database, in the same statement that reads the lease. When
 * refused it waits, and when its control comes back under a new generation it
 * restores the viewport, takes a fresh screenshot, drops the action it was
 * about to perform, and lets the model look again before doing anything.
 */
import type { Computer } from "@openai/agents";

type Button = Parameters<Computer["click"]>[2];
import { recordEventWithRetry } from "./activity";
import { authorizeInput, type AuthorizeResult } from "./control";
import * as driver from "./driver";
import { AGENT_VIEWPORT, mapKey, type Modifier } from "./input-mapping";
import { storeArtifact } from "./storage";

export class RunCancelledError extends Error {
    constructor() {
        super("Run was cancelled");
        this.name = "RunCancelledError";
    }
}

export class HandoverTimeoutError extends Error {
    constructor(waitedMs: number) {
        super(`Control did not return to the agent within ${Math.round(waitedMs / 1000)}s`);
        this.name = "HandoverTimeoutError";
    }
}

/** How long the agent waits for control to come back before the run fails. */
export const MAX_HANDOVER_WAIT_MS = 15 * 60 * 1000;
const HANDOVER_POLL_MS = 1000;

export type ComputerDeps = {
    authorize: (generation: number) => Promise<AuthorizeResult>;
    /** Returns the agent's fresh generation once control is back, or null if not yet. */
    currentAgentGeneration: () => Promise<number | null>;
    isCancelled: () => Promise<boolean>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
};

export type ComputerParams = {
    browserbaseSessionId: string;
    browserRunId: string;
    userEmail: string;
    agentId: string;
    sessionRecordId: string;
    workerId: string;
    generation: number;
};

/**
 * Keys the model sends arrive as names like "ctrl", "CTRL+A" or "Return".
 * Normalised to the same vocabulary the human path uses, so both are bound
 * by one whitelist.
 */
export function normaliseModelKeys(keys: string[]): string | null {
    const aliases: Record<string, string> = {
        ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", meta: "Meta",
        super: "Meta", win: "Meta", alt: "Alt", option: "Alt", shift: "Shift",
        return: "Enter", enter: "Enter", esc: "Escape", escape: "Escape",
        backspace: "Backspace", delete: "Delete", del: "Delete", tab: "Tab",
        space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
        arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
        home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
    };

    const flat = keys.flatMap(k => k.split("+")).map(k => k.trim()).filter(Boolean);
    if (flat.length === 0) return null;

    const modifiers: Modifier[] = [];
    let main: string | null = null;

    for (const raw of flat) {
        const lower = raw.toLowerCase();
        const mapped = aliases[lower] ?? (lower.length === 1 ? raw : (/^f\d{1,2}$/.test(lower) ? lower.toUpperCase() : raw));
        if (["Control", "Shift", "Alt", "Meta"].includes(mapped)) {
            if (!modifiers.includes(mapped as Modifier)) modifiers.push(mapped as Modifier);
        } else {
            if (main !== null) return null;
            main = mapped;
        }
    }

    if (main === null) return null;
    return mapKey(main, modifiers);
}

export class BrowserbaseComputer implements Computer {
    readonly environment = "browser" as const;
    readonly dimensions: [number, number] = [AGENT_VIEWPORT.width, AGENT_VIEWPORT.height];

    /** The fencing generation this worker currently acts under. */
    generation: number;

    /** True after a handover, until the model has seen a fresh screenshot. */
    private needsFreshLook = false;

    constructor(private readonly params: ComputerParams, private readonly deps: ComputerDeps) {
        this.generation = params.generation;
    }

    private get sessionId() {
        return this.params.browserbaseSessionId;
    }

    private async event(kind: Parameters<typeof recordEventWithRetry>[0]["kind"], detail?: Record<string, unknown>) {
        await recordEventWithRetry({
            browserRunId: this.params.browserRunId,
            userEmail: this.params.userEmail,
            browserSessionId: this.params.sessionRecordId,
            kind,
            actor: "agent",
            actorId: this.params.workerId,
            detail,
        });
    }

    /**
     * Returns true when the action may proceed under the current generation.
     * Returns false when control changed hands while waiting: the action the
     * model proposed is stale and must not run. Throws only for cancellation
     * and for a handover that never completed.
     */
    async gate(): Promise<boolean> {
        if (await this.deps.isCancelled()) throw new RunCancelledError();

        const first = await this.deps.authorize(this.generation);
        if (first.allowed) return true;

        const startedAt = this.deps.now();
        await this.event("warning", { reason: "agent_input_refused", cause: first.reason, generation: this.generation });

        while (this.deps.now() - startedAt < MAX_HANDOVER_WAIT_MS) {
            if (await this.deps.isCancelled()) throw new RunCancelledError();

            const fresh = await this.deps.currentAgentGeneration();
            if (fresh !== null && fresh !== this.generation) {
                await this.adopt(fresh);
                return false;
            }

            await this.deps.sleep(HANDOVER_POLL_MS);
        }

        throw new HandoverTimeoutError(this.deps.now() - startedAt);
    }

    /** Control is back under a new generation: refresh, look again, forget the old plan. */
    private async adopt(generation: number) {
        const previous = this.generation;
        this.generation = generation;
        this.needsFreshLook = true;

        await driver.setViewport(this.sessionId, AGENT_VIEWPORT).catch(() => undefined);

        await this.event("warning", {
            reason: "stale_action_invalidated",
            previousGeneration: previous,
            generation,
        });

        const location = await driver.currentLocation(this.sessionId).catch(() => null);
        if (location) {
            await this.event("navigation", { url: location.url, title: location.title, tabCount: location.tabCount, refreshed: true });
        }
    }

    async screenshot(): Promise<string> {
        // A screenshot is a read, but it still must not be taken by a worker
        // that has been fenced out: a paused agent should not keep looking.
        const allowed = await this.gate();
        void allowed;

        const { png, url, title } = await driver.capturePng(this.sessionId);
        this.needsFreshLook = false;

        const artifact = await storeArtifact({
            browserRunId: this.params.browserRunId,
            userEmail: this.params.userEmail,
            agentId: this.params.agentId,
            browserSessionId: this.params.sessionRecordId,
            source: "screenshot",
            filename: `screenshot-${Date.now()}.png`,
            mimeType: "image/png",
            bytes: png,
        }).catch(() => null);

        await this.event("screenshot", {
            artifactId: artifact?.id ?? null,
            url,
            title,
            generation: this.generation,
        });

        return png.toString("base64");
    }

    private async act(detail: Record<string, unknown>, perform: () => Promise<void>): Promise<void> {
        if (!(await this.gate())) return;
        if (this.needsFreshLook) {
            // Control came back on an earlier gate; this action was proposed
            // against a page the model has not seen since. Refuse it too.
            await this.event("warning", { reason: "action_before_fresh_look", generation: this.generation });
            return;
        }

        await this.event("action_proposed", { ...detail, generation: this.generation });
        await perform();
        await this.event("action_executed", { ...detail, generation: this.generation });
    }

    async click(x: number, y: number, button: Button): Promise<void> {
        const mapped: "left" | "right" | "middle" = button === "right" ? "right" : button === "wheel" ? "middle" : "left";
        await this.act({ type: "click", x, y, button: mapped }, () =>
            driver.dispatchAction(this.sessionId, { type: "click", x, y, button: mapped, clickCount: 1 }));
    }

    async doubleClick(x: number, y: number): Promise<void> {
        await this.act({ type: "double_click", x, y }, () =>
            driver.dispatchAction(this.sessionId, { type: "click", x, y, button: "left", clickCount: 2 }));
    }

    async scroll(x: number, y: number, scrollX: number, scrollY: number): Promise<void> {
        await this.act({ type: "scroll", x, y, deltaX: scrollX, deltaY: scrollY }, () =>
            driver.dispatchAction(this.sessionId, { type: "scroll", x, y, deltaX: scrollX, deltaY: scrollY }));
    }

    async type(text: string): Promise<void> {
        // Only the length is recorded. What was typed may be a password.
        await this.act({ type: "type", length: text.length }, () =>
            driver.dispatchAction(this.sessionId, { type: "text", text }));
    }

    async wait(): Promise<void> {
        if (!(await this.gate())) return;
        await this.deps.sleep(1000);
    }

    async move(x: number, y: number): Promise<void> {
        await this.act({ type: "move", x, y }, () =>
            driver.dispatchAction(this.sessionId, { type: "move", x, y }));
    }

    async keypress(keys: string[]): Promise<void> {
        const combination = normaliseModelKeys(keys);
        if (!combination) {
            await this.event("warning", { reason: "unknown_keypress", count: keys.length });
            return;
        }
        // Names of keys, not text: a combination like Control+a is not content.
        await this.act({ type: "keypress", combination }, () =>
            driver.dispatchAction(this.sessionId, { type: "key", combination }));
    }

    async drag(path: [number, number][]): Promise<void> {
        const points = path.map(([x, y]) => ({ x, y }));
        if (points.length < 2) return;
        await this.act({ type: "drag", points: points.length }, () =>
            driver.dispatchAction(this.sessionId, { type: "drag", path: points }));
    }
}

/** The production dependencies: the lease in Postgres, real time, real sleep. */
export function productionComputerDeps(params: {
    browserRunId: string;
    userEmail: string;
    workerId: string;
    isCancelled: () => Promise<boolean>;
    currentAgentGeneration: () => Promise<number | null>;
}): ComputerDeps {
    return {
        authorize: generation => authorizeInput({
            browserRunId: params.browserRunId,
            userEmail: params.userEmail,
            holderKind: "agent",
            holderId: params.workerId,
            generation,
        }),
        currentAgentGeneration: params.currentAgentGeneration,
        isCancelled: params.isCancelled,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        now: () => Date.now(),
    };
}
