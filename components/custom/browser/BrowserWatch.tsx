"use client"

/**
 * The mediated browser view.
 *
 * What the client receives is a stream of JPEG frames from the server and the
 * run's state. What it sends is validated actions to the input route, each
 * carrying the channel and generation it was granted. There is no provider
 * URL anywhere in this component, and nothing to extract from the DOM that
 * would drive the browser: every click still has to pass the lease check on
 * the server.
 */
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    classifyTouch,
    touchGestureToAction,
    type ClientAction,
    type Modifier,
} from "@/lib/browserbase/input-mapping"
import axios from "axios"
import { Eye, Hand, Loader2, OctagonX, Pause, Play, RotateCcw, Smartphone } from "lucide-react"
import moment from "moment"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Controller = { kind: "agent" | "human" | "none"; generation: number; expiresAt: string | null }

type RunView = {
    id: string
    agentName: string | null
    task: string
    status: string
    priority: string
    queuePosition: number | null
    controller: Controller
    cancelRequested: boolean
    failureReason: string | null
    result: string | null
    session: { status: string; releaseState: string } | null
    site: { url: string; title: string } | null
}

type ActivityEvent = { sequence: number; kind: string; actor: string; detail: Record<string, unknown> | null; createdAt: string }

type Artifact = {
    id: string
    source: string
    filename: string | null
    mimeType: string | null
    sizeBytes: number | null
    verificationState: string
    createdAt: string
}

type HumanLease = { channelId: string; generation: number }

const STATE_POLL_MS = 2000
const FRAME_POLL_MS = 900
const LIVE_SESSION = new Set(["pending", "running"])

function statusBadge(status: string) {
    const tone =
        status === "completed" ? "bg-green-100 text-green-700" :
        status === "failed" ? "bg-red-100 text-red-700" :
        status === "cancelled" ? "bg-slate-200 text-slate-700" :
        status === "queued" ? "bg-slate-100 text-slate-700" :
        "bg-yellow-100 text-yellow-700"
    return <Badge className={tone}>{status}</Badge>
}

function controllerLabel(controller: Controller, mine: boolean) {
    if (controller.kind === "agent") return "Agent"
    if (controller.kind === "human") return mine ? "You" : "A person (another tab)"
    return "Nobody (paused)"
}

