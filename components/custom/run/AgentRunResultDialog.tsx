"use client"

/**
 * Dialog that renders a single agent run result with markdown output and error states.
 */

import React from "react"
import moment from "moment"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, CalendarCheck, CircleAlert, ClipboardList } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type AgentRunResult = {
    id: string
    agentId: string
    email: string
    status: string
    output: any
    error: any
    scheduledFor?: string
    completedAt: string | null
    createdAt: string
    name: string | null
    agentImage: string | null
    task: string | null
}

type Props = {
    run: AgentRunResult | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

function AgentRunResultDialog({ run, open, onOpenChange }: Props) {
    const outputText = getPrimaryOutput(run?.output)
    const hasOutput = Boolean(outputText || run?.output)
    const completedTime = run?.completedAt ?? run?.createdAt

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="border-b px-5 py-4 pr-12">
                    <div className="flex min-w-0 items-center gap-3">
                        {run?.agentImage ? (
                            <img src={run.agentImage} alt={run.name ?? "Agent"} className="size-11 rounded-xl border bg-white p-2" />
                        ) : (
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-slate-50">
                                <Bot className="size-5 text-slate-600" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <DialogTitle className="truncate text-lg">{run?.name ?? "Agent run result"}</DialogTitle>
                            <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                                {run?.status && <StatusBadge status={run.status} />}
                                {completedTime && (
                                    <span className="inline-flex items-center gap-1">
                                        <CalendarCheck className="size-3.5" />
                                        {moment(completedTime).format("MMM D, YYYY h:mm A")}
                                    </span>
                                )}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="max-h-[calc(88vh-96px)] overflow-y-auto px-5 py-5">
                    {run?.task && (
                        <section className="mb-5 rounded-lg border bg-slate-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                                <ClipboardList className="size-4" />
                                Task
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{run.task}</p>
                        </section>
                    )}

                    {run?.error && (
                        <section className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800">
                                <CircleAlert className="size-4" />
                                Error
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-red-700">{formatValue(run.error)}</p>
                        </section>
                    )}

                    <section>
                        <h3 className="mb-3 text-sm font-semibold text-slate-900">Output</h3>
                        {hasOutput ? (
                            <div className="space-y-4">
                                {outputText && (
                                    <div className="prose prose-sm max-w-none rounded-lg border bg-white p-4 leading-6">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {outputText}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {run?.output && typeof run.output != "string" && (
                                    <details className="rounded-lg border bg-slate-950 text-slate-100" open={!outputText}>
                                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-100">Full result payload</summary>
                                        <pre className="max-h-[420px] overflow-auto border-t border-white/10 p-4 text-xs leading-5">
                                            {formatValue(run.output)}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                                This run does not have an output yet.
                            </div>
                        )}
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function StatusBadge({ status }: { status: string }) {
    return (
        <Badge className={`${status == "completed" ? "bg-green-100 text-green-700 hover:bg-green-100" :
            status == "failed" ? "bg-red-100 text-red-700 hover:bg-red-100" :
                status == "scheduled" ? "bg-slate-100 text-slate-700 hover:bg-slate-100" :
                    "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"
            }`}>
            {status}
        </Badge>
    )
}

function getPrimaryOutput(output: any) {
    if (!output) return ""
    if (typeof output == "string") return output
    if (typeof output.finalOutput == "string") return output.finalOutput
    if (typeof output.summary == "string") return output.summary
    if (typeof output.message == "string") return output.message
    if (typeof output.result == "string") return output.result
    return ""
}

function formatValue(value: any) {
    if (typeof value == "string") return value

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

export default AgentRunResultDialog
