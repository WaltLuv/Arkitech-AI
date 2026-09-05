"use client"

/**
 * Run history page that shows scheduled, running, completed, and failed agent executions.
 */
import RecentRuns from '@/components/custom/run/RecentRuns'
import Stats from '@/components/custom/run/Stats'
import { AgentRunResult } from '@/components/custom/run/AgentRunResultDialog'
import axios from 'axios'
import React, { useEffect, useState } from 'react'

export type AgentRunType = AgentRunResult



type statsType = {
    completed: number,
    failed: number,
    scheduled: number
}

function RunPage() {

    const [agentRunList, setAgentRunList] = useState<AgentRunType[]>([])
    // Starts true because the fetch below runs on mount.
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<statsType>();
    useEffect(() => {
        // `cancelled` stops a response that lands after unmount from writing state.
        let cancelled = false
        axios.get('/api/agentlog')
            .then((result) => {
                if (cancelled) return
                const runs: AgentRunType[] = result?.data ?? []
                setAgentRunList(runs);
                setStats({
                    completed: runs.filter((item) => item.status == 'completed').length,
                    failed: runs.filter((item) => item.status == 'failed').length,
                    scheduled: runs.filter((item) => item.status == 'scheduled').length,
                })
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            })
        return () => { cancelled = true }
    }, [])


    return (
        <div className='p-10 md:px-15 lg:px-28'>
            <h2 className='font-bold text-3xl'>Agent Runs</h2>
            <p className='mt-1 text-muted-foreground'>See what your agents are working on and review their results.</p>
            <Stats
                completed={stats?.completed}
                failed={stats?.failed}
                scheduled={stats?.scheduled}
                loading={loading}

            />

            <RecentRuns agentRunList={agentRunList} loading={loading} />

        </div>
    )
}

export default RunPage
