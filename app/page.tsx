"use client"

/**
 * Public landing page for Arkitech AI before users enter the dashboard.
 */

import { useUser } from "@clerk/nextjs"
import {
  ArrowRight,
  Blocks,
  Bot,
  CalendarClock,
  CheckCircle2,
  Play,
  Sparkles,
  Zap,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

const agents = [
  {
    name: "Inbox Scout",
    task: "Summarize investor replies",
    state: "Running",
    color: "bg-sky-100 text-sky-800",
  },
  {
    name: "Pipeline Minder",
    task: "Sync warm leads to CRM",
    state: "Scheduled",
    color: "bg-violet-100 text-violet-800",
  },
  {
    name: "Market Pulse",
    task: "Send Monday briefing",
    state: "Ready",
    color: "bg-emerald-100 text-emerald-800",
  },
]

const features = [
  {
    icon: Bot,
    title: "Build focused agents",
    text: "Give every agent a goal, tools, instructions, and the exact output format your workflow expects.",
    className: "bg-emerald-50 text-emerald-700",
  },
  {
    icon: CalendarClock,
    title: "Schedule real work",
    text: "Run agents once, daily, weekly, or on the cadence that keeps your team moving without manual check-ins.",
    className: "bg-sky-50 text-sky-700",
  },
  {
    icon: Blocks,
    title: "Connect your stack",
    text: "Wire agents into integrations so they can read, write, and execute tasks across the tools you already use.",
    className: "bg-amber-50 text-amber-700",
  },
]

export default function Home() {
  const { isLoaded, isSignedIn } = useUser()
  const showSignedIn = isLoaded && isSignedIn

  return (
    <main className="min-h-screen overflow-hidden bg-[#fbfaf7] text-slate-950">
      <section className="relative min-h-screen border-b border-slate-200 bg-[linear-gradient(180deg,#fffdf8_0%,#eef8f4_44%,#f7f3ff_100%)]">
        <div className="absolute inset-0 opacity-[0.24] [background-image:linear-gradient(#0f172a_1px,transparent_1px),linear-gradient(90deg,#0f172a_1px,transparent_1px)] [background-size:42px_42px]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 md:px-8">
          <header className="flex h-20 items-center justify-between gap-4">
            <Link href="/" className="flex min-w-0 items-center gap-3">
              <Image src="/logo.svg" alt="Arkitech AI logo" width={42} height={42} priority />
              <span className="truncate text-lg font-semibold tracking-normal">Arkitech AI</span>
            </Link>

            <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
              <a href="#agents" className="transition-colors hover:text-slate-950">Agents</a>
              <a href="#workflow" className="transition-colors hover:text-slate-950">Workflow</a>
              <a href="#integrations" className="transition-colors hover:text-slate-950">Integrations</a>
            </nav>

            <div className="flex items-center gap-2">
              {!showSignedIn ? (
                <>
                <Link href="/sign-in" className="hidden h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white/70 sm:inline-flex">
                  Sign in
                </Link>
                <Link href="/sign-up" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800">
                  Start free <ArrowRight className="size-4" />
                </Link>
                </>
              ) : (
                <Link href="/dashboard" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800">
                  Open dashboard <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          </header>

          <div className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(460px,1.08fr)] lg:py-12">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/75 px-3 py-1 text-sm font-medium text-emerald-800 shadow-sm">
                <Sparkles className="size-4" />
                Agentic automation for everyday operations
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-bold leading-[1.02] tracking-normal text-slate-950 md:text-7xl">
                Arkitech AI keeps your agents moving while you work.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-700 md:text-lg">
                Create AI agents that use tools, follow schedules, run repeatable tasks, and report back with the signal your team needs.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {!showSignedIn ? (
                  <>
                  <Link href="/sign-up" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800">
                    Create your first agent <ArrowRight className="size-4" />
                  </Link>
                  <Link href="/sign-in" className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-white">
                    Sign in
                  </Link>
                  </>
                ) : (
                  <>
                  <Link href="/dashboard/agents" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800">
                    Manage agents <ArrowRight className="size-4" />
                  </Link>
                  <Link href="/dashboard/run" className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-white">
                    View runs
                  </Link>
                  </>
                )}
              </div>

              <div className="mt-9 grid max-w-xl grid-cols-3 gap-3 text-sm">
                <Stat value="3x" label="faster handoffs" />
                <Stat value="24/7" label="scheduled runs" />
                <Stat value="100" label="starter credits" />
              </div>
            </div>

            <div className="relative" id="agents">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/50">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
                  <div className="flex items-center gap-2">
                    <Image src="/logo.svg" alt="" width={28} height={28} />
                    <span className="text-sm font-semibold">Agent command</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    Live
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-[190px_minmax(0,1fr)]">
                  <aside className="hidden border-r border-slate-200 bg-slate-50 p-4 md:block">
                    {["Dashboard", "Agents", "Runs", "Integrations"].map((item, index) => (
                      <div key={item} className={`mb-2 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium ${index === 1 ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>
                        <span className={`size-2 rounded-full ${["bg-sky-500", "bg-emerald-500", "bg-rose-500", "bg-violet-500"][index]}`} />
                        {item}
                      </div>
                    ))}
                  </aside>

                  <div className="min-w-0 p-4 md:p-5">
                    <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500">Today&apos;s briefing</p>
                        <h2 className="mt-1 text-2xl font-bold tracking-normal">3 agents ready to run</h2>
                      </div>
                      <button className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-medium text-white">
                        <Play className="size-4" />
                        Run now
                      </button>
                    </div>

                    <div className="mt-5 space-y-3">
                      {agents.map((agent) => (
                        <div key={agent.name} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                            <Bot className="size-5 text-slate-800" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
                            <p className="truncate text-sm text-slate-500">{agent.task}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agent.color}`}>{agent.state}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <MiniMetric icon={<CheckCircle2 className="size-4" />} label="Completed" value="18" className="bg-emerald-50 text-emerald-800" />
                      <MiniMetric icon={<Zap className="size-4" />} label="Running" value="2" className="bg-sky-50 text-sky-800" />
                      <MiniMetric icon={<CalendarClock className="size-4" />} label="Scheduled" value="9" className="bg-violet-50 text-violet-800" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-16 md:grid-cols-3 md:px-8">
        {features.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`mb-5 flex size-11 items-center justify-center rounded-lg ${feature.className}`}>
              <feature.icon className="size-5" />
            </div>
            <h2 className="text-lg font-semibold tracking-normal">{feature.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{feature.text}</p>
          </div>
        ))}
      </section>

      <section id="integrations" className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Ready when you are</p>
            <h2 className="mt-2 text-3xl font-bold tracking-normal">Launch an agent workspace in minutes.</h2>
          </div>
          {!showSignedIn ? (
            <Link href="/sign-up" className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800">
              Get started <ArrowRight className="size-4" />
            </Link>
          ) : (
            <Link href="/dashboard" className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800">
              Go to dashboard <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/80 bg-white/65 p-3 shadow-sm">
      <p className="text-2xl font-bold leading-none tracking-normal text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-medium leading-4 text-slate-600">{label}</p>
    </div>
  )
}

function MiniMetric({
  icon,
  label,
  value,
  className,
}: {
  icon: ReactNode
  label: string
  value: string
  className: string
}) {
  return (
    <div className={`rounded-xl p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        {icon}
        <span className="text-xl font-bold leading-none">{value}</span>
      </div>
      <p className="mt-3 text-xs font-semibold">{label}</p>
    </div>
  )
}
