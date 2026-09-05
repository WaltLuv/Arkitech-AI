"use client"

/**
 * Agent creation workflow that collects a user prompt and handles AI-generated configuration results.
 */
import { Button } from '@/components/ui/button'
import axios from 'axios'
import { ArrowUp, BriefcaseBusiness, Loader2, Loader2Icon, Mail, Plus, Search } from 'lucide-react'
import React, { useState } from 'react'
import AIAgentQuestions from './AIAgentQuestions'
import NewAgentCard from './NewAgentCard'
import { getApiErrorMessage } from '@/lib/api-error';
import { toast } from '@/components/ui/toast'

const quickSuggestions = [
    {
        label: "Find AI Jobs",
        prompt: "Find the latest AI developer jobs posted this week that match my skills and summarize the best opportunities for me.",
    },
    {
        label: "Inbox Summary",
        prompt: "Check my inbox and summarize the most important emails, especially anything that requires my reply or attention.",
    },
    {
        label: "Research Topic",
        prompt: "Research a topic across the web, compare multiple sources, and give me a concise summary with the most important findings.",
    },
    {
        label: "Plan My Day",
        prompt: "Check my calendar and upcoming tasks, then create a prioritized plan for everything I should focus on today.",
    },
    {
        label: "Reddit Trends",
        prompt: "Find trending Reddit discussions about AI tools and agents, then summarize the most useful and interesting conversations.",
    },
]

const templates = [
    {
        title: "Find latest jobs",
        description: "Search the web for the latest jobs matching my profile.",
        icon: BriefcaseBusiness,
        iconBg: "bg-orange-100",
        iconColor: "text-orange-600",
        border: "hover:border-orange-300",
        glow: "hover:shadow-orange-100",
    },
    {
        title: "Daily inbox summary",
        description: "Summarize important emails and highlight what needs my attention.",
        icon: Mail,
        iconBg: "bg-blue-100",
        iconColor: "text-blue-600",
        border: "hover:border-blue-300",
        glow: "hover:shadow-blue-100",
    },
    {
        title: "Research a topic",
        description: "Search the web and create a useful research summary for me.",
        icon: Search,
        iconBg: "bg-purple-100",
        iconColor: "text-purple-600",
        border: "hover:border-purple-300",
        glow: "hover:shadow-purple-100",
    },
]

type AgentConfigResp = {
    status: 'needs_clarification' | 'ready',
    clarificationQuestions: ClarificationQuestion[],
    config: CreatedAgentType
}

export type ClarificationQuestion = {
    id: string
    question: string
    type: "single_select" | "multi_select" | "text" | "number" | "date" | "time"
    options: string[]
    allowCustom: boolean
    customPlaceholder: string
}

export type CreatedAgentType = {
    id: number,
    userEmail: string,
    agentId: string,
    name: string,
    agentImage: string,
    description: string,
    instructions: string,
    objective: string,
    tools: string[],
    skills: string[],
    schedule: AgentSchedule,
    outputFormat: string,
    status: string,//Active, Pause
    createdAt: string,
    composioSessionId?: string
}

export type AgentSchedule = {
    type: "once" | "recurring" | "manual"
    frequency?: "hourly" | "daily" | "weekly" | "monthly"
    time?: string
    timezone?: string
}

