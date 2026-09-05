"use client"

/**
 * Agent list component that fetches, displays, edits, chats with, and deletes saved agents.
 */
import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { CreatedAgentType } from './CreateAgent';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from '@/components/ui/button';
import { CalendarClockIcon, Ellipsis, MessageCircle, Pause, Pencil, Play, PlaySquareIcon, Trash } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import AgentEditSheet from './AgentEditSheet';
import AgentChatDrawer from './AgentChatDrawer';
import DeleteAgent from './DeleteAgent';
import { getApiErrorMessage } from '@/lib/api-error';
import Image from "next/image"
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { UserDetailContext } from '@/context/UserDetailContext';

function MyAgents() {

    const { setUserDetail } = React.useContext(UserDetailContext);
    const [myAgents, setMyAgents] = useState<CreatedAgentType[] | null>();
    const [openEditAgentSheet, setOpendEditAgentSheet] = useState(false);
    const [selectedEditAgent, setSelectedEditAgent] = useState<CreatedAgentType | null>(null);
    const [openChatDrawer, setOpenChatDrawer] = useState(false);
    const [openDeleteAlert, setOpenDeleteAlert] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string>()
    const fetchAgents = () =>
        axios.get('/api/agent/configure').then((result) => result.data)

    // Used by the event handlers below, which may write state freely.
    const AllUsersAgent = async () => {
        setMyAgents(await fetchAgents());
    }

    useEffect(() => {
        // `cancelled` stops a response that lands after unmount from writing state.
        let cancelled = false
        fetchAgents().then((data) => {
            if (!cancelled) setMyAgents(data)
        })
        return () => { cancelled = true }
    }, [])

    //fetch ALl User Agents

    const updateAgentStatus = async (agentConfig: CreatedAgentType) => {

        await axios.put('/api/agent/configure', {
            ...agentConfig,
            status: agentConfig?.status == 'active' ? 'pause' : 'active'
        })

        AllUsersAgent();

    }


    const runAgent = async (agent: CreatedAgentType) => {

        try {
            const result = await axios.post("/api/agent/run", {
                agentConfig: agent,
                agentId: agent?.agentId,
                input: null // Important to run Agent Immediatly
            });

            console.log(result.data);
            if (result.data.error) {
                toast.add({
                    type: 'error',
                    title: result.data.error
                });
                return;
            }

            const updatedUser = await axios.post('/api/users');
            setUserDetail(updatedUser.data);

            toast.add({
                title: 'Agent Running...',
                type: 'success'
            })
        } catch (error) {
            toast.add({
                type: 'error',
                title: getApiErrorMessage(error, 'Unable to run agent')
            });
        }

    }


    return (
        <div className='mt-5'>
            <h2 className='font-bold text-2xl'>My Agents</h2>
            <p className='text-sm text-muted-foreground mt-1'>Run, Manage and Update All the agents you&apos;ve created.</p>

            <div className='grid grid-cols-2 2xl:grid-cols-3 gap-5 mt-5'>
                {myAgents === undefined && <AgentCardSkeletonList />}

                {myAgents?.map((agent, index) => (
                    <div className='p-3 border rounded-2xl' key={agent.agentId ?? index}>
                        <div className='flex justify-between items-center'>
                            <Image src={agent?.agentImage ?? "/logo.svg"} alt={agent.name}
                                width={64} height={64}
                                className='p-2 border size-16 rounded-xl bg-slate-100' />
                            <div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger >
                                        <Button variant={'ghost'} size={'icon'}>
                                            <Ellipsis />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuGroup>

                                            <DropdownMenuItem><Play /> Run Now</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => updateAgentStatus(agent)}>
                                                {agent?.status == 'active' ?
                                                    <span className='flex items-center gap-1'><Pause /> Pause Agent</span> :
                                                    <span className='flex items-center gap-1'><PlaySquareIcon />Active Agent</span>}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { setOpendEditAgentSheet(true); setSelectedEditAgent(agent) }}>
                                                <Pencil /> Edit Agent</DropdownMenuItem>

                                        </DropdownMenuGroup>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuGroup>
                                            <DropdownMenuItem variant='destructive'
                                                onClick={() => { setOpenDeleteAlert(true); setSelectedAgentId(agent.agentId) }}
                                            > <Trash /> Delete Agent</DropdownMenuItem>
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>

                        <div className='my-2'>
                            <h2 className='font-bold flex gap-2'>{agent.name}
                                <span className={`font-normal 
                                 px-2 py-0.5  text-xs
                                rounded-2xl ${agent?.status == 'pause' ? 'bg-yellow-100 text-yellow-600' : 'text-green-700 bg-green-100'}`}>
                                    {(agent.status.toUpperCase())}</span> </h2>
                            <p className='line-clamp-1 mt-1'>{agent?.description}</p>
                            <div className='flex gap-1 items-center mt-4'>
                                <CalendarClockIcon className='h-4 w-4 text-purple-700' />
                                <p className='text-xs text-muted-foreground'>{agent?.schedule?.frequency}
                                    {agent.schedule.type == 'recurring' &&
                                        <span>
                                            &nbsp; at {agent?.schedule?.time}
                                        </span>}</p>
                            </div>
                            <Separator className={'my-3'} />
                            <div className='flex items-center gap-2.5 w-full'>

                                <Button variant={'outline'} className={'flex-1  mt-2'}
                                    onClick={() => runAgent(agent)}
                                ><Play />Run Agent</Button>
                                <Button className={'bg-purple-700 mt-2 flex-1'}
                                    onClick={() => { setOpenChatDrawer(true); setSelectedEditAgent(agent) }}
                                ><MessageCircle />Chat With Agent</Button>

                            </div>
                        </div>

                    </div>
                ))}

            </div>
            {openEditAgentSheet && <AgentEditSheet
                agentConfig={selectedEditAgent}
                setUpdatedAgent={() => AllUsersAgent()}
                openSheet_={openEditAgentSheet}
                closeSheet={(v: boolean) => setOpendEditAgentSheet(v)}

            />}

            <AgentChatDrawer
                agent={selectedEditAgent}
                open={openChatDrawer}
                onOpenChange={setOpenChatDrawer}
            />

            <DeleteAgent
                openAlert={openDeleteAlert}
                closeAlert={() => setOpenDeleteAlert(false)}
                agentId={selectedAgentId}
                refreshData={() => AllUsersAgent()}
            />



        </div>
    )
}

function AgentCardSkeletonList() {
    return (
        <>
            {Array.from({ length: 4 }).map((_, index) => (
                <div className='p-3 border rounded-2xl' key={index}>
                    <div className='flex justify-between items-center'>
                        <Skeleton className='size-16 rounded-xl' />
                        <Skeleton className='size-9 rounded-md' />
                    </div>

                    <div className='my-2'>
                        <div className='flex items-center gap-2'>
                            <Skeleton className='h-5 w-32' />
                            <Skeleton className='h-5 w-16 rounded-2xl' />
                        </div>
                        <Skeleton className='mt-2 h-4 w-full' />
                        <Skeleton className='mt-4 h-4 w-40' />
                        <Skeleton className='my-3 h-px w-full' />
                        <div className='flex items-center gap-2.5 w-full'>
                            <Skeleton className='mt-2 h-9 flex-1 rounded-md' />
                            <Skeleton className='mt-2 h-9 flex-1 rounded-md' />
                        </div>
                    </div>
                </div>
            ))}
        </>
    )
}

export default MyAgents
