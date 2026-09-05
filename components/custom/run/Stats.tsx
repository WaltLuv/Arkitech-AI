/**
 * Reusable metric cards for dashboard and run-history summaries.
 */
import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
    completed: number | undefined,
    failed: number | undefined,
    scheduled: number | undefined,
    loading?: boolean
}

function Stats({ completed, failed, scheduled, loading }: Props) {
    if (loading) {
        return (
            <div className='mt-8 grid grid-cols-2 md:grid-cols-3 gap-5'>
                {Array.from({ length: 3 }).map((_, index) => (
                    <div className='flex justify-between p-3 border rounded-xl' key={index}>
                        <div className='flex gap-1.5 items-center'>
                            <Skeleton className='h-3 w-3 rounded-full' />
                            <Skeleton className='h-5 w-24' />
                        </div>
                        <Skeleton className='h-5 w-8' />
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className='mt-8 grid grid-cols-2 md:grid-cols-3 gap-5'>
            <div className='flex justify-between p-3 border rounded-xl'>
                <div className='flex gap-1.5 items-center'>
                    <div className='h-3 w-3 bg-green-600 rounded-full'>
                    </div>
                    <h2>Completed</h2>
                </div>
                <h2>{completed}</h2>
            </div>

            <div className='flex justify-between p-3 border rounded-xl'>
                <div className='flex gap-1.5 items-center'>
                    <div className='h-3 w-3 bg-red-600 rounded-full'>
                    </div>
                    <h2>Failed</h2>
                </div>
                <h2>{failed}</h2>
            </div>

            <div className='flex justify-between p-3 border rounded-xl'>
                <div className='flex gap-1.5 items-center'>
                    <div className='h-3 w-3 bg-blue-600 rounded-full'>
                    </div>
                    <h2>Scheduled</h2>
                </div>
                <h2>{scheduled}</h2>
            </div>
        </div>
    )
}

export default Stats
