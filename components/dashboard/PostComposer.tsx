"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Loader2,
    Upload,
    Film,
    Instagram,
    Youtube,
    CheckCircle2,
    XCircle,
    X,
    AlertTriangle,
    Circle,
} from "lucide-react"
import { toast } from "sonner"
import {
    buildInstagramCaption,
    buildYouTubeFields,
    instagramFirstLine,
    IG_CAPTION_MAX,
    TITLE_MAX,
} from "@/lib/publishers/captions"
import type { YouTubeStatus } from "./YouTubeConnect"

/** How often we ask the server to advance the post. */
const TICK_INTERVAL_MS = 4000

/** Instagram Reels must be between 3 seconds and 15 minutes. */
const REEL_MIN_SECONDS = 3
const REEL_MAX_SECONDS = 15 * 60

/** The theme's default input border is invisible on black. */
const FIELD_CLASS = "mt-2 border-white/15 bg-black/40 text-white placeholder:text-neutral-600"

type Platform = "instagram" | "youtube"

type TargetRow = {
    platform: Platform
    status: "pending" | "processing" | "published" | "failed"
    permalink: string | null
    error_message: string | null
    privacy: string | null
}

/**
 * The publish steps each platform actually goes through, in order.
 *
 * They differ because the APIs differ: Instagram fetches the video from our
 * public URL itself (so there is no upload percentage), while YouTube needs
 * the bytes pushed to it in chunks (so there is).
 */
const STEPS: Record<Platform, { stage: string; label: string }[]> = {
    instagram: [
        { stage: "ig_container", label: "Handing the video to Instagram" },
        { stage: "ig_transcoding", label: "Instagram transcoding" },
        { stage: "ig_publishing", label: "Publishing Reel" },
    ],
    youtube: [
        { stage: "yt_session", label: "Opening upload session" },
        { stage: "yt_uploading", label: "Uploading video" },
        { stage: "yt_processing", label: "YouTube processing" },
    ],
}

