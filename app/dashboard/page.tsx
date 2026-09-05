"use client"

/**
 * Dashboard overview page with agent metrics, recent activity, and quick actions.
 */

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import AgentRunResultDialog, { AgentRunResult } from "@/components/custom/run/AgentRunResultDialog"
import { UserDetailContext } from "@/context/UserDetailContext"
import axios from "axios"
import { ArrowRight, Bot, CalendarClock, CheckCircle2, Clock3, Loader2, RefreshCw, Sparkles, TriangleAlert, Zap } from "lucide-react"
import moment from "moment"
import { useRouter } from "next/navigation"
import React, { useContext, useEffect, useMemo, useState } from "react"

type AgentRunType = AgentRunResult & {
    scheduledFor: string
}

function DashboardPage() {
    const router = useRouter()
    const { userDetail } = useContext(UserDetailContext)
    const [agentRunList, setAgentRunList] = useState<AgentRunType[]>([])
    const [selectedRun, setSelectedRun] = useState<AgentRunType | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        getDashboardRuns()
    }, [])

    const getDashboardRuns = async () => {
        setLoading(true)
        try {
            const result = await axios.get("/api/agentlog")
            setAgentRunList(result.data)
        } finally {
            setLoading(false)
        }
    }

    const dashboardData = useMemo(() => {
        const completed = agentRunList.filter((run) => run.status == "completed")
        const running = agentRunList.filter((run) => run.status == "running" || run.status == "queued")
        const scheduled = agentRunList.filter((run) => run.status == "scheduled")
        const attention = agentRunList.filter((run) => run.status == "failed")

        return {
            completed,
            running,
            scheduled,
            attention,
            latestResults: completed.slice(0, 3),
            runningNow: running[0],
            upNext: scheduled.slice(0, 2),
            needsAttention: attention[0],
        }
    }, [agentRunList])

    const currentUser = Array.isArray(userDetail) ? userDetail[0] : userDetail
    const firstName = currentUser?.name?.split(" ")?.[0] ?? "there"
    const greeting = getGreeting()
    const statCards = [
        {
            label: "Completed",
            value: dashboardData.completed.length,
            detail: "finished runs",
            icon: CheckCircle2,
            className: "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-100",
            iconClassName: "bg-emerald-200/70 text-emerald-700",
        },
        {
            label: "Running",
            value: dashboardData.running.length,
            detail: "active agents",
            icon: Zap,
            className: "border-sky-200 bg-sky-50 text-sky-900 shadow-sky-100",
            iconClassName: "bg-sky-200/70 text-sky-700",
        },
        {
            label: "Scheduled",
            value: dashboardData.scheduled.length,
            detail: "coming up",
            icon: CalendarClock,
            className: "border-violet-200 bg-violet-50 text-violet-900 shadow-violet-100",
            iconClassName: "bg-violet-200/70 text-violet-700",
        },
        {
            label: "Attention",
            value: dashboardData.attention.length,
            detail: "need review",
            icon: TriangleAlert,
            className: "border-amber-200 bg-amber-50 text-amber-900 shadow-amber-100",
            iconClassName: "bg-amber-200/70 text-amber-700",
        },
    ]

    return (
        <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-5 py-8 md:px-10 lg:px-12">
            <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#f0f9ff_36%,#f5f3ff_68%,#fff7ed_100%)] p-5 shadow-sm md:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
                            <Clock3 className="size-4 text-sky-600" />
                            {moment().format("dddd, MMMM D")}
                        </p>
                        <h1 className="mt-3 text-3xl font-bold tracking-normal text-slate-950 md:text-4xl">{greeting}, {firstName}</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">Here's the latest pulse from your agents, runs, schedules, and anything that needs a closer look.</p>
                    </div>
                    <Button variant="outline" className="w-fit border-white/80 bg-white/80 shadow-sm hover:bg-white" onClick={getDashboardRuns} disabled={loading}>
                        {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        Refresh briefing
                    </Button>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {statCards.map((stat) => (
                        <MetricCard key={stat.label} {...stat} />
                    ))}
                </div>
            </div>

            <section className="mt-8 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
                <div className="h-1.5 bg-[linear-gradient(90deg,#22c55e,#0ea5e9,#8b5cf6,#f59e0b)]" />
                <div className="p-5">
                    <div className="flex gap-4">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
                            <Sparkles className="size-5 text-indigo-700" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">Your AI briefing</h2>
                                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">Updated just now</Badge>
                            </div>
                            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">
                                {buildBriefing(dashboardData.completed.length, dashboardData.running.length, dashboardData.attention.length, dashboardData.scheduled.length, dashboardData.runningNow?.name)}
                            </p>
                            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-700">
                                <StatusPill icon={<CheckCircle2 className="size-4" />} label={`${dashboardData.completed.length} completed`} className="bg-emerald-50 text-emerald-700" />
                                <StatusPill icon={<Zap className="size-4" />} label={`${dashboardData.running.length} running`} className="bg-sky-50 text-sky-700" />
                                <StatusPill icon={<TriangleAlert className="size-4" />} label={`${dashboardData.attention.length} needs attention`} className="bg-amber-50 text-amber-700" />
                                <Button variant="link" className="ml-auto px-0 text-indigo-700" onClick={() => router.push("/dashboard/run")}>
                                    View all runs <ArrowRight />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,640px)_minmax(300px,1fr)]">
                <main className="min-w-0 space-y-8">
                    <section>
                        <div className="mb-3 flex items-center gap-2">
                            <h2 className="text-xl font-semibold">Needs your attention</h2>
                            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{dashboardData.attention.length}</Badge>
                        </div>
                        {dashboardData.needsAttention ? (
                            <div className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm shadow-amber-100 sm:flex-row sm:items-center sm:justify-between">
                                <AgentIdentity run={dashboardData.needsAttention} title={dashboardData.needsAttention.name ?? "Agent run"} subtitle={dashboardData.needsAttention.error ?? "This run needs review before it can continue."} />
                                <Button variant="outline" className="border-amber-200 bg-white/80 hover:bg-white" onClick={() => router.push("/dashboard/run")}>Review run</Button>
                            </div>
                        ) : (
                            <EmptyState icon={<CheckCircle2 className="size-4 text-emerald-600" />} text="No runs need attention right now." className="border-emerald-200 bg-emerald-50 text-emerald-700" />
                        )}
                    </section>

                    <section>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">Latest results</h2>
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{dashboardData.latestResults.length}</Badge>
                        </div>
                        <div className="max-w-2xl divide-y overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                            {dashboardData.latestResults.length > 0 ? dashboardData.latestResults.map((run) => (
                                <ResultRow key={run.id} run={run} onOpen={() => setSelectedRun(run)} />
                            )) : (
                                <EmptyState icon={<Bot className="size-4 text-slate-500" />} text="Completed run results will appear here." />
                            )}
                        </div>
                    </section>
                </main>

                <aside className="min-w-0 space-y-8">
                    <section>
                        <h2 className="mb-3 text-xl font-semibold">Running now</h2>
                        {dashboardData.runningNow ? (
                            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm shadow-sky-100">
                                <div className="flex items-start gap-4">
                                    <AgentAvatar run={dashboardData.runningNow} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-semibold">{dashboardData.runningNow.name ?? "Agent run"}</h3>
                                            <Badge className="bg-sky-200 text-sky-800 hover:bg-sky-200">{dashboardData.runningNow.status}</Badge>
                                        </div>
                                        <p className="mt-1 truncate text-sm text-sky-800/70">{dashboardData.runningNow.task ?? "Working on the latest task"}</p>
                                    </div>
                                </div>
                                <div className="mt-5 flex items-center gap-3">
                                    <Progress value={dashboardData.runningNow.status == "running" ? 68 : 24} className="flex-1 bg-white" />
                                    <span className="text-sm font-medium text-sky-800">{dashboardData.runningNow.status == "running" ? "68%" : "Queued"}</span>
                                </div>
                                <Button variant="link" className="mt-3 px-0 text-sky-700" onClick={() => router.push("/dashboard/run")}>View run</Button>
                            </div>
                        ) : (
                            <EmptyState icon={<Zap className="size-4 text-sky-600" />} text="No agents are running right now." className="border-sky-200 bg-sky-50 text-sky-700" />
                        )}
                    </section>

                    <section>
                        <h2 className="mb-3 text-xl font-semibold">Up next</h2>
                        <div className="divide-y overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm shadow-violet-100">
                            {dashboardData.upNext.length > 0 ? dashboardData.upNext.map((run) => (
                                <div key={run.id} className="flex items-center gap-3 p-4 transition-colors hover:bg-violet-50">
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100">
                                        <CalendarClock className="size-4 text-violet-700" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="truncate text-sm font-semibold">{run.name ?? "Scheduled agent"}</h3>
                                        <p className="text-sm text-muted-foreground">{moment(run.scheduledFor).calendar()}</p>
                                    </div>
                                </div>
                            )) : (
                                <EmptyState icon={<CalendarClock className="size-4 text-violet-600" />} text="Scheduled runs will appear here." className="border-0 text-violet-700" />
                            )}
                        </div>
                    </section>
                </aside>
            </div>

            <AgentRunResultDialog
                run={selectedRun}
                open={Boolean(selectedRun)}
                onOpenChange={(open) => !open && setSelectedRun(null)}
            />

        </div>
    )
}

