"use client"

/**
 * Compact recent-runs list for the dashboard overview.
 */

import React, { useState } from 'react'
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import moment from 'moment'
import { DotIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import AgentRunResultDialog, { AgentRunResult } from './AgentRunResultDialog'
type Props = {
    agentRunList: AgentRunResult[],
    loading?: boolean
}

function RecentRuns({ agentRunList, loading }: Props) {
    const [selectedRun, setSelectedRun] = useState<AgentRunResult | null>(null)

    const renderStatus = (status: string) => {
        return (
            <Badge className={`${status == 'completed' ? 'bg-green-100 text-green-700' :
                status == 'failed' ? 'bg-red-100 text-red-700' :
                    status == 'scheduled' ? 'bg-slate-100 text-slate-700' :
                        'bg-yellow-100 text-yellow-700'
                }`}>
                <DotIcon /> {status}
            </Badge>)
    }

    return (
        <div className='mt-12'>
            <h2 className='text-2xl font-bold'>Recent Runs</h2>
            <div className='py-2 mt-3 border rounded-2xl'>
                <Table className=''>
                    <TableCaption>All recent agents log</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">Agent</TableHead>
                            <TableHead>Task</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="">Updated</TableHead>
                            <TableHead className="">Result</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? Array.from({ length: 5 }).map((_, index) => (
                            <TableRow key={index}>
                                <TableCell className="p-5"><Skeleton className='h-5 w-24' /></TableCell>
                                <TableCell><Skeleton className='h-5 w-44' /></TableCell>
                                <TableCell><Skeleton className='h-6 w-24 rounded-full' /></TableCell>
                                <TableCell><Skeleton className='h-5 w-20' /></TableCell>
                                <TableCell><Skeleton className='h-5 w-10' /></TableCell>
                            </TableRow>
                        )) : agentRunList.map((run, index) => (
                            <TableRow key={index}>
                                <TableCell className="font-medium p-5" >{run?.name}</TableCell>
                                <TableCell className='truncate max-w-[200px]'>{run.task}</TableCell>
                                <TableCell>{renderStatus(run.status)}</TableCell>
                                <TableCell >{run.completedAt ? moment(run.completedAt).fromNow() : moment(run.createdAt).fromNow()}</TableCell>
                                <TableCell>
                                    <Button variant="link" className="h-auto px-0 text-blue-600" onClick={() => setSelectedRun(run)}>
                                        View
                                    </Button>
                                </TableCell>

                            </TableRow>
                        ))}

                    </TableBody>
                </Table>
            </div>
            <AgentRunResultDialog
                run={selectedRun}
                open={Boolean(selectedRun)}
                onOpenChange={(open) => !open && setSelectedRun(null)}
            />
        </div>
    )
}

export default RecentRuns
