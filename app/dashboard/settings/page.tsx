"use client"

/**
 * Settings page for account preferences and product-level controls.
 */

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { UsageByAgent } from "@/components/custom/usage/UsageByAgent";
import { UserDetailContext } from "@/context/UserDetailContext"
import axios from "axios"
import { Bell, Bot, CreditCard, Loader2, ShieldCheck } from "lucide-react"
import React, { useContext, useEffect, useState } from "react"

const DEMO_AGENT_LIMIT = 5

type AgentSummary = {
    agentId: string
}

function SettingsPage() {
    const { userDetail } = useContext(UserDetailContext)
    const currentUser = Array.isArray(userDetail) ? userDetail[0] : userDetail
    const [agentCount, setAgentCount] = useState(0)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getAgentCount()
    }, [])

    const getAgentCount = async () => {
        try {
            setLoading(true)
            const result = await axios.get("/api/agent/configure")
            setAgentCount((result.data as AgentSummary[]).length)
        } finally {
            setLoading(false)
        }
    }

    const usagePercent = Math.min((agentCount / DEMO_AGENT_LIMIT) * 100, 100)

    return (
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">Control your demo workspace preferences and usage limits.</p>
            </div>

            <section className="mt-6 rounded-2xl border bg-background p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-100">
                            <Bot className="size-5 text-purple-700" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">Demo plan</h2>
                                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Free</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">This demo workspace can create up to {DEMO_AGENT_LIMIT} agents.</p>
                        </div>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">
                        {loading ? <Loader2 className="size-4 animate-spin" /> : `${agentCount}/${DEMO_AGENT_LIMIT} agents`}
                    </div>
                </div>
                <Progress value={usagePercent} className="mt-5" />
            </section>

            <section className="mt-6 rounded-2xl border bg-background p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Preferences</h2>
                <div className="mt-5 space-y-5">
                    <SettingRow
                        icon={<Bell className="size-4 text-blue-700" />}
                        title="Run notifications"
                        description="Get notified when agent runs complete or fail."
                        checked
                    />
                    <Separator />
                    <SettingRow
                        icon={<ShieldCheck className="size-4 text-green-700" />}
                        title="Approval reminders"
                        description="Show reminders before agents use connected tools."
                        checked
                    />
                    <Separator />
                    <SettingRow
                        icon={<CreditCard className="size-4 text-orange-700" />}
                        title="Credit alerts"
                        description={`Current balance: ${currentUser?.usageCredits ?? 0} credits.`}
                    />
                </div>
            </section>

            <section className="mt-8">
                <h3 className="text-lg font-semibold">Usage by agent</h3>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">
                    Credits spent per agent, with refunds already deducted.
                </p>
                <UsageByAgent />
            </section>
        </div>
    )
}

function SettingRow({ icon, title, description, checked = false }: { icon: React.ReactNode, title: string, description: string, checked?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    {icon}
                </div>
                <div className="min-w-0">
                    <h3 className="font-medium">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
            </div>
            <Switch defaultChecked={checked} />
        </div>
    )
}

export default SettingsPage