function MetricCard({
    label,
    value,
    detail,
    icon: Icon,
    className,
    iconClassName,
}: {
    label: string,
    value: number,
    detail: string,
    icon: React.ElementType,
    className: string,
    iconClassName: string,
}) {
    return (
        <div className={`rounded-xl border p-4 shadow-sm ${className}`}>
            <div className="flex items-center justify-between gap-3">
                <div className={`flex size-10 items-center justify-center rounded-lg ${iconClassName}`}>
                    <Icon className="size-5" />
                </div>
                <span className="text-3xl font-bold leading-none">{value}</span>
            </div>
            <h3 className="mt-4 text-sm font-semibold">{label}</h3>
            <p className="text-xs opacity-70">{detail}</p>
        </div>
    )
}

function StatusPill({ icon, label, className }: { icon: React.ReactNode, label: string, className: string }) {
    return (
        <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ${className}`}>
            {icon}
            {label}
        </span>
    )
}

function ResultRow({ run, onOpen }: { run: AgentRunType, onOpen: () => void }) {
    return (
        <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
            <AgentIdentity run={run} title={run.name ?? "Agent run"} subtitle={getOutputSummary(run)} />
            <div className="flex items-center gap-4 sm:shrink-0">
                <span className="text-sm text-muted-foreground">{moment(run.completedAt ?? run.createdAt).fromNow()}</span>
                <Button variant="link" className="px-0 text-indigo-700" onClick={onOpen}>View result</Button>
            </div>
        </div>
    )
}

function AgentIdentity({ run, title, subtitle }: { run: AgentRunType, title: string, subtitle: string }) {
    return (
        <div className="flex min-w-0 items-center gap-4">
            <AgentAvatar run={run} />
            <div className="min-w-0">
                <h3 className="truncate font-semibold">{title}</h3>
                <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
            </div>
        </div>
    )
}

function AgentAvatar({ run }: { run: AgentRunType }) {
    return (
        <div className="relative shrink-0">
            {run.agentImage ? (
                <img src={run.agentImage} alt={run.name ?? "Agent"} className="size-12 rounded-xl border bg-white p-2 shadow-sm" />
            ) : (
                <div className="flex size-12 items-center justify-center rounded-xl border bg-white shadow-sm">
                    <Bot className="size-5 text-slate-600" />
                </div>
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white ${run.status == "failed" ? "bg-orange-500" : run.status == "completed" ? "bg-green-500" : "bg-blue-600"}`} />
        </div>
    )
}

