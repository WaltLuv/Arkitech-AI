/**
 * Watch page for one browser run.
 */
import { BrowserWatch } from "@/components/custom/browser/BrowserWatch"

export default async function BrowserRunPage({ params }: { params: Promise<{ browserRunId: string }> }) {
    const { browserRunId } = await params

    return (
        <div className="w-full flex justify-center">
            <div className="w-full max-w-5xl px-4 sm:px-6 pt-12 pb-16">
                <BrowserWatch browserRunId={browserRunId} />
            </div>
        </div>
    )
}
