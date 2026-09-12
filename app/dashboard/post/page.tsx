"use client"

import { useCallback, useEffect, useState } from "react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { PostComposer } from "@/components/dashboard/PostComposer"
import { PostHistory, type PostJobRow } from "@/components/dashboard/PostHistory"
import { YouTubeConnect, type YouTubeStatus } from "@/components/dashboard/YouTubeConnect"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Instagram, CheckCircle2 } from "lucide-react"

export default function PostPage() {
    const { userId, isLoading } = useInstagramSession()

    const [youtube, setYoutube] = useState<YouTubeStatus | null>(null)
    const [youtubeLoading, setYoutubeLoading] = useState(true)
    const [jobs, setJobs] = useState<PostJobRow[]>([])
    const [jobsLoading, setJobsLoading] = useState(true)

    const loadYouTube = useCallback(async () => {
        setYoutubeLoading(true)
        try {
            const res = await fetch("/api/youtube/status")
            setYoutube(res.ok ? await res.json() : { connected: false })
        } catch {
            setYoutube({ connected: false })
        } finally {
            setYoutubeLoading(false)
        }
    }, [])

    const loadJobs = useCallback(async () => {
        setJobsLoading(true)
        try {
            const res = await fetch("/api/post?limit=20")
            const data = await res.json()
            setJobs(res.ok ? data.jobs ?? [] : [])
        } catch {
            setJobs([])
        } finally {
            setJobsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!userId) return
        loadYouTube()
        loadJobs()
    }, [userId, loadYouTube, loadJobs])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-white/20" />
            </div>
        )
    }

    if (!userId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-4">
                <h2 className="text-xl font-semibold text-white mb-2">Login required</h2>
                <p className="text-neutral-400">Connect your Instagram account to post.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 pb-20">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-white">Post</h1>
                <p className="text-neutral-400">
                    Upload one video and send it to Instagram and YouTube in a single pass.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <PostComposer youtube={youtube} onPosted={loadJobs} />
                    <PostHistory jobs={jobs} loading={jobsLoading} />
                </div>

                <div className="lg:col-span-1">
                    <div className="sticky top-6 space-y-4">
                        <Card className="bg-white/5 border-white/10">
                            <CardContent className="p-4 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-pink-600/15 border border-pink-600/30 flex items-center justify-center">
                                    <Instagram className="w-5 h-5 text-pink-500" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-white">Instagram</p>
                                    <p className="text-xs text-neutral-400">Signed in</p>
                                </div>
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Ready
                                </Badge>
                            </CardContent>
                        </Card>

                        <YouTubeConnect
                            status={youtube}
                            loading={youtubeLoading}
                            onChange={loadYouTube}
                        />

                        <Card className="bg-white/5 border-white/10">
                            <CardContent className="p-4 space-y-2 text-xs text-neutral-400">
                                <p className="text-sm font-semibold text-white">Daily limits</p>
                                <p>• Instagram: 25 API posts per rolling 24 hours.</p>
                                <p>• YouTube: 100 uploads per day on the default quota.</p>
                                <p>• Both platforms treat rapid identical posting as spam — a couple a day is well inside normal.</p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}
