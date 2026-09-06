"use client"

/**
 * Per-Agent Usage Credit spend, read from the Credit Ledger.
 */
import { Skeleton } from "@/components/ui/skeleton"
import axios from "axios"
import { Bot, CreditCard } from "lucide-react"
import { useEffect, useState } from "react"

type AgentSpend = {
    agentId: string
    name: string | null
    spent: number
    refunded: number
    net: number
}

type Usage = {
    balance: number
    totalNet: number
    perAgent: AgentSpend[]
}

export function UsageByAgent() {
    const [usage, setUsage] = useState<Usage | null>(null)
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        axios.get("/api/usage")
            .then((result) => {
                if (!cancelled) setUsage(result.data)
            })
            .catch(() => {
                if (!cancelled) setFailed(true)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
    }, [])

    if (loading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        )
    }

    if (failed || !usage) {
        return (
            <p className="text-sm text-muted-foreground">
                Usage could not be loaded right now.
            </p>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-slate-50 p-4">
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance</p>
                    <p className="text-2xl font-semibold">{usage.balance}</p>
                </div>
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Spent</p>
                    <p className="text-2xl font-semibold">{usage.totalNet}</p>
                </div>
            </div>

            {usage.perAgent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No credits spent yet. Runs will appear here once your agents start working.
                </p>
            ) : (
                <ul className="divide-y rounded-lg border">
                    {usage.perAgent.map((agent) => (
                        <li key={agent.agentId} className="flex items-center justify-between gap-3 p-3">
                            <div className="flex min-w-0 items-center gap-3">
                                <Bot className="size-4 shrink-0 text-slate-500" />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                        {agent.name ?? "Deleted agent"}
                                    </p>
                                    {agent.refunded > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            {agent.spent} charged, {agent.refunded} refunded
                                        </p>
                                    )}
                                </div>
                            </div>
                            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
                                <CreditCard className="size-3.5 text-slate-400" />
                                {agent.net}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
