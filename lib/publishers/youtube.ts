import type { SupabaseClient } from "@supabase/supabase-js"
import { getFreshYouTubeToken, getYouTubeAccount } from "@/lib/youtube-auth"
import type { PostJob, PostTarget, TickResult } from "./types"

/** Google requires resumable chunks to be a multiple of 256 KB. */
const CHUNK_SIZE = 8 * 1024 * 1024

/**
 * Stop uploading and hand back `processing` after this long, so the request
 * returns before the platform kills it. The next tick resumes at the byte
 * offset YouTube reports, so nothing is re-sent.
 */
const TICK_BUDGET_MS = 45_000

/** "People & Blogs" — a safe default when the user has not picked one. */
const DEFAULT_CATEGORY_ID = "22"

type ProbedSource = { size: number; contentType: string }

/**
 * YouTube publish, resumable and restartable:
 *
 *   pending    -> open a resumable session, stream chunks from Storage
 *   processing -> ask YouTube how many bytes it has, continue from there
 *
 * Unlike Instagram, YouTube will not fetch a URL for us — we have to push the
 * bytes. We pull them from Supabase Storage with Range requests so memory
 * stays flat no matter how large the file is.
 */
export async function tickYouTube(
    supabase: SupabaseClient,
    job: PostJob,
    target: PostTarget,
): Promise<TickResult> {
    const account = await getYouTubeAccount(supabase, String(job.user_id))
    if (!account) {
        return { status: "failed", error_message: "No YouTube channel is connected" }
    }

    const accessToken = await getFreshYouTubeToken(supabase, account)
    const privacy = target.privacy || defaultPrivacy()
    const source = await probeSource(job.video_url)

    let uploadUrl = target.external_ref
    let offset = 0

    if (uploadUrl) {
        const resumed = await queryUploadOffset(uploadUrl, source.size)

        if (resumed.kind === "done") {
            return publishedResult(resumed.videoId, privacy)
        }
        if (resumed.kind === "expired") {
            uploadUrl = null
        } else {
            offset = resumed.offset
        }
    }

    if (!uploadUrl) {
        uploadUrl = await openSession(accessToken, job, source, privacy)
        offset = 0
    }

    const deadline = Date.now() + TICK_BUDGET_MS

    while (offset < source.size) {
        if (Date.now() > deadline) {
            return {
                status: "processing",
                external_ref: uploadUrl,
                note: `Uploading to YouTube — ${percent(offset, source.size)} sent`,
                progress: ratio(offset, source.size),
            }
        }

        const end = Math.min(offset + CHUNK_SIZE, source.size) - 1
        const chunk = await readRange(job.video_url, offset, end)

        const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": source.contentType,
                "Content-Range": `bytes ${offset}-${end}/${source.size}`,
            },
            body: chunk,
        })

        // 308 = chunk accepted, send the next one.
        if (res.status === 308) {
            offset = nextOffsetFromRange(res.headers.get("range"), end)
            continue
        }

        if (res.status === 200 || res.status === 201) {
            const video = await res.json()
            return publishedResult(video?.id ?? null, video?.status?.privacyStatus ?? privacy)
        }

        const body = await res.text()
        return {
            status: "failed",
            external_ref: uploadUrl,
            error_message: `YouTube upload failed (${res.status}): ${body.slice(0, 300)}`,
        }
    }

    // All bytes sent but no terminal response — ask YouTube where it stands.
    const final = await queryUploadOffset(uploadUrl, source.size)
    if (final.kind === "done") return publishedResult(final.videoId, privacy)

    return {
        status: "processing",
        external_ref: uploadUrl,
        note: "Waiting for YouTube to finish processing",
        progress: 100,
    }
}

function defaultPrivacy() {
    // Uploads from an unaudited API project are forced to private by YouTube
    // regardless of what we ask for, so private is the honest default.
    return process.env.YOUTUBE_DEFAULT_PRIVACY || "private"
}

function publishedResult(videoId: string | null, privacy: string): TickResult {
    return {
        status: "published",
        external_id: videoId,
        permalink: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
        privacy,
        progress: 100,
    }
}

function percent(done: number, total: number) {
    return `${ratio(done, total)}%`
}

function ratio(done: number, total: number) {
    if (!total) return 0
    return Math.min(100, Math.floor((done / total) * 100))
}

/** Size and MIME type of the stored video, needed up front by the resumable API. */
async function probeSource(videoUrl: string): Promise<ProbedSource> {
    const res = await fetch(videoUrl, { method: "HEAD" })
    if (!res.ok) {
        throw new Error(`Could not read the video from storage (${res.status})`)
    }

    const size = Number(res.headers.get("content-length"))
    if (!size) {
        throw new Error("Storage did not report a file size, which the YouTube resumable upload requires")
    }

    return {
        size,
        contentType: res.headers.get("content-type") || "video/mp4",
    }
}

async function readRange(videoUrl: string, start: number, end: number) {
    const res = await fetch(videoUrl, { headers: { Range: `bytes=${start}-${end}` } })
    if (!res.ok && res.status !== 206) {
        throw new Error(`Storage range read failed (${res.status})`)
    }
    return new Uint8Array(await res.arrayBuffer())
}

async function openSession(
    accessToken: string,
    job: PostJob,
    source: ProbedSource,
    privacy: string,
): Promise<string> {
    const metadata = {
        snippet: {
            title: (job.title || job.caption || "Untitled").slice(0, 100),
            description: job.caption || "",
            categoryId: process.env.YOUTUBE_CATEGORY_ID || DEFAULT_CATEGORY_ID,
        },
        status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false,
        },
    }

    const res = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "X-Upload-Content-Length": String(source.size),
                "X-Upload-Content-Type": source.contentType,
            },
            body: JSON.stringify(metadata),
        },
    )

    const uploadUrl = res.headers.get("location")
    if (!res.ok || !uploadUrl) {
        const body = await res.text()
        throw new Error(`YouTube would not start the upload (${res.status}): ${body.slice(0, 300)}`)
    }

    return uploadUrl
}

type OffsetQuery =
    | { kind: "resume"; offset: number }
    | { kind: "done"; videoId: string | null }
    | { kind: "expired" }

/**
 * Ask an existing session how much it has received. The documented probe is a
 * zero-length PUT whose Content-Range uses a wildcard offset over the total size.
 */
async function queryUploadOffset(uploadUrl: string, size: number): Promise<OffsetQuery> {
    const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes */${size}` },
    })

    if (res.status === 308) {
        return { kind: "resume", offset: nextOffsetFromRange(res.headers.get("range"), -1) }
    }

    if (res.status === 200 || res.status === 201) {
        const video = await res.json().catch(() => null)
        return { kind: "done", videoId: video?.id ?? null }
    }

    // 404/410 mean the session is gone and we have to start over.
    return { kind: "expired" }
}

/** `Range: bytes=0-1023` means 1024 bytes are stored, so resume at 1024. */
function nextOffsetFromRange(range: string | null, fallbackEnd: number) {
    const match = range?.match(/bytes=0-(\d+)/)
    if (match) return Number(match[1]) + 1
    return fallbackEnd + 1
}
