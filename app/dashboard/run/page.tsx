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
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<statsType>();
    useEffect(() => {
        GetAllUserAgentRun();
    }, [])

    const GetAllUserAgentRun = async () => {
        setLoading(true);
        try {
            const result = await axios.get('/api/agentlog');
            console.log(result);
            setAgentRunList(result.data);

            const completedRun = result?.data.filter((item: AgentRunType) => item.status == 'completed')
            const failedRun = result?.data.filter((item: AgentRunType) => item.status == 'failed')
            const scheduledRun = result?.data.filter((item: AgentRunType) => item.status == 'scheduled')

            setStats({
                completed: completedRun.length,
                failed: failedRun.length,
                scheduled: scheduledRun.length,

            })
        } finally {
            setLoading(false);
        }
    }

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
