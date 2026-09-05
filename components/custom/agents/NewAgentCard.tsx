/**
 * Success card displayed after an agent is generated and saved.
 */
import React from 'react'
import { CreatedAgentType } from './CreateAgent'
import { Calendar } from '@/components/ui/calendar'
import { CalendarCheck2Icon, Delete, Ellipsis, Pause, Pencil, Play, Trash } from 'lucide-react'
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import AgentEditSheet from './AgentEditSheet'
type Props = {
    createdAgent: CreatedAgentType | null,
    setUpdatedAgent: any
}

function NewAgentCard({ createdAgent, setUpdatedAgent }: Props) {
    return (
        <div className='flex items-center justify-between border mt-7 p-4 rounded-2xl shadow-md hover:shadow-purple-100 '>
            <div className='flex gap-4 items-center'>
                <img src={createdAgent?.agentImage} alt={createdAgent?.name}
                    width={80} height={80}
                    className='p-2 bg-slate-100 rounded-xl' />
                <div className='flex flex-col gap-1'>
                    <h2 className='font-bold text-[16px] flex gap-2 items-center '>{createdAgent?.name}
                        <span className='text-green-700 bg-green-100 text-sm rounded-2xl px-2'>{createdAgent?.status}</span>
                    </h2>
                    <p className='text-muted-foreground text-md line-clamp-1'>{createdAgent?.description}</p>
                    <div className='flex gap-3  items-center text-muted-foreground text-sm items-center mt-2'>
                        <div className='flex gap-2 items-center'>
                            <CalendarCheck2Icon /> Next Run on {createdAgent?.schedule?.time}
                        </div>
                        <h2>Runs {createdAgent?.schedule?.frequency}</h2>
                    </div>
                </div>
            </div>

            <div className='flex gap-2 items-center text-muted-foreground '>

                <AgentEditSheet agentConfig={createdAgent}
                    setUpdatedAgent={setUpdatedAgent}>
                    <Button variant={'ghost'} size={'icon'}>
                        <Pencil />
                    </Button>
                </AgentEditSheet>

                <DropdownMenu>
                    <DropdownMenuTrigger >
                        <Button variant={'ghost'} size={'icon'}>
                            <Ellipsis />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuGroup>

                            <DropdownMenuItem><Play /> Run Now</DropdownMenuItem>
                            <DropdownMenuItem><Pause /> Pause Agent</DropdownMenuItem>
                            <DropdownMenuItem> <Pencil /> Edit Agent</DropdownMenuItem>

                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem variant='destructive'> <Trash /> Delete Agent</DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}

export default NewAgentCard