function formatMb(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(seconds: number) {
    const whole = Math.round(seconds)
    const mins = Math.floor(whole / 60)
    const secs = whole % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

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

interface PostComposerProps {
    youtube: YouTubeStatus | null
    onPosted: () => void
}

export function PostComposer({ youtube, onPosted }: PostComposerProps) {
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null)

    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [platforms, setPlatforms] = useState<Platform[]>(["instagram"])
    const [privacy, setPrivacy] = useState("private")

    const [phase, setPhase] = useState<"idle" | "uploading" | "publishing" | "done">("idle")
    const [uploadPercent, setUploadPercent] = useState(0)
    const [targets, setTargets] = useState<TargetRow[]>([])
    const [notes, setNotes] = useState<Record<string, string>>({})
    const [platformProgress, setPlatformProgress] = useState<Record<string, number>>({})
    const [platformStage, setPlatformStage] = useState<Record<string, string>>({})
    const [maxBytes, setMaxBytes] = useState<number | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const busy = phase === "uploading" || phase === "publishing"

    // The storage ceiling depends on the Supabase plan, so read it rather than
    // hardcode it — and read it before a file is chosen, not after a failed upload.
    useEffect(() => {
        let cancelled = false
        fetch("/api/post/upload-url")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled && data?.maxBytes) setMaxBytes(data.maxBytes)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [])

    // Object URLs leak until revoked, so tie one to the selected file's lifetime.
    useEffect(() => {
        if (!file) {
            setPreviewUrl(null)
            setMeta(null)
            return
        }
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
        setMeta(null)
        return () => URL.revokeObjectURL(url)
    }, [file])

    // Exactly what each platform will receive, built with the same functions
    // the publishers use, so the preview cannot drift from what gets posted.
    const igCaption = buildInstagramCaption({ title, description })
    const ytFields = buildYouTubeFields({ title, description })

    const oversize = maxBytes !== null && file !== null && file.size > maxBytes

    const reelWarning = !meta
        ? null
        : meta.duration < REEL_MIN_SECONDS
          ? `Instagram needs at least ${REEL_MIN_SECONDS}s — this clip is ${formatDuration(meta.duration)}.`
          : meta.duration > REEL_MAX_SECONDS
            ? `Instagram caps Reels at 15min — this clip is ${formatDuration(meta.duration)}.`
            : null

    const toggle = (platform: Platform) => {
        setPlatforms((current) =>
            current.includes(platform)
                ? current.filter((p) => p !== platform)
                : [...current, platform],
        )
    }

    const reset = () => {
        setFile(null)
        setMeta(null)
        setTitle("")
        setDescription("")
        setUploadPercent(0)
        setTargets([])
        setNotes({})
        setPlatformProgress({})
        setPlatformStage({})
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
            // Merge rather than replace: a tick only reports the platforms it
            // advanced, so the bar never snaps back between ticks.
            setPlatformProgress((current) => ({ ...current, ...(data.progress ?? {}) }))
            setPlatformStage((current) => ({ ...current, ...(data.stages ?? {}) }))

            if (data.done) return data.targets as TargetRow[]
            await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS))
        }
    }

    const submit = async () => {
        if (!file) return toast.error("Choose a video first")
        if (oversize && maxBytes !== null) {
            return toast.error(
                `This video is ${formatMb(file.size)} but storage accepts at most ${formatMb(maxBytes)}. Compress it first.`,
            )
        }
        if (platforms.length === 0) return toast.error("Pick at least one platform")
        if (platforms.includes("youtube") && !youtube?.connected) {
            return toast.error("Connect a YouTube channel first")
        }
        if (platforms.includes("youtube") && !title.trim()) {
            return toast.error("YouTube requires a title")
        }
        if (platforms.includes("instagram") && igCaption.length > IG_CAPTION_MAX) {
            return toast.error(
                `Instagram allows ${IG_CAPTION_MAX} caption characters — trim ${igCaption.length - IG_CAPTION_MAX}`,
            )
        }
        if (reelWarning && platforms.includes("instagram")) {
            return toast.error(reelWarning)
        }

        setPhase("uploading")
        setUploadPercent(0)

        try {
            // 1. Sign a one-shot upload URL, then PUT straight to Storage. Both
            //    publishers read it back from the public URL, so the bytes never
            //    pass through an API route.
            const signRes = await fetch("/api/post/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
            })

            const signed = await signRes.json()
            if (!signRes.ok) throw new Error(signed.error || "Could not start the upload")

            await uploadWithProgress(signed.uploadUrl, file, setUploadPercent)

            // 2. Register the post and its targets. `caption` is the DB column
            //    that holds the description; the publishers shape it per platform.
            const createRes = await fetch("/api/post", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    videoUrl: signed.publicUrl,
                    title: title.trim() || file.name.replace(/\.[^/.]+$/, ""),
                    caption: description,
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
                {/* Video */}
                <div>
                    <Label className="text-xs uppercase tracking-wider text-neutral-500">Video</Label>

                    {/* One hidden input drives both the dropzone and Replace. */}
                    <input
                        ref={inputRef}
                        type="file"
                        accept="video/mp4,video/quicktime"
                        className="hidden"
                        disabled={busy}
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />

                    {file && previewUrl ? (
                        <div className="mt-2 space-y-2">
                            <div className="rounded-xl border border-white/15 bg-black/60 overflow-hidden">
                                <video
                                    key={previewUrl}
                                    src={previewUrl}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    onLoadedMetadata={(event) => {
                                        const el = event.currentTarget
                                        setMeta({
                                            duration: el.duration,
                                            width: el.videoWidth,
                                            height: el.videoHeight,
                                        })
                                    }}
                                    className="w-full max-h-80 bg-black"
                                />
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                                <Film className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                <span className="text-white truncate">{file.name}</span>
                                <span className="text-neutral-500 shrink-0">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                    {meta && ` · ${formatDuration(meta.duration)} · ${meta.width}×${meta.height}`}
                                </span>
                                {!busy && (
                                    <button
                                        type="button"
                                        onClick={() => inputRef.current?.click()}
                                        className="ml-auto shrink-0 text-neutral-400 underline hover:text-white"
                                    >
                                        Replace
                                    </button>
                                )}
                            </div>

                            {oversize && maxBytes !== null && (
                                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-1">
                                    <p className="flex gap-2 text-xs font-medium text-red-400">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                        Too large for storage — {formatMb(file.size)} against a{" "}
                                        {formatMb(maxBytes)} limit.
                                    </p>
                                    <p className="pl-5 text-xs text-neutral-400">
                                        Compress it below {formatMb(maxBytes)}, or raise the cap by
                                        upgrading the Supabase plan. Instagram needs the file at a public
                                        URL, so it has to be staged somewhere either way.
                                    </p>
                                </div>
                            )}

                            {reelWarning && platforms.includes("instagram") && (
                                <p className="flex gap-2 text-xs text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    {reelWarning}
                                </p>
                            )}
                        </div>
                    ) : (
                        <label
                            className={`mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                                busy
                                    ? "border-white/10 cursor-not-allowed opacity-60"
                                    : "border-white/20 hover:border-white/40 cursor-pointer"
                            }`}
                            onClick={() => inputRef.current?.click()}
                        >
                            <Upload className="w-6 h-6 text-neutral-500" />
                            <p className="text-sm text-neutral-400">Choose an MP4 or MOV</p>
                            <p className="text-xs text-neutral-600">
                                3s–15min
                                {maxBytes !== null && ` · up to ${formatMb(maxBytes)}`}
                            </p>
                        </label>
                    )}
                </div>

                {/* Text */}
                <div className="space-y-3">
                    <div>
                        <Label htmlFor="post-title" className="text-xs uppercase tracking-wider text-neutral-500">
                            Title
                        </Label>
                        <Input
                            id="post-title"
                            value={title}
                            disabled={busy}
                            maxLength={TITLE_MAX}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="How I built a FREE image translator for 200k+ products"
                            className={FIELD_CLASS}
                        />
                        <p className="mt-1 flex justify-between text-[10px] text-neutral-600">
                            <span>YouTube title · Instagram&apos;s first line</span>
                            <span className="tabular-nums">
                                {title.length}/{TITLE_MAX}
                            </span>
                        </p>
                    </div>

                    <div>
                        <Label htmlFor="post-description" className="text-xs uppercase tracking-wider text-neutral-500">
                            Description
                        </Label>
                        <Textarea
                            id="post-description"
                            value={description}
                            disabled={busy}
                            rows={8}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder={"What the video is about, the call to action, then your hashtags."}
                            className={`${FIELD_CLASS} resize-y`}
                        />
                        <p className="mt-1 text-[10px] text-neutral-600">
                            YouTube description · appended under the title for Instagram
                        </p>
                    </div>
                </div>

                {/* Per-platform preview — the gap between "what I typed" and
                    "what each platform gets" is where cross-posting goes wrong. */}
                {(title || description) && (
                    <div>
                        <Label className="text-xs uppercase tracking-wider text-neutral-500">
                            What each platform receives
                        </Label>
                        <Tabs defaultValue="instagram" className="mt-2">
                            <TabsList className="bg-black/40 border border-white/10">
                                <TabsTrigger value="instagram" className="text-xs gap-1.5">
                                    <Instagram className="w-3.5 h-3.5" />
                                    Instagram
                                </TabsTrigger>
                                <TabsTrigger value="youtube" className="text-xs gap-1.5">
                                    <Youtube className="w-3.5 h-3.5" />
                                    YouTube
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="instagram" className="mt-2">
                                <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                                        Single caption — title and description merged
                                    </p>
                                    <p className="whitespace-pre-wrap break-words text-xs text-neutral-200">
                                        {igCaption || "—"}
                                    </p>
                                    <div className="flex justify-between border-t border-white/5 pt-2 text-[10px]">
                                        <span className="text-neutral-500 truncate pr-2">
                                            Before the fold: {instagramFirstLine({ title, description }) || "—"}
                                        </span>
                                        <span
                                            className={`tabular-nums shrink-0 ${
                                                igCaption.length > IG_CAPTION_MAX ? "text-red-400" : "text-neutral-600"
                                            }`}
                                        >
                                            {igCaption.length}/{IG_CAPTION_MAX}
                                        </span>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="youtube" className="mt-2">
                                <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-3">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-neutral-500">Title</p>
                                        <p className="break-words text-xs font-medium text-white">
                                            {ytFields.title}
                                        </p>
                                    </div>
                                    <div className="border-t border-white/5 pt-2">
                                        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                                            Description
                                        </p>
                                        <p className="whitespace-pre-wrap break-words text-xs text-neutral-200">
                                            {ytFields.description || "—"}
                                        </p>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}

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
                                    <SelectTrigger className="h-9 text-sm border-white/15 bg-black/40">
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

                {/* Live progress */}
                {(busy || targets.length > 0) && (
                    <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-3">
                        <StepRow
                            label="Uploading to storage"
                            state={phase === "uploading" ? "active" : "done"}
                            progress={phase === "uploading" ? uploadPercent : 100}
                        />

                        {targets.map((target) => (
                            <PlatformProgress
                                key={target.platform}
                                target={target}
                                stage={platformStage[target.platform]}
                                note={notes[target.platform]}
                                progress={platformProgress[target.platform]}
                            />
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                    <Button onClick={submit} disabled={busy || !file || oversize} className="flex-1">
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

/**
 * One platform's step checklist.
 *
 * Steps before the reported stage are done, the reported one is active, the
 * rest are pending. A published target marks everything done; a failed one
 * marks the step it died on.
 */
function PlatformProgress({
    target,
    stage,
    note,
    progress,
}: {
    target: TargetRow
    stage?: string
    note?: string
    progress?: number
}) {
    const Icon = target.platform === "instagram" ? Instagram : Youtube
    const steps = STEPS[target.platform]
    const currentIndex = steps.findIndex((step) => step.stage === stage)

    return (
        <div className="space-y-1.5 border-t border-white/5 pt-3 first:border-0 first:pt-0">
            <div className="flex items-center gap-2 text-xs">
                <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                        target.platform === "instagram" ? "text-pink-500" : "text-red-500"
                    }`}
                />
                <span className="font-medium capitalize text-white">{target.platform}</span>

                {target.status === "published" && (
                    <span className="text-emerald-400">
                        published
                        {target.platform === "youtube" && target.privacy && ` · ${target.privacy}`}
                    </span>
                )}
                {target.status === "failed" && <span className="text-red-400">failed</span>}

                {target.permalink && (
                    <a
                        href={target.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-neutral-400 underline hover:text-white"
                    >
                        View
                    </a>
                )}
            </div>

            <div className="space-y-1 pl-5">
                {steps.map((step, index) => {
                    let state: StepState = "pending"

                    if (target.status === "published") state = "done"
                    else if (target.status === "failed") {
                        state = currentIndex === index ? "failed" : index < currentIndex ? "done" : "pending"
                    } else if (currentIndex === -1) {
                        state = index === 0 ? "active" : "pending"
                    } else if (index < currentIndex) state = "done"
                    else if (index === currentIndex) state = "active"

                    return (
                        <StepRow
                            key={step.stage}
                            label={state === "active" && note ? note : step.label}
                            state={state}
                            // Only YouTube's upload knows a real percentage.
                            progress={state === "active" ? progress : undefined}
                        />
                    )
                })}
            </div>

            {target.status === "failed" && target.error_message && (
                <p className="pl-5 text-xs text-red-400/90 break-words">{target.error_message}</p>
            )}
        </div>
    )
}

type StepState = "pending" | "active" | "done" | "failed"

function StepRow({
    label,
    state,
    progress,
}: {
    label: string
    state: StepState
    progress?: number
}) {
    return (
        <div className="flex items-center gap-2 text-xs">
            {state === "done" && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}
            {state === "active" && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-white" />}
            {state === "failed" && <XCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />}
            {state === "pending" && <Circle className="w-3.5 h-3.5 shrink-0 text-neutral-700" />}

            <span
                className={
                    state === "done"
                        ? "text-neutral-400"
                        : state === "active"
                          ? "text-white"
                          : state === "failed"
                            ? "text-red-400"
                            : "text-neutral-600"
                }
            >
                {label}
            </span>

            {progress !== undefined && state === "active" && (
                <span className="ml-auto flex items-center gap-2">
                    <Progress value={progress} className="h-1 w-24" />
                    <span className="w-8 text-right tabular-nums text-[10px] text-neutral-500">
                        {progress}%
                    </span>
                </span>
            )}
        </div>
    )
}
