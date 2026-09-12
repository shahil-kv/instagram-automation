"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2, Upload, Film, Instagram, Youtube, CheckCircle2, XCircle, X } from "lucide-react"
import { toast } from "sonner"
import type { YouTubeStatus } from "./YouTubeConnect"

/** How often we ask the server to advance the post. */
const TICK_INTERVAL_MS = 4000

/**
 * PUT the file to a pre-signed Storage URL via XHR.
 *
 * fetch() cannot report request upload progress, and supabase-js upload()
 * exposes none either — XHR's upload.onprogress is the only way to drive a
 * real bar.
 */
function uploadWithProgress(
    uploadUrl: string,
    file: File,
    onProgress: (percent: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", uploadUrl, true)
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4")

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
            }
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress(100)
                resolve()
            } else {
                reject(new Error(`Storage upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`))
            }
        }
        xhr.onerror = () => reject(new Error("Network error while uploading to storage"))
        xhr.onabort = () => reject(new Error("Upload cancelled"))

        xhr.send(file)
    })
}

type Platform = "instagram" | "youtube"

type TargetRow = {
    platform: Platform
    status: "pending" | "processing" | "published" | "failed"
    permalink: string | null
    error_message: string | null
    privacy: string | null
}

interface PostComposerProps {
    youtube: YouTubeStatus | null
    onPosted: () => void
}