function EmptyState({ icon, text, className = "" }: { icon: React.ReactNode, text: string, className?: string }) {
    return (
        <div className={`flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground ${className}`}>
            {icon}
            {text}
        </div>
    )
}

function getGreeting() {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
}

function buildBriefing(completed: number, running: number, attention: number, scheduled: number, runningAgent?: string | null) {
    if (completed + running + attention + scheduled == 0) {
        return "Create or run an agent to start building your daily briefing. New results, active work, and scheduled runs will show up here."
    }

    const runningText = running > 0 ? `${runningAgent ?? "One agent"} is still running.` : "No agents are running right now."
    return `Your agents completed ${completed} ${completed == 1 ? "task" : "tasks"} recently. ${runningText} ${attention > 0 ? `${attention} ${attention == 1 ? "run needs" : "runs need"} attention.` : "Everything looks clear."} ${scheduled > 0 ? `${scheduled} ${scheduled == 1 ? "run is" : "runs are"} scheduled next.` : ""}`
}

function getOutputSummary(run: AgentRunType) {
    if (!run.output) return run.task ?? "Result is ready to review."
    if (typeof run.output == "string") return run.output
    if (run.output.summary) return run.output.summary
    if (run.output.message) return run.output.message
    if (run.output.result) return typeof run.output.result == "string" ? run.output.result : "Result is ready to review."
    return run.task ?? "Result is ready to review."
}

export default DashboardPage
