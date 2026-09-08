"use client"

/**
 * Settings page for account preferences and product-level controls.
 */

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { UsageByAgent } from "@/components/custom/usage/UsageByAgent";
import { Connections } from "@/components/custom/settings/Connections";
import { UserDetailContext } from "@/context/UserDetailContext"
import { PLAN_LABELS, type AgentSlotEntitlement } from "@/lib/agent-entitlement-display"
import axios from "axios"
import { Bell, Bot, CreditCard, Loader2, ShieldCheck } from "lucide-react"
import React, { useContext, useEffect, useState } from "react"

function SettingsPage() {
    const { userDetail } = useContext(UserDetailContext)
    const currentUser = Array.isArray(userDetail) ? userDetail[0] : userDetail
    // Read from the entitlement seam the server enforces with. This page used
    // to keep a DEMO_AGENT_LIMIT of 5 of its own, so it contradicted both the
    // sidebar and the limit creation actually applies.
    const [entitlement, setEntitlement] = useState<AgentSlotEntitlement | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getEntitlement()
    }, [])

    const getEntitlement = async () => {
        try {
            setLoading(true)
            const result = await axios.get("/api/agent/slots")
            setEntitlement(result.data ?? null)
        } finally {
            setLoading(false)
        }
    }

    const usagePercent = entitlement && entitlement.effectiveLimit > 0
        ? Math.min((entitlement.occupiedSlots / entitlement.effectiveLimit) * 100, 100)
        : 0

    return (
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">Control your workspace preferences and usage limits.</p>
            </div>

            <section className="mt-6 rounded-2xl border bg-background p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-100">
                            <Bot className="size-5 text-purple-700" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">
                                    {entitlement ? `${PLAN_LABELS[entitlement.planTier]} plan` : "Plan"}
                                </h2>
                                {entitlement?.override != null ? (
                                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Custom limit</Badge>
                                ) : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {entitlement?.isOverEntitlement
                                    ? `Your ${entitlement.occupiedSlots} agents keep working. Hiring another needs ${entitlement.occupiedSlots - entitlement.effectiveLimit + 1} freed, or a bigger plan.`
                                    : entitlement
                                        ? `This workspace can employ up to ${entitlement.effectiveLimit} agents.`
                                        : "Loading your plan."}
                            </p>
                        </div>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">
                        {loading || !entitlement
                            ? <Loader2 className="size-4 animate-spin" />
                            : `${entitlement.occupiedSlots}/${entitlement.effectiveLimit} agents`}
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
                <h2 className="text-lg font-semibold">Communication</h2>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">
                    Choose where you want to talk to your team. Use one, both, or neither.
                </p>
                <Connections />
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