export function PostComposer({ youtube, onPosted }: PostComposerProps) {
    const [file, setFile] = useState<File | null>(null)
    const [title, setTitle] = useState("")
    const [caption, setCaption] = useState("")
    const [platforms, setPlatforms] = useState<Platform[]>(["instagram"])
    const [privacy, setPrivacy] = useState("private")

    const [phase, setPhase] = useState<"idle" | "uploading" | "publishing" | "done">("idle")
    const [uploadPercent, setUploadPercent] = useState(0)
    const [targets, setTargets] = useState<TargetRow[]>([])
    const [notes, setNotes] = useState<Record<string, string>>({})
    const [platformProgress, setPlatformProgress] = useState<Record<string, number>>({})
    const inputRef = useRef<HTMLInputElement>(null)

    const busy = phase === "uploading" || phase === "publishing"

    const toggle = (platform: Platform) => {
        setPlatforms((current) =>
            current.includes(platform)
                ? current.filter((p) => p !== platform)
                : [...current, platform],
        )
    }

    const reset = () => {
        setFile(null)
        setTitle("")
        setCaption("")
        setUploadPercent(0)
        setTargets([])
        setNotes({})
        setPlatformProgress({})
        setPhase("idle")
        if (inputRef.current) inputRef.current.value = ""
    }

    /** Poll /api/post/tick until every platform reaches a terminal state. */
    const runToCompletion = async (jobId: string) => {
        while (true) {
            const res = await fetch("/api/post/tick", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId }),
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Publishing failed")

            setTargets(data.targets ?? [])
            setNotes(data.notes ?? {})
            // Keep the last known percent for platforms that report one, so the
            // bar never snaps back to 0 between ticks.
            setPlatformProgress((current) => ({ ...current, ...(data.progress ?? {}) }))

            if (data.done) return data.targets as TargetRow[]
            await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS))
        }
    }

    const submit = async () => {
        if (!file) return toast.error("Choose a video first")
        if (platforms.length === 0) return toast.error("Pick at least one platform")
        if (platforms.includes("youtube") && !youtube?.connected) {
            return toast.error("Connect a YouTube channel first")
        }

        setPhase("uploading")
        setUploadPercent(0)

        try {
            // 1. Ask the server to sign a one-shot upload URL, then PUT the file
            //    straight to Storage. Both publishers read it back from the public
            //    URL, so the bytes never pass through an API route.
            const signRes = await fetch("/api/post/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileName: file.name }),
            })

            const signed = await signRes.json()
            if (!signRes.ok) throw new Error(signed.error || "Could not start the upload")

            await uploadWithProgress(signed.uploadUrl, file, setUploadPercent)
            const publicUrl = signed.publicUrl as string

            // 2. Register the post and its targets.
            const createRes = await fetch("/api/post", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    videoUrl: publicUrl,
                    title: title || file.name.replace(/\.[^/.]+$/, ""),
                    caption,
                    platforms,
                    privacy,
                }),
            })

            const created = await createRes.json()
            if (!createRes.ok) throw new Error(created.error || "Could not create the post")

            setTargets(created.targets ?? [])
            setPhase("publishing")

            // 3. Drive it to completion.
            const finished = await runToCompletion(created.jobId)
            setPhase("done")
            onPosted()

            const failed = finished.filter((t) => t.status === "failed")
            if (failed.length === 0) {
                toast.success("Posted to every selected platform")
            } else if (failed.length === finished.length) {
                toast.error("Posting failed everywhere — see the details below")
            } else {
                toast.warning(`Posted, but ${failed.map((t) => t.platform).join(" and ")} failed`)
            }
        } catch (error: any) {
            console.error("[PostComposer]", error)
            toast.error(error.message || "Something went wrong")
            setPhase(targets.length > 0 ? "done" : "idle")
        }
    }

    return (
        <Card className="bg-white/5 border-white/10">
            <CardHeader>
                <CardTitle className="text-lg text-white">New post</CardTitle>
            </CardHeader>

            <CardContent className="space-y-5">
                {/* Video picker */}
                <div>
                    <Label className="text-xs uppercase tracking-wider text-neutral-500">Video</Label>
                    <label
                        className={`mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                            busy
                                ? "border-white/10 cursor-not-allowed opacity-60"
                                : "border-white/20 hover:border-white/40 cursor-pointer"
                        }`}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept="video/mp4,video/quicktime"
                            className="hidden"
                            disabled={busy}
                            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                        />
                        {file ? (
                            <>
                                <Film className="w-6 h-6 text-white" />
                                <p className="text-sm text-white font-medium break-all">{file.name}</p>
                                <p className="text-xs text-neutral-500">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </p>
                            </>
                        ) : (
                            <>
                                <Upload className="w-6 h-6 text-neutral-500" />
                                <p className="text-sm text-neutral-400">Choose an MP4 or MOV</p>
                                <p className="text-xs text-neutral-600">
                                    Instagram Reels: 3s–15min, up to 1 GB
                                </p>
                            </>
                        )}
                    </label>
                </div>

                {/* Text */}
                <div className="space-y-3">
                    <div>
                        <Label htmlFor="post-title" className="text-xs uppercase tracking-wider text-neutral-500">
                            Title <span className="normal-case tracking-normal">(YouTube only)</span>
                        </Label>
                        <Input
                            id="post-title"
                            value={title}
                            disabled={busy}
                            maxLength={100}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Defaults to the file name"
                            className="mt-2"
                        />
                    </div>
                    <div>
                        <Label htmlFor="post-caption" className="text-xs uppercase tracking-wider text-neutral-500">
                            Caption <span className="normal-case tracking-normal">(IG caption / YouTube description)</span>
                        </Label>
                        <Textarea
                            id="post-caption"
                            value={caption}
                            disabled={busy}
                            rows={4}
                            onChange={(event) => setCaption(event.target.value)}
                            placeholder="Write once, goes to both."
                            className="mt-2 resize-none"
                        />
                    </div>
                </div>

                {/* Targets */}
                <div className="space-y-3">
                    <Label className="text-xs uppercase tracking-wider text-neutral-500">Post to</Label>

                    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
                        <Checkbox
                            id="target-instagram"
                            checked={platforms.includes("instagram")}
                            disabled={busy}
                            onCheckedChange={() => toggle("instagram")}
                        />
                        <Instagram className="w-4 h-4 text-pink-500" />
                        <Label htmlFor="target-instagram" className="flex-1 text-sm text-white cursor-pointer">
                            Instagram Reel
                        </Label>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-3">
                        <div className="flex items-center gap-3">
                            <Checkbox
                                id="target-youtube"
                                checked={platforms.includes("youtube")}
                                disabled={busy || !youtube?.connected}
                                onCheckedChange={() => toggle("youtube")}
                            />
                            <Youtube className="w-4 h-4 text-red-500" />
                            <Label htmlFor="target-youtube" className="flex-1 text-sm text-white cursor-pointer">
                                YouTube
                                {!youtube?.connected && (
                                    <span className="ml-2 text-xs text-neutral-500">— connect a channel first</span>
                                )}
                            </Label>
                        </div>

                        {platforms.includes("youtube") && (
                            <div className="pl-8 space-y-2">
                                <Select value={privacy} onValueChange={setPrivacy} disabled={busy}>
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="private">Private</SelectItem>
                                        <SelectItem value="unlisted">Unlisted</SelectItem>
                                        <SelectItem value="public">Public</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-amber-400/80">
                                    YouTube forces uploads to private until your API project passes its
                                    compliance audit — unlisted and public only take effect after that.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Progress */}
                {phase === "uploading" && (
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-neutral-400">
                            <span>Uploading to storage…</span>
                            <span className="tabular-nums">{uploadPercent}%</span>
                        </div>
                        <Progress value={uploadPercent} className="h-1.5" />
                    </div>
                )}

                {targets.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
                        {targets.map((target) => (
                            <TargetRowView
                                key={target.platform}
                                target={target}
                                note={notes[target.platform]}
                                progress={platformProgress[target.platform]}
                            />
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                    <Button onClick={submit} disabled={busy || !file} className="flex-1">
                        {busy ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                {phase === "uploading" ? "Uploading…" : "Publishing…"}
                            </>
                        ) : (
                            "Post now"
                        )}
                    </Button>
                    {(file || targets.length > 0) && !busy && (
                        <Button variant="ghost" onClick={reset} className="text-neutral-400">
                            <X className="w-4 h-4 mr-1" />
                            Clear
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

function TargetRowView({
    target,
    note,
    progress,
}: {
    target: TargetRow
    note?: string
    progress?: number
}) {
    const Icon = target.platform === "instagram" ? Instagram : Youtube
    const working = target.status === "pending" || target.status === "processing"

    return (
        <div className="space-y-1.5">
        <div className="flex items-center gap-3 text-sm">
            <Icon
                className={`w-4 h-4 shrink-0 ${
                    target.platform === "instagram" ? "text-pink-500" : "text-red-500"
                }`}
            />
            <span className="capitalize text-neutral-300 w-20 shrink-0">{target.platform}</span>

            <div className="flex-1 min-w-0">
                {target.status === "published" && (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Published
                        {target.privacy && target.platform === "youtube" && (
                            <span className="text-neutral-500">({target.privacy})</span>
                        )}
                    </span>
                )}
                {target.status === "failed" && (
                    <span className="flex items-start gap-1.5 text-red-400">
                        <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="break-words">{target.error_message || "Failed"}</span>
                    </span>
                )}
                {(target.status === "pending" || target.status === "processing") && (
                    <span className="flex items-center gap-1.5 text-neutral-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {note || "Working…"}
                    </span>
                )}
            </div>

            {target.permalink && (
                <a
                    href={target.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-400 underline hover:text-white shrink-0"
                >
                    View
                </a>
            )}
        </div>

        {/* YouTube reports real byte progress; Instagram transcodes opaquely,
            so it only ever gets the indeterminate spinner above. */}
        {working && progress !== undefined && (
            <div className="pl-7 flex items-center gap-2">
                <Progress value={progress} className="h-1 flex-1" />
                <span className="text-[10px] tabular-nums text-neutral-500 w-8 text-right">
                    {progress}%
                </span>
            </div>
        )}
        </div>
    )
}
