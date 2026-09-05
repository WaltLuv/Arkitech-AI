"use client"

/**
 * Interactive clarification form rendered when the AI needs more details before creating an agent.
 */

import { useState } from "react"
import { ArrowLeft, ArrowRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ClarificationQuestion } from "./CreateAgent"

type AnswerValue = string | string[]

type Props = {
    questionList: ClarificationQuestion[]
    onComplete: (answers: Record<string, AnswerValue>) => void
}

export default function AIAgentQuestions({
    questionList,
    onComplete
}: Props) {
    const [currentIndex, setCurrentIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
    const [customMode, setCustomMode] = useState<Record<string, boolean>>({})
    const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})

    const currentQuestion = questionList[currentIndex]

    const currentAnswer = answers[currentQuestion.id] || ""
    const currentTextAnswer = typeof currentAnswer === "string" ? currentAnswer : ""
    const currentMultiAnswer = Array.isArray(currentAnswer) ? currentAnswer : []
    const hasCurrentAnswer = Array.isArray(currentAnswer)
        ? currentAnswer.length > 0
        : currentAnswer.trim().length > 0

    const handleAnswer = (value: AnswerValue) => {
        setAnswers((prev) => ({
            ...prev,
            [currentQuestion.id]: value,
        }))
    }

    const toggleMultiAnswer = (option: string) => {
        setAnswers((prev) => {
            const existingAnswer = prev[currentQuestion.id]
            const selectedOptions = Array.isArray(existingAnswer) ? existingAnswer : []
            const nextOptions = selectedOptions.includes(option)
                ? selectedOptions.filter((selectedOption) => selectedOption !== option)
                : [...selectedOptions, option]

            return {
                ...prev,
                [currentQuestion.id]: nextOptions,
            }
        })
    }

    const handleMultiCustomAnswer = (value: string) => {
        const previousCustomAnswer = customAnswers[currentQuestion.id]

        setCustomAnswers((prev) => ({
            ...prev,
            [currentQuestion.id]: value,
        }))

        setAnswers((prev) => {
            const existingAnswer = prev[currentQuestion.id]
            const selectedOptions = Array.isArray(existingAnswer) ? existingAnswer : []
            const withoutPreviousCustomAnswer = previousCustomAnswer
                ? selectedOptions.filter((option) => option !== previousCustomAnswer)
                : selectedOptions
            const nextOptions = value.trim()
                ? [...withoutPreviousCustomAnswer, value]
                : withoutPreviousCustomAnswer

            return {
                ...prev,
                [currentQuestion.id]: nextOptions,
            }
        })
    }

    const handleNext = () => {
        if (!hasCurrentAnswer) return

        if (currentIndex < questionList.length - 1) {
            setCurrentIndex((prev) => prev + 1)
        } else {
            onComplete(answers)
            console.log(answers)
        }
    }

    const handlePrevious = () => {
        if (currentIndex > 0) {
            setCurrentIndex((prev) => prev - 1)
        }
    }

    return (
        <div className="w-full max-w-xl mx-auto mt-8">

            {/* Progress */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">
                        Question {currentIndex + 1} of {questionList.length}
                    </span>

                    <span className="text-sm font-medium">
                        {Math.round(((currentIndex + 1) / questionList.length) * 100)}%
                    </span>
                </div>

                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                            width: `${((currentIndex + 1) / questionList.length) * 100}%`,
                        }}
                    />
                </div>
            </div>

            {/* Question */}
            <div className="min-h-[280px]">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Help me understand your request
                </p>

                <h2 className="text-xl font-semibold mb-6">
                    {currentQuestion.question}
                </h2>

                {/* Text Question */}
                {currentQuestion.type === "text" && (
                    <Input
                        autoFocus
                        value={currentTextAnswer}
                        placeholder={currentQuestion.customPlaceholder || "Enter your answer"}
                        onChange={(e) => handleAnswer(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && hasCurrentAnswer) {
                                handleNext()
                            }
                        }}
                        className="h-12"
                    />
                )}

                {/* Single Select Question */}
                {currentQuestion.type === "single_select" && (
                    <div className="space-y-2">
                        {currentQuestion.options.map((option) => {
                            const selected =
                                currentTextAnswer === option &&
                                !customMode[currentQuestion.id]

                            return (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                        setCustomMode((prev) => ({
                                            ...prev,
                                            [currentQuestion.id]: false,
                                        }))

                                        handleAnswer(option)
                                    }}
                                    className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${selected
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        }`}
                                >
                                    <span className="text-sm font-medium">
                                        {option}
                                    </span>

                                    {selected && (
                                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Check className="h-3 w-3" />
                                        </div>
                                    )}
                                </button>
                            )
                        })}

                        {/* Custom Option */}
                        {currentQuestion.allowCustom && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCustomMode((prev) => ({
                                            ...prev,
                                            [currentQuestion.id]: true,
                                        }))

                                        handleAnswer("")
                                    }}
                                    className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${customMode[currentQuestion.id]
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        }`}
                                >
                                    <span className="text-sm font-medium">
                                        Other / Custom
                                    </span>

                                    {customMode[currentQuestion.id] && (
                                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Check className="h-3 w-3" />
                                        </div>
                                    )}
                                </button>

                                {customMode[currentQuestion.id] && (
                                    <Input
                                        autoFocus
                                        value={currentTextAnswer}
                                        placeholder={
                                            currentQuestion.customPlaceholder ||
                                            "Enter custom answer"
                                        }
                                        onChange={(e) =>
                                            handleAnswer(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === "Enter" &&
                                                hasCurrentAnswer
                                            ) {
                                                handleNext()
                                            }
                                        }}
                                        className="h-12 mt-3"
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Multi Select Question */}
                {currentQuestion.type === "multi_select" && (
                    <div className="space-y-2">
                        {currentQuestion.options.map((option) => {
                            const selected = currentMultiAnswer.includes(option)

                            return (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => toggleMultiAnswer(option)}
                                    className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${selected
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        }`}
                                >
                                    <span className="text-sm font-medium">
                                        {option}
                                    </span>

                                    <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${selected
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-muted-foreground/40"
                                        }`}>
                                        {selected && <Check className="h-3 w-3" />}
                                    </div>
                                </button>
                            )
                        })}

                        {/* Custom Option */}
                        {currentQuestion.allowCustom && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const nextCustomMode = !customMode[currentQuestion.id]

                                        setCustomMode((prev) => ({
                                            ...prev,
                                            [currentQuestion.id]: nextCustomMode,
                                        }))

                                        if (!nextCustomMode) {
                                            handleMultiCustomAnswer("")
                                        }
                                    }}
                                    className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${customMode[currentQuestion.id]
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        }`}
                                >
                                    <span className="text-sm font-medium">
                                        Other / Custom
                                    </span>

                                    <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${customMode[currentQuestion.id]
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-muted-foreground/40"
                                        }`}>
                                        {customMode[currentQuestion.id] && <Check className="h-3 w-3" />}
                                    </div>
                                </button>

                                {customMode[currentQuestion.id] && (
                                    <Input
                                        autoFocus
                                        value={customAnswers[currentQuestion.id] || ""}
                                        placeholder={
                                            currentQuestion.customPlaceholder ||
                                            "Enter custom answer"
                                        }
                                        onChange={(e) =>
                                            handleMultiCustomAnswer(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === "Enter" &&
                                                hasCurrentAnswer
                                            ) {
                                                handleNext()
                                            }
                                        }}
                                        className="h-12 mt-3"
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between border-t pt-5 mt-6">
                <Button
                    variant="ghost"
                    onClick={handlePrevious}
                    disabled={currentIndex === 0}
                    className="gap-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Previous
                </Button>

                <Button
                    onClick={handleNext}
                    disabled={!hasCurrentAnswer}
                    className="gap-2"
                >
                    {currentIndex === questionList.length - 1 ? (
                        <>
                            Continue
                            <Check className="h-4 w-4" />
                        </>
                    ) : (
                        <>
                            Next
                            <ArrowRight className="h-4 w-4" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
