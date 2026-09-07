"use client"

/**
 * Browser runs: start one for an Agent, and open any run to watch it.
 */
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { CreatedAgentType } from "@/components/custom/agents/CreateAgent"
import axios from "axios"
import { Globe, Loader2 } from "lucide-react"
import moment from "moment"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

type RunRow = {
    id: string
    agentId: string
    agentName: string | null
    task: string
    status: string
    priority: string
    queuedAt: string
    endedAt: string | null
    failureReason: string | null
}

export default function BrowserPage() {
    const router = useRouter()
    const [agents, setAgents] = useState<CreatedAgentType[]>([])
    const [runs, setRuns] = useState<RunRow[] | null>(null)
    const [configured, setConfigured] = useState<boolean | null>(null)
    const [agentId, setAgentId] = useState("")
    const [task, setTask] = useState("")
    const [priority, setPriority] = useState<"normal" | "urgent">("normal")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        try {
            const [agentResult, runResult] = await Promise.all([
                axios.get<CreatedAgentType[]>("/api/agent/configure"),
                axios.get<{ configured: boolean; runs: RunRow[] }>("/api/browser/runs"),
            ])
            setAgents(Array.isArray(agentResult.data) ? agentResult.data : [])
            setRuns(runResult.data.runs)
            setConfigured(runResult.data.configured)
        } catch {
            setError("Could not load browser runs.")
            setRuns([])
        }
    }

    useEffect(() => {
        load()
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
    }, [])

    const start = async () => {
        setSubmitting(true)
        setError(null)
        try {
            const result = await axios.post("/api/browser/runs", { agentId, task, priority })
            router.push(`/dashboard/browser/${result.data.id}`)
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error ?? err.message : "Could not start the run.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="w-full flex justify-center">
            <div className="w-full max-w-4xl px-4 sm:px-6 pt-12 pb-16 space-y-8">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="h-6 w-6" /> Browser</h1>
                    <p className="text-sm text-muted-foreground">
                        Give an Agent a task to carry out in a cloud browser. Watch it live, pause it, take over, hand control back, or stop it.
                    </p>
                </div>

                {configured === false && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                        Browser execution is not configured on this server. Runs cannot be started until it is.
                    </p>
                )}

                <div className="rounded-2xl border p-4 space-y-3">
                    <h2 className="font-semibold">Start a browser task</h2>
                    <Select value={agentId} onValueChange={value => setAgentId(value ?? "")}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Choose an Agent" /></SelectTrigger>
                        <SelectContent>
                            {agents.map(agent => (
                                <SelectItem key={agent.agentId} value={agent.agentId}>{agent.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Textarea
                        placeholder="What should the Agent do in the browser? Be specific about the site and the outcome."
                        value={task}
                        onChange={event => setTask(event.target.value)}
                        rows={4}
                        maxLength={4000}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                        <Select value={priority} onValueChange={value => setPriority(value === "urgent" ? "urgent" : "normal")}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="normal">Normal priority</SelectItem>
                                <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button disabled={!agentId || !task.trim() || submitting || configured === false} onClick={start}>
                            {submitting && <Loader2 className="animate-spin" />} Queue task
                        </Button>
                    </div>
                    {error && <p className="text-sm text-red-700">{error}</p>}
                </div>

                <div>
                    <h2 className="font-semibold mb-2">Runs</h2>
                    {runs === null ? (
                        <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
                    ) : runs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No browser runs yet.</p>
                    ) : (
                        <ul className="divide-y rounded-2xl border">
                            {runs.map(run => (
                                <li key={run.id} className="flex flex-wrap items-center gap-3 p-3 cursor-pointer hover:bg-slate-50"
                                    onClick={() => router.push(`/dashboard/browser/${run.id}`)}>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium truncate">{run.agentName ?? run.agentId}</div>
                                        <div className="text-sm text-muted-foreground truncate">{run.task}</div>
                                        {run.failureReason && <div className="text-xs text-red-700 truncate">{run.failureReason}</div>}
                                    </div>
                                    {run.priority === "urgent" && <Badge className="bg-orange-100 text-orange-700">urgent</Badge>}
                                    <Badge variant="outline">{run.status}</Badge>
                                    <span className="text-xs text-muted-foreground">{moment(run.queuedAt).fromNow()}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}
