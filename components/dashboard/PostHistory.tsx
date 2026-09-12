"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Instagram, Youtube, Film, RotateCw, ExternalLink } from "lucide-react"
import { toast } from "sonner"

type Target = {
    id: string
    platform: "instagram" | "youtube"
    status: "pending" | "processing" | "published" | "failed"
    permalink: string | null
    error_message: string | null
    privacy: string | null
}

export type PostJobRow = {
    id: string
    title: string | null
    caption: string | null
    created_at: string
    post_targets: Target[]
}

interface PostHistoryProps {
    jobs: PostJobRow[]
    loading: boolean
    onRefresh?: () => void
}

const TICK_INTERVAL_MS = 4000

export function PostHistory({ jobs, loading, onRefresh }: PostHistoryProps) {
    const [resuming, setResuming] = useState<string | null>(null)

    /**
     * Publishing is driven by the browser polling /api/post/tick, so closing
     * the tab mid-publish leaves a job parked at `processing`. This picks it
     * back up from wherever it stopped — both publishers are resumable, so
     * nothing is re-uploaded or double-posted.
     */
    const resume = async (jobId: string) => {
        setResuming(jobId)
        try {
            while (true) {
                const res = await fetch("/api/post/tick", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId }),
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || "Could not resume")
                if (data.done) break
                await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS))
            }
            toast.success("Finished publishing")
            onRefresh?.()
        } catch (err: any) {
            toast.error(err.message || "Could not resume")
        } finally {
            setResuming(null)
        }
    }

    return (
        <Card className="bg-white/5 border-white/10">
            <CardHeader>
                <CardTitle className="text-lg text-white">Recent posts</CardTitle>
            </CardHeader>

            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
                    </div>
                ) : jobs.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <Film className="w-6 h-6 text-neutral-600" />
                        <p className="text-sm text-neutral-500">Nothing posted yet.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {jobs.map((job) => (
                            <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-white">
                                        {job.title || job.caption || "Untitled"}
                                    </p>
                                    <p className="text-xs text-neutral-500">
                                        {new Date(job.created_at).toLocaleString()}
                                    </p>
                                </div>

                                {/* One row per platform, named. An icon alone left it
                                    unclear which platform a status belonged to, and made
                                    the permalink look unclickable. */}
                                <div className="mt-2 space-y-1.5">
                                    {job.post_targets?.map((target) => (
                                        <TargetRow key={target.id} target={target} />
                                    ))}
                                </div>

                                {job.post_targets?.some(
                                    (t) => t.status === "pending" || t.status === "processing",
                                ) && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={resuming === job.id}
                                        onClick={() => resume(job.id)}
                                        className="mt-2 h-7 border-white/15 text-xs"
                                    >
                                        {resuming === job.id ? (
                                            <>
                                                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                                Finishing…
                                            </>
                                        ) : (
                                            <>
                                                <RotateCw className="mr-1.5 h-3 w-3" />
                                                Resume
                                            </>
                                        )}
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const STATUS_STYLES: Record<Target["status"], string> = {
    published: "border-emerald-500/30 text-emerald-400",
    failed: "border-red-500/30 text-red-400",
    processing: "border-amber-500/30 text-amber-400",
    pending: "border-white/20 text-neutral-400",
}

const PLATFORM_LABEL: Record<Target["platform"], string> = {
    instagram: "Instagram Reel",
    youtube: "YouTube",
}

function TargetRow({ target }: { target: Target }) {
    const Icon = target.platform === "instagram" ? Instagram : Youtube

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                    target.platform === "instagram" ? "text-pink-500" : "text-red-500"
                }`}
            />
            <span className="text-neutral-300">{PLATFORM_LABEL[target.platform]}</span>

            <Badge variant="outline" className={STATUS_STYLES[target.status]}>
                <span className="capitalize">{target.status}</span>
            </Badge>

            {target.platform === "youtube" && target.privacy && (
                <span className="text-[10px] capitalize text-neutral-500">{target.privacy}</span>
            )}

            {target.permalink && (
                <a
                    href={target.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-neutral-400 underline underline-offset-2 hover:text-white"
                >
                    View
                    <ExternalLink className="h-3 w-3" />
                </a>
            )}

            {target.status === "failed" && target.error_message && (
                <p className="w-full break-words text-red-400/90">{target.error_message}</p>
            )}
        </div>
    )
}
