"use client"

/**
 * Connections: where someone attaches Telegram or Slack to their Arkitech team.
 *
 * Written for a person who has never heard of a webhook. The words on screen
 * are "connect", "talk to", "team member" and "disconnect". Nothing here shows
 * a chat id, an update id, a signing secret, a scope or a bot API method, and
 * the one technical thing a user genuinely has to supply, the Telegram bot
 * token, is asked for as "the token BotFather gave you" and never shown again.
 */

import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import { Check, Loader2, MessageSquare, Send, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"

type Provider = "telegram" | "slack"

type ConnectionView = {
    id: string
    provider: Provider
    state: "connected" | "finish_connecting" | "needs_attention" | "not_connected"
    accountLabel: string | null
    agentId: string | null
    attention: string | null
}

type TeamMember = {
    agentId: string
    name: string
    description?: string
}

const CHANNELS: { provider: Provider; name: string; blurb: string; icon: React.ReactNode }[] = [
    {
        provider: "telegram",
        name: "Telegram",
        blurb: "Talk to your Arkitech team from Telegram.",
        icon: <Send className="size-4 text-sky-700" />,
    },
    {
        provider: "slack",
        name: "Slack",
        blurb: "Talk to your Arkitech team from Slack.",
        icon: <MessageSquare className="size-4 text-violet-700" />,
    },
]

/** The four words a connection can be in, and how each reads. */
const STATE_LABEL: Record<ConnectionView["state"], string> = {
    connected: "Connected",
    finish_connecting: "Almost there",
    needs_attention: "Needs attention",
    not_connected: "Not connected",
}

export function Connections() {
    const [connections, setConnections] = useState<ConnectionView[]>([])
    const [team, setTeam] = useState<TeamMember[]>([])
    const [loading, setLoading] = useState(true)
    const [connecting, setConnecting] = useState<Provider | null>(null)
    const [telegramLink, setTelegramLink] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const [channels, agents] = await Promise.all([
                axios.get("/api/channels"),
                axios.get("/api/agent/configure"),
            ])

            setConnections(channels.data ?? [])
            setTeam(agents.data ?? [])
        } catch {
            toast.add({ type: "error", title: "Could not load your connections." })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    // Slack sends people back here after its own screen, so the outcome arrives
    // in the address bar rather than from a request this page made.
    useEffect(() => {
        const outcome = new URLSearchParams(window.location.search).get("slack")

        if (!outcome) return

        const messages: Record<string, { type: "success" | "error"; title: string }> = {
            connected: { type: "success", title: "Slack connected." },
            cancelled: { type: "error", title: "Slack setup was cancelled." },
            expired: { type: "error", title: "That Slack link expired. Please try again." },
            failed: { type: "error", title: "Slack could not be connected. Please try again." },
            already_connected: {
                type: "error",
                title: "That Slack workspace is already connected to another Arkitech account.",
            },
            unavailable: { type: "error", title: "Slack is not available on this Arkitech install yet." },
        }

        const message = messages[outcome]
        if (message) toast.add(message)

        window.history.replaceState({}, "", window.location.pathname)
    }, [])

    const connectionFor = (provider: Provider) =>
        connections.find(row => row.provider === provider && row.state !== "not_connected") ?? null

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading connections
            </div>
        )
    }

    return (
        <div className="divide-y rounded-2xl border bg-background">
            {CHANNELS.map(channel => (
                <ChannelRow
                    key={channel.provider}
                    channel={channel}
                    connection={connectionFor(channel.provider)}
                    team={team}
                    onConnect={() => setConnecting(channel.provider)}
                    onChanged={load}
                    onTelegramLink={setTelegramLink}
                />
            ))}

            <TelegramConnectDialog
                open={connecting === "telegram"}
                team={team}
                onOpenChange={open => setConnecting(open ? "telegram" : null)}
                onConnected={link => {
                    setTelegramLink(link)
                    setConnecting(null)
                    load()
                }}
            />

            <SlackConnectDialog
                open={connecting === "slack"}
                team={team}
                onOpenChange={open => setConnecting(open ? "slack" : null)}
            />

            <FinishInTelegramDialog link={telegramLink} onOpenChange={() => setTelegramLink(null)} />
        </div>
    )
}

