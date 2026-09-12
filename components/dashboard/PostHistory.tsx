"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Instagram, Youtube, Film } from "lucide-react"

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
}

export function PostHistory({ jobs, loading }: PostHistoryProps) {
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
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-white truncate">
                                            {job.title || job.caption || "Untitled"}
                                        </p>
                                        <p className="text-xs text-neutral-500">
                                            {new Date(job.created_at).toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5 shrink-0">
                                        {job.post_targets?.map((target) => (
                                            <TargetBadge key={target.id} target={target} />
                                        ))}
                                    </div>
                                </div>

                                {job.post_targets
                                    ?.filter((target) => target.status === "failed" && target.error_message)
                                    .map((target) => (
                                        <p key={target.id} className="mt-1.5 text-xs text-red-400/80 break-words">
                                            {target.platform}: {target.error_message}
                                        </p>
                                    ))}
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

function TargetBadge({ target }: { target: Target }) {
    const Icon = target.platform === "instagram" ? Instagram : Youtube
    const label =
        target.status === "published" && target.platform === "youtube" && target.privacy
            ? target.privacy
            : target.status

    const content = (
        <Badge variant="outline" className={`gap-1 ${STATUS_STYLES[target.status]}`}>
            <Icon className="w-3 h-3" />
            <span className="capitalize">{label}</span>
        </Badge>
    )

    if (!target.permalink) return content

    return (
        <a href={target.permalink} target="_blank" rel="noreferrer" title="Open post">
            {content}
        </a>
    )
}
