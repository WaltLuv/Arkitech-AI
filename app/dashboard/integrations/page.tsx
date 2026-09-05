"use client"

/**
 * Dashboard page that presents available external tools and their connection states.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

type ToolsType = {
    connected: string,
    name: string,
    icon: string
    description: string,
    enabled: boolean,
    slug: string,
    account: any
}

function Integrations() {

    const [toolList, setToolList] = useState<ToolsType[]>();
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        GetAllTools();
    }, [])

    const GetAllTools = async () => {
        setLoading(true);
        try {
            const result = await axios.get('/api/integrations');
            console.log(result.data)

            setToolList(result.data);
        } finally {
            setLoading(false);
        }
    }

    const connectTool = async (slug: string) => {
        setLoading(true);
        const result = await axios.post('/api/integrations/tool-connection', {
            slug: slug
        });
        window.open(result?.data?.redirectUrl);
        setLoading(false);
    }

    const disconnectTool = async (connectedAccountId: string) => {
        setLoading(true);
        const result = await axios.delete('/api/integrations/tool-connection', {
            data: {
                connectedAccountId
            }
        });

        console.log(result.data);
        GetAllTools();
        setLoading(false);

    }

    return (
        <div className='p-10 md:px-10 lg:px-28'>
            <h2 className='font-bold text-3xl'>Integrations</h2>
            <p className='mt-1 text-muted-foreground'>Connect the tools your agents need to get work done.</p>

            <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-5'>
                {loading && !toolList && <IntegrationCardSkeletonList />}

                {toolList?.map((tool, index) => (
                    <div className='p-3 border rounded-2xl' key={tool.slug ?? index}>
                        <div>
                            <div className='flex items-center justify-between'>
                                <img src={tool.icon} width={35} height={35} className='rounded-sm' />
                                <Badge className={`text-xs ${tool.connected == 'Connected' ? 'text-green-700 bg-green-100' : 'text-gray-700 bg-gray-100'}`}>{tool.connected}</Badge>
                            </div>
                            <div className='mt-2'>
                                <h2 className='text-lg font-medium'>{tool.name}</h2>
                                <p className='line-clamp-2 text-sm text-muted-foreground'>{tool.description}</p>
                            </div>
                        </div>
                        <div className='mt-4'>
                            {tool.connected == 'Connected' ?
                                <Button variant={'outline'} className={'w-full'}
                                    onClick={() => disconnectTool(tool?.account?.id)}
                                    disabled={loading}
                                >Disconnect</Button> :
                                <Button className={'w-full'}
                                    disabled={loading}
                                    onClick={() => connectTool(tool.slug)}>Connect</Button>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function IntegrationCardSkeletonList() {
    return (
        <>
            {Array.from({ length: 6 }).map((_, index) => (
                <div className='p-3 border rounded-2xl' key={index}>
                    <div>
                        <div className='flex items-center justify-between'>
                            <Skeleton className='h-[35px] w-[35px] rounded-sm' />
                            <Skeleton className='h-5 w-24 rounded-full' />
                        </div>
                        <div className='mt-2'>
                            <Skeleton className='h-6 w-32' />
                            <Skeleton className='mt-2 h-4 w-full' />
                            <Skeleton className='mt-1 h-4 w-3/4' />
                        </div>
                    </div>
                    <div className='mt-4'>
                        <Skeleton className='h-9 w-full rounded-md' />
                    </div>
                </div>
            ))}
        </>
    )
}

export default Integrations