function ChannelRow({
    channel,
    connection,
    team,
    onConnect,
    onChanged,
    onTelegramLink,
}: {
    channel: (typeof CHANNELS)[number]
    connection: ConnectionView | null
    team: TeamMember[]
    onConnect: () => void
    onChanged: () => void
    onTelegramLink: (link: string) => void
}) {
    const [busy, setBusy] = useState(false)

    const assigned = team.find(member => member.agentId === connection?.agentId)

    const changeTeamMember = async (agentId: string) => {
        if (!connection) return

        setBusy(true)
        try {
            await axios.patch(`/api/channels/${connection.id}`, { agentId })
            toast.add({ type: "success", title: "Team member updated." })
            onChanged()
        } catch {
            toast.add({ type: "error", title: "Could not change the team member." })
        } finally {
            setBusy(false)
        }
    }

    const disconnect = async () => {
        if (!connection) return

        setBusy(true)
        try {
            await axios.delete(`/api/channels/${connection.id}`)
            toast.add({ type: "success", title: `${channel.name} disconnected.` })
            onChanged()
        } catch {
            toast.add({ type: "error", title: `Could not disconnect ${channel.name}.` })
        } finally {
            setBusy(false)
        }
    }

    const resendLink = async () => {
        if (!connection) return

        setBusy(true)
        try {
            const result = await axios.post("/api/channels/telegram/link", {
                connectionId: connection.id,
            })

            if (result.data?.openInTelegram) {
                onTelegramLink(result.data.openInTelegram)
            }
        } catch {
            toast.add({ type: "error", title: "Could not create a new link." })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                        {channel.icon}
                    </div>

                    <div className="min-w-0">
                        <h3 className="font-medium">{channel.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{channel.blurb}</p>

                        {connection && (
                            <p className="mt-2 flex items-center gap-1.5 text-sm">
                                <StateMark state={connection.state} />
                                <span className="text-muted-foreground">
                                    {STATE_LABEL[connection.state]}
                                    {connection.accountLabel ? ` · ${connection.accountLabel}` : ""}
                                </span>
                            </p>
                        )}

                        {connection?.attention && (
                            <p className="mt-1 text-sm text-amber-700">{connection.attention}</p>
                        )}

                        {connection?.state === "finish_connecting" && (
                            <p className="mt-1 text-sm text-muted-foreground">
                                Open {channel.name} and send your bot a message to finish connecting.
                            </p>
                        )}
                    </div>
                </div>

                <div className="shrink-0">
                    {connection ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {channel.provider === "telegram" && (
                                <Button variant="outline" size="sm" onClick={resendLink} disabled={busy}>
                                    Open in Telegram
                                </Button>
                            )}

                            <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>
                                Disconnect
                            </Button>
                        </div>
                    ) : (
                        <Button size="sm" onClick={onConnect}>
                            Connect
                        </Button>
                    )}
                </div>
            </div>

            {connection && (
                <>
                    <Separator className="my-4" />

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <Label className="text-sm font-medium">Messages go to</Label>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {assigned
                                    ? `${assigned.name} answers everything sent here.`
                                    : "Choose who should answer messages from this connection."}
                            </p>
                        </div>

                        <NativeSelect
                            className="sm:w-64"
                            value={connection.agentId ?? ""}
                            disabled={busy}
                            onChange={event => changeTeamMember(event.target.value)}
                        >
                            <option value="" disabled>
                                Choose a team member
                            </option>
                            {team.map(member => (
                                <option key={member.agentId} value={member.agentId}>
                                    {member.name}
                                </option>
                            ))}
                        </NativeSelect>
                    </div>
                </>
            )}
        </div>
    )
}

/** Shape as well as colour, so the state reads without relying on either. */
function StateMark({ state }: { state: ConnectionView["state"] }) {
    if (state === "connected") return <Check className="size-3.5 text-emerald-600" />
    if (state === "needs_attention") return <TriangleAlert className="size-3.5 text-amber-600" />
    return <span className="size-2 rounded-full border border-muted-foreground/60" />
}

function TelegramConnectDialog({
    open,
    team,
    onOpenChange,
    onConnected,
}: {
    open: boolean
    team: TeamMember[]
    onOpenChange: (open: boolean) => void
    onConnected: (link: string | null) => void
}) {
    const [token, setToken] = useState("")
    const [agentId, setAgentId] = useState("")
    const [saving, setSaving] = useState(false)

    const submit = async () => {
        setSaving(true)
        try {
            const result = await axios.post("/api/channels/telegram/connect", {
                botToken: token,
                agentId,
            })

            setToken("")
            toast.add({ type: "success", title: "Telegram bot verified." })
            onConnected(result.data?.openInTelegram ?? null)
        } catch (error: unknown) {
            const message =
                (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
                "Could not connect Telegram."

            toast.add({ type: "error", title: message })
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect Telegram</DialogTitle>
                    <DialogDescription>
                        You need a Telegram bot. It takes about a minute to make one.
                    </DialogDescription>
                </DialogHeader>

                <ol className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <li>1. Open Telegram and search for @BotFather.</li>
                    <li>2. Send it /newbot and follow the prompts.</li>
                    <li>3. Copy the token it gives you.</li>
                    <li>4. Paste it below.</li>
                </ol>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="telegram-token">Bot token</Label>
                        <Input
                            id="telegram-token"
                            type="password"
                            autoComplete="off"
                            placeholder="Paste the token from BotFather"
                            value={token}
                            onChange={event => setToken(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Stored securely and never shown again.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="telegram-agent">Who should answer?</Label>
                        <NativeSelect
                            id="telegram-agent"
                            value={agentId}
                            onChange={event => setAgentId(event.target.value)}
                        >
                            <option value="" disabled>
                                Choose a team member
                            </option>
                            {team.map(member => (
                                <option key={member.agentId} value={member.agentId}>
                                    {member.name}
                                </option>
                            ))}
                        </NativeSelect>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={saving || !token.trim() || !agentId}>
                        {saving && <Loader2 className="size-4 animate-spin" />}
                        Connect Telegram
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function SlackConnectDialog({
    open,
    team,
    onOpenChange,
}: {
    open: boolean
    team: TeamMember[]
    onOpenChange: (open: boolean) => void
}) {
    const [agentId, setAgentId] = useState("")

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect Slack</DialogTitle>
                    <DialogDescription>
                        Choose who should answer, then approve Arkitech in Slack.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5">
                    <Label htmlFor="slack-agent">Who should answer?</Label>
                    <NativeSelect
                        id="slack-agent"
                        value={agentId}
                        onChange={event => setAgentId(event.target.value)}
                    >
                        <option value="" disabled>
                            Choose a team member
                        </option>
                        {team.map(member => (
                            <option key={member.agentId} value={member.agentId}>
                                {member.name}
                            </option>
                        ))}
                    </NativeSelect>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!agentId}
                        onClick={() => {
                            window.location.href = `/api/channels/slack/install?agentId=${encodeURIComponent(agentId)}`
                        }}
                    >
                        Continue to Slack
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * The last step, and the one people get stuck on: a bot cannot start a
 * conversation, so the person has to send the first message. The link carries
 * the one-time code, so all they do is tap it and press start.
 */
function FinishInTelegramDialog({
    link,
    onOpenChange,
}: {
    link: string | null
    onOpenChange: (open: boolean) => void
}) {
    return (
        <Dialog open={Boolean(link)} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>One last step</DialogTitle>
                    <DialogDescription>
                        Open your bot in Telegram and press Start. That is what connects it to your
                        team.
                    </DialogDescription>
                </DialogHeader>

                <p className="text-sm text-muted-foreground">
                    This link works once, and only for you. It expires in 15 minutes.
                </p>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button
                        onClick={() => {
                            if (link) window.open(link, "_blank", "noopener,noreferrer")
                        }}
                    >
                        Open Telegram
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
