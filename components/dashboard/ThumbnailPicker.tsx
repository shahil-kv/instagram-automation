"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Loader2, ImageIcon, Upload } from "lucide-react"
import { toast } from "sonner"

/** Frames shown in the filmstrip. Enough to find a moment, few enough to stay fast. */
const STRIP_FRAMES = 8

/** JPEG quality for both the strip and the final capture. */
const STRIP_QUALITY = 0.6
const FINAL_QUALITY = 0.92

export type PickedThumbnail = {
    blob: Blob
    dataUrl: string
    /** Seconds into the video, or null for an uploaded image. */
    atSecond: number | null
}

interface ThumbnailPickerProps {
    /** Object URL of the selected video. */
    videoUrl: string
    duration: number
    disabled?: boolean
    picked: PickedThumbnail | null
    onPick: (thumb: PickedThumbnail | null) => void
}

/**
 * Cover-frame picker, the way Instagram does it: scrub the video and take the
 * frame you land on.
 *
 * Everything happens on an offscreen <video> so the main preview keeps playing
 * undisturbed. Seeking is awaited frame by frame — a canvas drawn before the
 * seek completes captures the previous frame, which is the classic bug here.
 */
export function ThumbnailPicker({
    videoUrl,
    duration,
    disabled,
    picked,
    onPick,
}: ThumbnailPickerProps) {
    const [strip, setStrip] = useState<{ atSecond: number; dataUrl: string }[]>([])
    const [buildingStrip, setBuildingStrip] = useState(false)
    const [scrubSecond, setScrubSecond] = useState(0)
    const [capturing, setCapturing] = useState(false)

    const workerRef = useRef<HTMLVideoElement | null>(null)
    const uploadRef = useRef<HTMLInputElement>(null)

    /** An offscreen video we can seek freely, created once per source. */
    const getWorker = useCallback(() => {
        if (!workerRef.current) {
            const video = document.createElement("video")
            video.muted = true
            video.playsInline = true
            video.preload = "auto"
            // Object URLs are same-origin, so the canvas stays untainted.
            video.src = videoUrl
            workerRef.current = video
        }
        return workerRef.current
    }, [videoUrl])

    /** Seek and wait — drawing before `seeked` yields the wrong frame. */
    const seekTo = (video: HTMLVideoElement, second: number) =>
        new Promise<void>((resolve, reject) => {
            const onSeeked = () => {
                video.removeEventListener("seeked", onSeeked)
                video.removeEventListener("error", onError)
                resolve()
            }
            const onError = () => {
                video.removeEventListener("seeked", onSeeked)
                video.removeEventListener("error", onError)
                reject(new Error("Could not seek the video"))
            }
            video.addEventListener("seeked", onSeeked)
            video.addEventListener("error", onError)
            video.currentTime = Math.min(Math.max(second, 0), Math.max(duration - 0.05, 0))
        })

    const drawFrame = (video: HTMLVideoElement, quality: number) => {
        const canvas = document.createElement("canvas")
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas is unavailable")
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        return { canvas, dataUrl: canvas.toDataURL("image/jpeg", quality) }
    }

    // Build the filmstrip once the source and duration are known.
    useEffect(() => {
        if (!videoUrl || !duration) return

        let cancelled = false
        setStrip([])
        setBuildingStrip(true)

        const build = async () => {
            const video = getWorker()
            try {
                if (video.readyState < 1) {
                    await new Promise<void>((resolve, reject) => {
                        video.addEventListener("loadedmetadata", () => resolve(), { once: true })
                        video.addEventListener("error", () => reject(new Error("load failed")), {
                            once: true,
                        })
                    })
                }

                const frames: { atSecond: number; dataUrl: string }[] = []
                for (let i = 0; i < STRIP_FRAMES; i++) {
                    if (cancelled) return
                    // Sample mid-interval so the first frame is not a black fade-in.
                    const atSecond = (duration * (i + 0.5)) / STRIP_FRAMES
                    await seekTo(video, atSecond)
                    frames.push({ atSecond, dataUrl: drawFrame(video, STRIP_QUALITY).dataUrl })
                    if (!cancelled) setStrip([...frames])
                }
            } catch (err) {
                console.warn("[ThumbnailPicker] Could not build the filmstrip:", err)
            } finally {
                if (!cancelled) setBuildingStrip(false)
            }
        }

        build()
        return () => {
            cancelled = true
        }
    }, [videoUrl, duration, getWorker])

    // Release the offscreen element when the source changes.
    useEffect(() => {
        return () => {
            if (workerRef.current) {
                workerRef.current.src = ""
                workerRef.current = null
            }
        }
    }, [videoUrl])

    /** Capture at an exact second and hand it up. */
    const capture = async (second: number) => {
        setCapturing(true)
        try {
            const video = getWorker()
            await seekTo(video, second)
            const { canvas, dataUrl } = drawFrame(video, FINAL_QUALITY)

            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, "image/jpeg", FINAL_QUALITY),
            )
            if (!blob) throw new Error("Could not encode the frame")

            onPick({ blob, dataUrl, atSecond: second })
        } catch (err: any) {
            toast.error(err.message || "Could not capture that frame")
        } finally {
            setCapturing(false)
        }
    }

    const useUploadedImage = (file: File) => {
        const reader = new FileReader()
        reader.onload = () => onPick({ blob: file, dataUrl: String(reader.result), atSecond: null })
        reader.onerror = () => toast.error("Could not read that image")
        reader.readAsDataURL(file)
    }

    return (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-neutral-400" />
                <Label className="text-xs font-medium text-white">Cover frame</Label>
                {picked && (
                    <span className="text-[10px] text-emerald-400">
                        {picked.atSecond === null
                            ? "custom image"
                            : `set at ${picked.atSecond.toFixed(1)}s`}
                    </span>
                )}
                {(buildingStrip || capturing) && (
                    <Loader2 className="ml-auto h-3 w-3 animate-spin text-neutral-500" />
                )}
            </div>

            {/* Filmstrip — tap a moment. */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {strip.length === 0 && buildingStrip
                    ? Array.from({ length: STRIP_FRAMES }).map((_, i) => (
                          <div
                              key={i}
                              className="h-16 w-9 shrink-0 animate-pulse rounded border border-white/10 bg-white/5"
                          />
                      ))
                    : strip.map((frame) => {
                          const active =
                              picked?.atSecond !== null &&
                              picked?.atSecond !== undefined &&
                              Math.abs(picked.atSecond - frame.atSecond) < 0.05
                          return (
                              <button
                                  key={frame.atSecond}
                                  type="button"
                                  disabled={disabled || capturing}
                                  onClick={() => {
                                      setScrubSecond(frame.atSecond)
                                      capture(frame.atSecond)
                                  }}
                                  title={`${frame.atSecond.toFixed(1)}s`}
                                  className={`h-16 w-9 shrink-0 overflow-hidden rounded border transition-all ${
                                      active
                                          ? "border-white ring-2 ring-white/40"
                                          : "border-white/10 hover:border-white/40"
                                  }`}
                              >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                      src={frame.dataUrl}
                                      alt={`Frame at ${frame.atSecond.toFixed(1)}s`}
                                      className="h-full w-full object-cover"
                                  />
                              </button>
                          )
                      })}
            </div>

            {/* Fine scrub — land on an exact moment between strip frames. */}
            <div className="space-y-1.5">
                <input
                    type="range"
                    min={0}
                    max={Math.max(duration, 0.1)}
                    step={0.1}
                    value={scrubSecond}
                    disabled={disabled || capturing}
                    onChange={(event) => setScrubSecond(Number(event.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white disabled:cursor-not-allowed"
                />
                <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[10px] tabular-nums text-neutral-500">
                        {scrubSecond.toFixed(1)}s
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || capturing}
                        onClick={() => capture(scrubSecond)}
                        className="h-7 border-white/15 text-xs"
                    >
                        Use this frame
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => uploadRef.current?.click()}
                        className="h-7 text-xs text-neutral-400"
                    >
                        <Upload className="mr-1.5 h-3 w-3" />
                        Upload
                    </Button>
                    {picked && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => onPick(null)}
                            className="ml-auto h-7 text-xs text-neutral-500"
                        >
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            <input
                ref={uploadRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) useUploadedImage(file)
                    event.target.value = ""
                }}
            />

            {/* Chosen cover, at the 9:16 shape both platforms show it in. */}
            {picked && (
                <div className="flex items-start gap-3 border-t border-white/5 pt-3">
                    <div className="h-24 w-[54px] shrink-0 overflow-hidden rounded border border-white/15 bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={picked.dataUrl}
                            alt="Chosen cover"
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <p className="text-[10px] leading-relaxed text-neutral-500">
                        Used as the Instagram Reel cover and the YouTube thumbnail.
                        <br />
                        YouTube only accepts custom thumbnails on phone-verified channels — if yours
                        is not, the upload still succeeds and YouTube keeps its own frame.
                    </p>
                </div>
            )}
        </div>
    )
}
