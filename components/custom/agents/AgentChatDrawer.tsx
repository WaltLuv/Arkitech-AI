"use client"

/**
 * Slide-over chat interface for sending ad hoc tasks to an existing agent.
 */

import { useContext, useEffect, useRef, useState } from "react"
import { ArrowUp, Loader2, Paperclip, Sparkles } from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { CreatedAgentType } from "./CreateAgent"
import axios from "axios"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "@/components/ui/toast"
import { UserDetailContext } from "@/context/UserDetailContext"
type Props = {
    agent: CreatedAgentType | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

type ChatMessage = {
    id: string
    role: "user" | "agent"
    content: string
}

function AgentChatDrawer({ agent, open, onOpenChange }: Props) {
    const { setUserDetail } = useContext(UserDetailContext)
    const [prompt, setPrompt] = useState("")
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isAgentReplying, setIsAgentReplying] = useState(false)

    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        agent && setMessages([])
    }, [agent])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
        })
    }, [messages, isAgentReplying])

    const sendMessage = async () => {
        const message = prompt.trim()

        if (!message || isAgentReplying) return

        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: message,
        }

        setMessages((prev) => [...prev, userMessage])
        setPrompt("")
        setIsAgentReplying(true)
        const chatHistory = [...messages, userMessage]
        try {

            const result = await axios.post("/api/agent/run", {
                agentConfig: agent,
                agentId: agent?.agentId,
                input: JSON.stringify(chatHistory)

            })

            console.log(result.data?.finalOutput);

            const updatedUser = await axios.post('/api/users')
            setUserDetail(updatedUser.data)

            const agentMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: "agent",
                content: result.data?.finalOutput,
            }

            setMessages((prev) => [...prev, agentMessage])
        } catch (error: any) {
            const message = error?.response?.data?.error || "Sorry, I couldn’t process your message. Please try again."
            toast.add({
                type: "error",
                title: message,
            })
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "agent",
                    content: message,
                },
            ])
        } finally {
            setIsAgentReplying(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
            >
                <SheetHeader className="border-b px-5 py-4 pr-14">
                    <div className="flex items-center gap-3">
                        <img
                            src={agent?.agentImage}
                            alt={agent?.name || "Agent"}
                            className="size-11 rounded-xl bg-slate-100 object-cover p-1"
                        />

                        <div className="min-w-0">
                            <SheetTitle className="truncate text-base">
                                {agent?.name}
                            </SheetTitle>

                            <SheetDescription className="text-xs">
                                Chat with your agent and give it a task.
                            </SheetDescription>
                        </div>

                    </div>

                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-5">
                    <div className="flex min-h-full flex-col justify-end gap-4">
                        <div className="mx-auto mb-4 max-w-sm text-center">
                            <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
                                <Sparkles className="size-5" />
                            </div>

                            <h2 className="text-sm font-medium">
                                Start a chat with {agent?.name}
                            </h2>

                            <p className="mt-1 text-xs text-muted-foreground">
                                {agent?.objective || agent?.description}
                            </p>
                        </div>

                        <AgentMessage
                            agent={agent}
                            content={`Hi! I’m ${agent?.name}. What would you like me to work on?`}
                        />

                        {messages.map((message) =>
                            message.role === "user" ? (
                                <div
                                    key={message.id}
                                    className="flex justify-end"
                                >
                                    <Bubble align="end" variant="default">
                                        <BubbleContent>
                                            <p className="whitespace-pre-wrap break-words">
                                                {message.content}
                                            </p>
                                        </BubbleContent>
                                    </Bubble>
                                </div>
                            ) : (
                                <AgentMessage
                                    key={message.id}
                                    agent={agent}
                                    content={message.content}
                                />
                            )
                        )}

                        {isAgentReplying && (
                            <div className="flex items-end gap-2">
                                <img
                                    src={agent?.agentImage}
                                    alt={agent?.name || "Agent"}
                                    className="size-8 rounded-full border bg-background object-cover p-1"
                                />

                                <Bubble align="start" variant="outline">
                                    <BubbleContent>
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Loader2 className="size-4 animate-spin" />

                                            <span className="text-sm">
                                                {agent?.name} is thinking...
                                            </span>
                                        </div>
                                    </BubbleContent>
                                </Bubble>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                </div>

                <div className="shrink-0 border-t bg-background p-4">
                    <div className="rounded-2xl border p-2 shadow-sm focus-within:border-purple-400">
                        <Textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            onKeyDown={(event) => {
                                if (
                                    event.key === "Enter" &&
                                    !event.shiftKey &&
                                    !event.nativeEvent.isComposing
                                ) {
                                    event.preventDefault()
                                    sendMessage()
                                }
                            }}
                            placeholder={
                                isAgentReplying
                                    ? `${agent?.name} is replying...`
                                    : `Message ${agent?.name}...`
                            }
                            disabled={isAgentReplying}
                            aria-label="Message your agent"
                            className="max-h-40 min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                        />

                        <div className="flex items-center justify-between pt-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Attach a file"
                            >
                                <Paperclip className="size-4" />
                            </Button>

                            <Button
                                type="button"
                                size="icon"
                                onClick={sendMessage}
                                disabled={!prompt.trim() || isAgentReplying}
                                className="rounded-full bg-purple-600 text-white hover:bg-purple-700"
                                aria-label="Send message"
                            >
                                {isAgentReplying ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <ArrowUp className="size-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}

function AgentMessage({
    agent,
    content,
}: {
    agent: CreatedAgentType | null
    content: string
}) {
    return (
        <div className="flex items-end gap-2">
            <img
                src={agent?.agentImage}
                alt={agent?.name || "Agent"}
                className="size-8 rounded-full border bg-background object-cover p-1"
            />

            <Bubble align="start" variant="outline">
                <BubbleContent>
                    {/* <p className="whitespace-pre-wrap break-words"> */}
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                    >
                        {content}
                    </ReactMarkdown>
                    {/* </p> */}
                </BubbleContent>
            </Bubble>
        </div>
    )
}

export default AgentChatDrawer