function CreateAgent() {

    const [prompt, setPrompt] = useState('')
    const [configResult, setConfigResult] = useState<AgentConfigResp | null>(null);
    const [createdAgent, setCreatedAgent] = useState<CreatedAgentType | null>(null);
    const [loading, setLoading] = useState(false);

    const getBrowserTimezone = () => {
        return (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
    }

    const OnSubmit = async () => {
        if (!prompt.trim()) {
            toast.add({
                type: 'error',
                title: 'Prompt is required'
            })
            return;
        }

        try {
            setLoading(true);
            const timezone = getBrowserTimezone();
            const result = await axios.post('/api/agent/configure', {
                prompt: prompt,
                timezone: timezone
            });

            console.log(result.data);
            setConfigResult(result.data);
            if (result.data?.status_ == 'ready') {
                setCreatedAgent(result.data);
            }
        } catch (error) {
            const message = getApiErrorMessage(error, 'Unable to create agent');
            toast.add({
                type: 'error',
                title: message
            })
        } finally {
            setLoading(false);
        }
    }


    const onComplete = async (ans: Record<string, string | string[]>) => {
        console.log("OnComplete", ans);
        setConfigResult(null)
        const updatedPrompt = prompt + "\n" + JSON.stringify(ans);
        try {
            setLoading(true);
            const result = await axios.post('/api/agent/configure', {
                prompt: updatedPrompt,
                timezone: getBrowserTimezone()
            });
            console.log("--", result.data);
            setConfigResult(result.data);
            setCreatedAgent(result.data);
        } catch (error) {
            const message = getApiErrorMessage(error, 'Unable to create agent');
            toast.add({
                type: 'error',
                title: message
            })
        } finally {
            setLoading(false);
        }
    }
    return (
        <div className='mt-5'>
            <div>
                <h2 className='text-2xl font-semibold tracking-tight'>Create New Agent</h2>
                <p className='mt-1 text-sm text-muted-foreground'>Ask what type of agent you want to create, Type your goal, task, or workflow</p>
            </div>
            {/* Prompt Box  */}

            <div className='w-full border rounded-2xl bg-background p-3 mt-3
            shadow-lg shadow-purple-100 hover:shadow-purple-200'>
                <textarea placeholder='Describe the agent you want to create...'
                    className='min-h-[90px] w-full resize-none bg-transparent px-2 py-2 text-sm outline-none'
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                />
                <div className='flex justify-between items-center'>
                    <div>
                        <Button variant={'ghost'} size={'icon'}>
                            <Plus />
                        </Button>
                    </div>
                    <Button
                        disabled={loading}
                        onClick={OnSubmit} size={'icon'} className={'h-9 w-9 rounded-full bg-purple-600'}>
                        {loading ? <Loader2 className='animate-spin' /> : <ArrowUp />}
                    </Button>
                </div>
            </div>

            <div className='mt-3 flex gap-2'>
                {quickSuggestions.map((suggestion, index) => (
                    <Button variant={'outline'} key={index}
                        onClick={() => setPrompt(suggestion.prompt)}
                        className='hover:text-purple-700 hover:bg-purple-200 hover:border-purple-700'>
                        {suggestion.label}
                    </Button>
                ))}
            </div>


            {loading ? <div className='flex gap-2 items-center p-5 mt-7 border rounded-xl shadow'>
                <Loader2Icon className='animate-spin' />
                <h2>Generating Agent Config...</h2>
            </div> :

                !configResult && <div className='mt-10'>
                    <h2 className='flex text-lg justify-between items-center font-semibold'>Get Started <span className='text-sm font-medium'>View All</span></h2>
                    <div className='grid grid-cols-1 gap-4 md:grid-cols-3 mt-3'>
                        {templates.map((template, index) => (
                            <div key={index} className={`border rounded-2xl p-5 hover:cursor-pointer hover:shadow-lg ${template.border} ${template.glow}`}>
                                <template.icon className={`h-12 w-12 p-2 ${template.iconBg} ${template.iconColor} rounded-xl  `} />
                                <div className='mt-6'>
                                    <h2 className='font-semibold text-foreground'>{template.title}</h2>
                                    <p className='text-sm mt-2 leading-5 text-muted-foreground'>{template.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>}

            {configResult &&
                configResult.status == 'needs_clarification'
                &&
                <div className='p-5 border rounded-2xl mt-5'>
                    <AIAgentQuestions
                        questionList={configResult.clarificationQuestions}
                        onComplete={onComplete}
                    />
                </div>

            }

            {/* <p>{JSON.stringify(configResult)}</p> */}




            {createdAgent && <NewAgentCard createdAgent={createdAgent}
                setUpdatedAgent={(value: CreatedAgentType | null) => setCreatedAgent(value)} />}

        </div>
    )
}

export default CreateAgent