export function BrowserWatch({ browserRunId }: { browserRunId: string }) {
    const [run, setRun] = useState<RunView | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [frameUrl, setFrameUrl] = useState<string | null>(null)
    const [frameMeta, setFrameMeta] = useState<{ url: string; title: string; viewport: { width: number; height: number }; tabs: number } | null>(null)
    const [frameProblem, setFrameProblem] = useState<string | null>(null)
    const [lease, setLease] = useState<HumanLease | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [events, setEvents] = useState<ActivityEvent[]>([])
    const [artifacts, setArtifacts] = useState<Artifact[]>([])

    const imgRef = useRef<HTMLImageElement>(null)
    const keyboardRef = useRef<HTMLTextAreaElement>(null)
    const touchStart = useRef<{ x: number; y: number; at: number } | null>(null)
    const lastSequence = useRef(0)

    const isLive = Boolean(run?.session && LIVE_SESSION.has(run.session.status))
    const inControl = Boolean(lease && run?.controller.kind === "human" && run.controller.generation === lease.generation)

    // A lease this tab held that the server no longer recognises is gone for
    // good: the generation moved, so the channel cannot get input through.
    useEffect(() => {
        if (lease && run && (run.controller.kind !== "human" || run.controller.generation !== lease.generation)) {
            setLease(null)
            setNotice("Control has moved on; this tab no longer has input.")
        }
    }, [run, lease])

    const loadState = useCallback(async () => {
        try {
            const result = await axios.get<RunView>(`/api/browser/runs/${browserRunId}`)
            setRun(result.data)
            setLoadError(null)
        } catch (error) {
            setLoadError(axios.isAxiosError(error) && error.response?.status === 404 ? "This run does not exist." : "Could not load the run.")
        }
    }, [browserRunId])

    const loadActivity = useCallback(async () => {
        try {
            const result = await axios.get<{ events: ActivityEvent[] }>(`/api/browser/runs/${browserRunId}/events`, { params: { after: lastSequence.current } })
            if (result.data.events.length > 0) {
                lastSequence.current = result.data.events[result.data.events.length - 1].sequence
                setEvents(prev => [...prev, ...result.data.events])
            }
        } catch {
            // Activity is a view; a failed refresh is retried on the next tick.
        }
    }, [browserRunId])

    const loadArtifacts = useCallback(async () => {
        try {
            const result = await axios.get<{ artifacts: Artifact[] }>(`/api/browser/runs/${browserRunId}/artifacts`)
            setArtifacts(result.data.artifacts)
        } catch {
            // Same as activity.
        }
    }, [browserRunId])

    useEffect(() => {
        loadState(); loadActivity(); loadArtifacts()
        const timer = setInterval(() => { loadState(); loadActivity(); loadArtifacts() }, STATE_POLL_MS)
        return () => clearInterval(timer)
    }, [loadState, loadActivity, loadArtifacts])

    // Frames: fetched as blobs so the page never holds a URL to the browser,
    // only pixels it was handed.
    useEffect(() => {
        if (!isLive) { setFrameUrl(null); return }
        let cancelled = false
        let previous: string | null = null

        const tick = async () => {
            try {
                const response = await fetch(`/api/browser/runs/${browserRunId}/frame`, { cache: "no-store" })
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}))
                    if (!cancelled) setFrameProblem(body.error ?? `Frame unavailable (${response.status})`)
                    return
                }
                const blob = await response.blob()
                const next = URL.createObjectURL(blob)
                if (cancelled) { URL.revokeObjectURL(next); return }
                if (previous) URL.revokeObjectURL(previous)
                previous = next
                setFrameUrl(next)
                setFrameProblem(null)
                setFrameMeta({
                    url: decodeURIComponent(response.headers.get("X-Page-Url") ?? ""),
                    title: decodeURIComponent(response.headers.get("X-Page-Title") ?? ""),
                    viewport: {
                        width: Number(response.headers.get("X-Viewport-Width") ?? 0),
                        height: Number(response.headers.get("X-Viewport-Height") ?? 0),
                    },
                    tabs: Number(response.headers.get("X-Tab-Count") ?? 1),
                })
            } catch {
                if (!cancelled) setFrameProblem("Frame unavailable")
            }
        }

        tick()
        const timer = setInterval(tick, FRAME_POLL_MS)
        return () => {
            cancelled = true
            clearInterval(timer)
            if (previous) URL.revokeObjectURL(previous)
        }
    }, [browserRunId, isLive])

    const control = async (action: "pause" | "resume" | "take" | "return" | "stop") => {
        if (!run) return
        setBusy(action)
        setNotice(null)
        try {
            const result = await axios.post(`/api/browser/runs/${browserRunId}/control`, {
                action,
                expectedGeneration: run.controller.generation,
            })
            if (action === "take" && result.data.channelId) {
                setLease({ channelId: result.data.channelId, generation: result.data.generation })
                setTimeout(() => keyboardRef.current?.focus(), 0)
            } else {
                setLease(null)
            }
            await loadState()
        } catch (error) {
            const message = axios.isAxiosError(error) ? error.response?.data?.error ?? error.message : "Request failed"
            setNotice(message)
            await loadState()
        } finally {
            setBusy(null)
        }
    }

    const sendInput = useCallback(async (action: ClientAction) => {
        if (!lease || !imgRef.current) return
        const rect = imgRef.current.getBoundingClientRect()
        try {
            await axios.post(`/api/browser/runs/${browserRunId}/input`, {
                channelId: lease.channelId,
                generation: lease.generation,
                rendered: { width: rect.width, height: rect.height },
                action,
            })
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 403) {
                setLease(null)
                setNotice(`Input refused: ${error.response.data?.reason ?? "not in control"}.`)
                await loadState()
            } else if (axios.isAxiosError(error)) {
                setNotice(error.response?.data?.error ?? "Input failed.")
            }
        }
    }, [browserRunId, lease, loadState])

    const pointOf = (event: { clientX: number; clientY: number }) => {
        const rect = imgRef.current!.getBoundingClientRect()
        return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const modifiersOf = (event: React.KeyboardEvent): Modifier[] => {
        const mods: Modifier[] = []
        if (event.ctrlKey) mods.push("Control")
        if (event.shiftKey) mods.push("Shift")
        if (event.altKey) mods.push("Alt")
        if (event.metaKey) mods.push("Meta")
        return mods
    }

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!inControl) return
        const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
        // Printable characters arrive through the input event, which is also
        // how a phone's soft keyboard delivers them. Named keys and shortcuts
        // are sent here.
        if (printable) return
        event.preventDefault()
        sendInput({ type: "key", key: event.key, modifiers: modifiersOf(event) })
    }

    const onInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
        if (!inControl) return
        const value = event.currentTarget.value
        event.currentTarget.value = ""
        if (value) sendInput({ type: "text", text: value })
    }

    const fitToScreen = () => {
        const container = imgRef.current?.parentElement
        if (!container) return
        const width = Math.round(container.clientWidth)
        const height = Math.round(window.innerHeight * 0.6)
        sendInput({ type: "resize", width, height })
    }

    const sortedEvents = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events])

    if (loadError) return <p className="text-sm text-red-700">{loadError}</p>
    if (!run) return <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64 w-full" /></div>

    const canPause = run.controller.kind === "agent" && ["claimed", "running"].includes(run.status)
    const canResume = run.controller.kind === "none" && ["claimed", "running"].includes(run.status) && !run.cancelRequested
    const canTake = !inControl && ["claimed", "running"].includes(run.status) && !run.cancelRequested
    const canReturn = run.controller.kind !== "agent" && ["claimed", "running"].includes(run.status) && !run.cancelRequested
    const canStop = ["queued", "claimed", "running"].includes(run.status) && !run.cancelRequested

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold">{run.agentName ?? "Browser run"}</h1>
                    <p className="text-sm text-muted-foreground break-words">{run.task}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(run.status)}
                    {run.priority === "urgent" && <Badge className="bg-orange-100 text-orange-700">urgent</Badge>}
                    {run.queuePosition !== null && <Badge variant="outline">queue position {run.queuePosition}</Badge>}
                    {run.cancelRequested && run.status !== "cancelled" && <Badge variant="outline">stopping</Badge>}
                </div>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">Controller</div>
                    <div className="font-medium">{controllerLabel(run.controller, inControl)}</div>
                    <div className="text-xs text-muted-foreground">generation {run.controller.generation}</div>
                </div>
                <div className="rounded-lg border p-3 min-w-0">
                    <div className="text-muted-foreground">Site</div>
                    <div className="font-medium truncate">{frameMeta?.title || run.site?.title || "No page yet"}</div>
                    <div className="text-xs text-muted-foreground truncate">{frameMeta?.url || run.site?.url || ""}{frameMeta && frameMeta.tabs > 1 ? ` (${frameMeta.tabs} tabs)` : ""}</div>
                </div>
                <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">Browser session</div>
                    <div className="font-medium">{run.session ? run.session.status : "none"}</div>
                    {frameMeta && <div className="text-xs text-muted-foreground">{frameMeta.viewport.width} x {frameMeta.viewport.height}</div>}
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!canPause || busy !== null} onClick={() => control("pause")}>
                    {busy === "pause" ? <Loader2 className="animate-spin" /> : <Pause />} Pause agent
                </Button>
                <Button size="sm" variant="outline" disabled={!canResume || busy !== null} onClick={() => control("resume")}>
                    {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />} Resume agent
                </Button>
                <Button size="sm" disabled={!canTake || busy !== null} onClick={() => control("take")}>
                    {busy === "take" ? <Loader2 className="animate-spin" /> : <Hand />} Take control
                </Button>
                <Button size="sm" variant="outline" disabled={!canReturn || busy !== null} onClick={() => control("return")}>
                    {busy === "return" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Return to agent
                </Button>
                <Button size="sm" variant="destructive" disabled={!canStop || busy !== null} onClick={() => control("stop")}>
                    {busy === "stop" ? <Loader2 className="animate-spin" /> : <OctagonX />} Stop task
                </Button>
                {inControl && (
                    <Button size="sm" variant="ghost" onClick={fitToScreen} title="Resize the browser to fit this screen">
                        <Smartphone /> Fit to my screen
                    </Button>
                )}
            </div>

            {notice && <p className="text-sm text-amber-700">{notice}</p>}

            <div className={`relative rounded-xl border overflow-hidden bg-slate-950 ${inControl ? "ring-2 ring-blue-500" : ""}`}>
                {isLive && frameUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        ref={imgRef}
                        src={frameUrl}
                        alt="Live browser view"
                        draggable={false}
                        className={`block w-full h-auto select-none ${inControl ? "cursor-crosshair" : "cursor-default"}`}
                        style={{ touchAction: inControl ? "none" : "auto" }}
                        onClick={event => {
                            if (!inControl) return
                            keyboardRef.current?.focus()
                            sendInput({ type: "click", ...pointOf(event), button: "left", clickCount: event.detail >= 2 ? 2 : 1 })
                        }}
                        onContextMenu={event => {
                            if (!inControl) return
                            event.preventDefault()
                            sendInput({ type: "click", ...pointOf(event), button: "right", clickCount: 1 })
                        }}
                        onWheel={event => {
                            if (!inControl) return
                            event.preventDefault()
                            sendInput({ type: "scroll", ...pointOf(event), deltaX: event.deltaX, deltaY: event.deltaY })
                        }}
                        onTouchStart={event => {
                            if (!inControl || event.touches.length !== 1) return
                            const point = pointOf(event.touches[0])
                            touchStart.current = { ...point, at: Date.now() }
                        }}
                        onTouchEnd={event => {
                            if (!inControl || !touchStart.current) return
                            const touch = event.changedTouches[0]
                            const start = touchStart.current
                            touchStart.current = null
                            const gesture = classifyTouch(start, pointOf(touch), Date.now() - start.at)
                            if (gesture) {
                                keyboardRef.current?.focus()
                                sendInput(touchGestureToAction(gesture))
                            }
                        }}
                    />
                ) : (
                    <div className="flex h-64 items-center justify-center text-sm text-slate-300">
                        {run.status === "queued" ? "Waiting for a browser slot." :
                            run.status === "claimed" ? "Starting the browser." :
                            isLive ? (frameProblem ?? "Fetching the first frame.") :
                            run.status === "completed" ? "The browser has been released. Files and activity remain below." :
                            run.status === "failed" ? `Failed: ${run.failureReason ?? "unknown reason"}` :
                            run.status === "cancelled" ? "Stopped." :
                            "No live browser."}
                    </div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white">
                    {inControl ? <><Hand className="h-3 w-3" /> You are in control</> : <><Eye className="h-3 w-3" /> Watching</>}
                </div>
            </div>

            {/* Hidden keyboard target. Focused while in control so a phone's
                soft keyboard and a desktop keyboard both deliver here. */}
            <textarea
                ref={keyboardRef}
                aria-label="Keyboard input for the browser"
                className="h-px w-px opacity-0 absolute -left-[1000px]"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={onKeyDown}
                onInput={onInput}
                tabIndex={inControl ? 0 : -1}
            />
            {inControl && (
                <p className="text-xs text-muted-foreground">
                    Tap or click the page to act. Type to send text; Enter, Tab, arrows and shortcuts are forwarded.
                    Everything you do is checked against your control lease on the server.
                </p>
            )}

            {run.result && (
                <div className="rounded-lg border p-3 text-sm">
                    <div className="text-muted-foreground mb-1">Result</div>
                    <p className="whitespace-pre-wrap break-words">{run.result}</p>
                </div>
            )}

            <Tabs defaultValue="activity">
                <TabsList>
                    <TabsTrigger value="activity">Activity ({sortedEvents.length})</TabsTrigger>
                    <TabsTrigger value="files">Files ({artifacts.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="activity">
                    <ul className="divide-y rounded-lg border text-sm max-h-80 overflow-y-auto">
                        {sortedEvents.length === 0 && <li className="p-3 text-muted-foreground">Nothing yet.</li>}
                        {sortedEvents.map(event => (
                            <li key={event.sequence} className="flex flex-wrap items-baseline gap-2 p-2">
                                <span className="w-8 text-xs text-muted-foreground">#{event.sequence}</span>
                                <Badge variant="outline">{event.actor}</Badge>
                                <span className="font-medium">{event.kind}</span>
                                <span className="text-xs text-muted-foreground break-all">{summariseDetail(event.detail)}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{moment(event.createdAt).format("HH:mm:ss")}</span>
                            </li>
                        ))}
                    </ul>
                </TabsContent>
                <TabsContent value="files">
                    <ul className="divide-y rounded-lg border text-sm max-h-80 overflow-y-auto">
                        {artifacts.length === 0 && <li className="p-3 text-muted-foreground">No files yet.</li>}
                        {artifacts.map(artifact => (
                            <li key={artifact.id} className="flex flex-wrap items-center gap-2 p-2">
                                <Badge variant="outline">{artifact.source}</Badge>
                                {artifact.verificationState === "verified" ? (
                                    <a className="text-blue-700 underline break-all" href={`/api/browser/artifacts/${artifact.id}`} target="_blank" rel="noreferrer">
                                        {artifact.filename ?? artifact.id}
                                    </a>
                                ) : (
                                    <span className="break-all">{artifact.filename ?? artifact.id} <span className="text-muted-foreground">({artifact.verificationState})</span></span>
                                )}
                                <span className="text-xs text-muted-foreground">{artifact.sizeBytes != null ? `${Math.round(artifact.sizeBytes / 1024)} KB` : ""}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{moment(artifact.createdAt).format("HH:mm:ss")}</span>
                            </li>
                        ))}
                    </ul>
                </TabsContent>
            </Tabs>
        </div>
    )
}

function summariseDetail(detail: Record<string, unknown> | null): string {
    if (!detail) return ""
    return Object.entries(detail)
        .filter(([key]) => key !== "generation")
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ")
        .slice(0, 200)
}
