"use client"

/**
 * Agent editor sheet for updating instructions, schedule, skills, status, image, and tool connections.
 */

import React, { useEffect, useMemo, useState } from "react"

import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

import {
    Link2,
    Loader2,
    Loader2Icon,
    Plus,
    Shuffle,
    Unlink,
    X,
} from "lucide-react"

import { CreatedAgentType } from "./CreateAgent"
import { toast } from "@/components/ui/toast"
import axios from "axios"
import Image from "next/image"

type Props = {
    children?: React.ReactNode
    agentConfig: CreatedAgentType | null,
    setUpdatedAgent: any,
    openSheet_?: boolean,
    closeSheet?: any
}

type EditableTool = {
    name: string
    connected: boolean,
    slug: string,
    logo: string,

}

const frequencyOptions = [
    "hourly",
    "daily",
    "weekly",
    "monthly",
]

function AgentEditSheet({
    children,
    agentConfig,
    setUpdatedAgent,
    openSheet_ = false,
    closeSheet
}: Props) {
    const [draftAgent, setDraftAgent] =
        useState<CreatedAgentType | null>(agentConfig)

    const [skillInput, setSkillInput] = useState("")
    const [tools, setTools] = useState<EditableTool[]>([])
    const [openSheet, setOpenSheet] = useState(openSheet_);
    const [loadingTools, setLoadingTools] = useState(false);
    const [disconnectToolLoading, setDisconnectToolLoading] = useState(false);
    useEffect(() => {
        setDraftAgent(agentConfig)
        agentConfig && GetTools();
    }, [agentConfig])

    const updateDraft = (key: string, value: any) => {
        setDraftAgent((prev: any) => ({
            ...prev,
            [key]: value,
        }))
    }

    const shuffleImage = () => {
        const newImage =
            `https://api.dicebear.com/10.x/gaze/svg?seed=${crypto.randomUUID()}`
        updateDraft("agentImage", newImage)
    }

    const addSkill = () => {
        if (!draftAgent) return

        const skill = skillInput.trim()

        if (!skill) return

        const existingSkills = draftAgent.skills ?? []

        const alreadyExists = existingSkills.some(
            (item) =>
                item.toLowerCase() === skill.toLowerCase()
        )

        if (alreadyExists) {
            setSkillInput("")
            return
        }

        updateDraft("skills", [
            ...existingSkills,
            skill,
        ])

        setSkillInput("")
    }

    const removeSkill = (skillToRemove: string) => {
        if (!draftAgent) return

        updateDraft(
            "skills",
            (draftAgent.skills ?? []).filter(
                (skill) => skill !== skillToRemove
            )
        )
    }


    //Get Tools
    const GetTools = async () => {
        setLoadingTools(true);
        const result = await axios.get('/api/agent/tools?agentId=' + agentConfig?.agentId)
        console.log(result.data);
        setTools(result.data);
        setLoadingTools(false);
    }

    const ConnectedTools = tools.filter(tool => tool.connected == true);



    const hasSchedule =
        draftAgent?.schedule?.type === "once" ||
        draftAgent?.schedule?.type === "recurring"

    const handleSubmit = async (event: any) => {
        event.preventDefault();
        //update to DB as well
        const result = await axios.put('/api/agent/configure', {
            ...draftAgent
        })
        console.log(result.data);
        if (result.data?.error) {
            toast.add({
                type: 'error',
                title: result.data?.error,
            });
            return;
        }
        //Update Updated Agent to parent 
        setUpdatedAgent(draftAgent)

        toast.add({
            type: 'success',
            title: "Agent Updated!",
        })

        setOpenSheet(false);
        closeSheet(false)

    }

    if (!draftAgent) {
        return null
    }

    const connectTool = async (slug: string) => {
        const result = await axios.post('/api/agent/tools/connect', {
            agentId: agentConfig?.agentId ?? '',
            toolSlug: slug
        });
        console.log(result.data);

        window.open(result?.data?.redirectUrl);


    }

    const disconnectTool = async (slug: string) => {

        setDisconnectToolLoading(true);
        const result = await axios.delete('/api/agent/tools/connect', {
            data: {
                toolSlug: slug,
                agentId: agentConfig?.agentId
            }
        })

        if (result.data.error) {
            toast.add({
                type: 'error',
                title: result.data.error
            })
            setDisconnectToolLoading(false);

            return;
        }
        toast.add({
            type: 'success',
            title: 'Tool disconnected!'
        })
        setDisconnectToolLoading(false);
        setOpenSheet(false);
    }

    return (
        <Sheet open={openSheet} onOpenChange={(v: boolean) => { setOpenSheet(v); closeSheet(v) }}>
            <SheetTrigger >
                {children}
            </SheetTrigger>

            <SheetContent className="flex w-full flex-col p-0 sm:max-w-xl">
                <form
                    onSubmit={handleSubmit}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <SheetHeader className="border-b px-5 py-4">
                        <div className="flex items-center gap-2.5">
                            <img
                                src={draftAgent.agentImage ?? "/logo.svg"}
                                alt={draftAgent.name ?? "Agent"}
                                className="size-10 rounded-xl border bg-muted p-1"
                            />

                            <div>
                                <SheetTitle>
                                    Edit Agent
                                </SheetTitle>

                                <SheetDescription>
                                    Update how this agent looks,
                                    works and runs.
                                </SheetDescription>
                            </div>
                        </div>
                    </SheetHeader>

                    <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-6 p-5">

                            {/* Image */}
                            <section className="flex items-center gap-4 rounded-2xl border bg-muted/30 p-4">
                                <img
                                    src={
                                        draftAgent.agentImage ??
                                        "/logo.svg"
                                    }
                                    alt={
                                        draftAgent.name ??
                                        "Agent"
                                    }
                                    className="size-20 rounded-2xl border bg-white p-2 object-cover"
                                />

                                <div className="space-y-2">
                                    <div>
                                        <p className="font-medium">
                                            Agent Image
                                        </p>

                                        <p className="text-xs text-muted-foreground">
                                            Shuffle to generate a new look
                                        </p>
                                    </div>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={shuffleImage}
                                    >
                                        <Shuffle className="size-4" />
                                        Shuffle Image
                                    </Button>
                                </div>
                            </section>

                            {/* Name */}
                            <section className="space-y-2">
                                <Label htmlFor="agent-name">
                                    Agent Name
                                </Label>

                                <Input
                                    id="agent-name"
                                    value={draftAgent.name ?? ""}
                                    onChange={(event) =>
                                        updateDraft(
                                            "name",
                                            event.target.value
                                        )
                                    }
                                    placeholder="Give your agent a name"
                                />
                            </section>

                            {/* Objective */}
                            <section className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="agent-objective">
                                        Objective
                                    </Label>

                                    <Textarea
                                        id="agent-objective"
                                        value={
                                            draftAgent.objective ?? ""
                                        }
                                        onChange={(event) =>
                                            updateDraft(
                                                "objective",
                                                event.target.value
                                            )
                                        }
                                        placeholder="What should this agent accomplish?"
                                        className="min-h-24 resize-y"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="agent-instructions">
                                        Instructions
                                    </Label>

                                    <Textarea
                                        id="agent-instructions"
                                        value={
                                            draftAgent.instructions ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateDraft(
                                                "instructions",
                                                event.target.value
                                            )
                                        }
                                        placeholder="Add detailed instructions and guardrails"
                                        className="min-h-32 resize-y"
                                    />
                                </div>
                            </section>

                            {/* Schedule */}
                            <section className="space-y-4 rounded-2xl border p-4">
                                <div>
                                    <h3 className="font-medium">
                                        Schedule
                                    </h3>

                                    <p className="text-xs text-muted-foreground">
                                        Choose when and how often this
                                        agent runs.
                                    </p>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">

                                    <div className="space-y-2">
                                        <Label>
                                            Run Type
                                        </Label>

                                        <Select
                                            value={
                                                draftAgent.schedule
                                                    ?.type ??
                                                "manual"
                                            }
                                            onValueChange={(value) =>
                                                updateDraft(
                                                    "schedule",
                                                    {
                                                        ...draftAgent.schedule,
                                                        type: value,
                                                    }
                                                )
                                            }
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>

                                            <SelectContent>
                                                <SelectItem value="manual">
                                                    Manual
                                                </SelectItem>

                                                <SelectItem value="once">
                                                    Once
                                                </SelectItem>

                                                <SelectItem value="recurring">
                                                    Recurring
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="schedule-time">
                                            Time
                                        </Label>

                                        <Input
                                            id="schedule-time"
                                            type="time"
                                            value={
                                                draftAgent.schedule
                                                    ?.time ??
                                                "09:00"
                                            }
                                            disabled={!hasSchedule}
                                            onChange={(event) =>
                                                updateDraft(
                                                    "schedule",
                                                    {
                                                        ...draftAgent.schedule,
                                                        time: event
                                                            .target
                                                            .value,
                                                    }
                                                )
                                            }
                                        />
                                    </div>

                                    <div className="space-y-2 sm:col-span-2">
                                        <Label>
                                            Frequency
                                        </Label>

                                        <Select
                                            value={
                                                draftAgent.schedule
                                                    ?.frequency ??
                                                "daily"
                                            }
                                            disabled={
                                                draftAgent.schedule
                                                    ?.type !==
                                                "recurring"
                                            }
                                            onValueChange={(value) =>
                                                updateDraft(
                                                    "schedule",
                                                    {
                                                        ...draftAgent.schedule,
                                                        frequency:
                                                            value,
                                                    }
                                                )
                                            }
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>

                                            <SelectContent>
                                                {frequencyOptions.map(
                                                    (frequency) => (
                                                        <SelectItem
                                                            key={
                                                                frequency
                                                            }
                                                            value={
                                                                frequency
                                                            }
                                                        >
                                                            {frequency
                                                                .charAt(
                                                                    0
                                                                )
                                                                .toUpperCase() +
                                                                frequency.slice(
                                                                    1
                                                                )}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </section>

                            {/* Skills */}
                            <section className="space-y-3">
                                <div>
                                    <h3 className="font-medium">
                                        Skills
                                    </h3>

                                    <p className="text-xs text-muted-foreground">
                                        Add or remove capabilities this
                                        agent should use.
                                    </p>
                                </div>

                                <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border bg-muted/20 p-2.5">
                                    {(draftAgent.skills ?? []).map(
                                        (skill) => (
                                            <Badge
                                                key={skill}
                                                variant="secondary"
                                                className="h-7 gap-1.5 px-2.5"
                                            >
                                                {skill}

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        removeSkill(
                                                            skill
                                                        )
                                                    }
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            </Badge>
                                        )
                                    )}

                                    {(draftAgent.skills ?? [])
                                        .length === 0 && (
                                            <span className="text-sm text-muted-foreground">
                                                No skills added
                                            </span>
                                        )}
                                </div>

                                <div className="flex gap-2">
                                    <Input
                                        value={skillInput}
                                        onChange={(event) =>
                                            setSkillInput(
                                                event.target.value
                                            )
                                        }
                                        onKeyDown={(event) => {
                                            if (
                                                event.key === "Enter"
                                            ) {
                                                event.preventDefault()
                                                addSkill()
                                            }
                                        }}
                                        placeholder="Add a skill"
                                    />

                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={addSkill}
                                    >
                                        <Plus className="size-4" />
                                        Add
                                    </Button>
                                </div>
                            </section>

                            {/* Tools */}
                            <section className="space-y-3">
                                <div>
                                    <h3 className="font-medium">
                                        Connected Tools
                                    </h3>

                                    <p className="text-xs text-muted-foreground">
                                        {ConnectedTools.length} of{" "}
                                        {tools.length} connected
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    {loadingTools &&
                                        <div className="p-2 border rounded-2xl flex items-center">
                                            <Loader2Icon className="animate-spin" /> Loading Tools....
                                        </div>
                                    }
                                    {tools.map((tool, index) => (
                                        <div
                                            key={`${tool.name}-${index}`}
                                            className="flex items-center justify-between gap-3 rounded-xl border p-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                                                    {/* {tool.connected ? (
                                                        <Link2 className="size-4 text-emerald-600" />
                                                    ) : (
                                                        <Unlink className="size-4 text-muted-foreground" />
                                                    )} */}
                                                    <img src={tool.logo} alt={tool.name} width={30} height={30}
                                                        className="rounded-lg"
                                                    />
                                                </div>

                                                <div>
                                                    <p className="text-sm font-medium">
                                                        {tool.name}
                                                    </p>

                                                    <p
                                                        className={`text-xs ${tool.connected
                                                            ? "text-emerald-600"
                                                            : "text-muted-foreground"
                                                            }`}
                                                    >
                                                        {tool.connected
                                                            ? <span className="text-green-500">Connected</span>
                                                            : <span className="text-red-500">Not connected</span>}
                                                    </p>
                                                </div>
                                            </div>

                                            <Button
                                                type="button"
                                                onClick={() => tool.connected ? disconnectTool(tool.slug) : connectTool(tool.slug)}
                                                variant={
                                                    tool.connected
                                                        ? "outline"
                                                        : "default"
                                                }
                                                size="sm"
                                                disabled={disconnectToolLoading}
                                            >
                                                {disconnectToolLoading && <Loader2 className="animate-spin" />}
                                                {tool.connected
                                                    ? "Disconnect"
                                                    : "Connect"}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* Output */}
                            <section className="space-y-2">
                                <Label htmlFor="output-format">
                                    Output Format
                                </Label>

                                <Textarea
                                    id="output-format"
                                    value={
                                        draftAgent.outputFormat ??
                                        ""
                                    }
                                    onChange={(event) =>
                                        updateDraft(
                                            "outputFormat",
                                            event.target.value
                                        )
                                    }
                                    placeholder="Describe how the result should be formatted"
                                    className="min-h-24 resize-y"
                                />
                            </section>
                        </div>
                    </ScrollArea>

                    <SheetFooter className="border-t p-4">
                        <div className="flex w-full justify-end gap-2.5">
                            <SheetClose >
                                <Button
                                    type="button"
                                    variant="outline"
                                >
                                    Cancel
                                </Button>
                            </SheetClose>

                            <Button
                                type="submit"
                                className="bg-purple-700 hover:bg-purple-800"
                            >
                                Save Changes
                            </Button>
                        </div>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    )
}

export default AgentEditSheet