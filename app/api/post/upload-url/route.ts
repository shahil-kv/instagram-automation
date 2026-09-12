import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"
import { getUploadLimitBytes, MEDIA_BUCKET } from "@/lib/storage"

/**
 * Hand the browser a one-shot signed upload URL.
 * POST /api/post/upload-url  Body: { fileName, fileSize? }
 * GET  /api/post/upload-url  ->  { maxBytes }  (so the UI can warn up front)
 *
 * The browser PUTs the file straight to Storage so the bytes never pass
 * through a function, and an XHR PUT reports real upload progress (the
 * supabase-js upload() helper does not surface progress events).
 *
 * Signing server-side also means the anon role needs no insert policy on the
 * bucket, and the destination path is always scoped to the signed-in user.
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const { fileName, fileSize, kind } = await request.json()
        const isThumbnail = kind === "thumbnail"
        const supabase = await getSupabaseServerClient()
        const maxBytes = await getUploadLimitBytes(supabase)

        // Reject before a single byte moves. Storage returns EntityTooLarge only
        // after receiving the whole file, which wastes the entire upload.
        // Thumbnails are images and nowhere near the ceiling, so skip the check.
        if (!isThumbnail && typeof fileSize === "number" && fileSize > maxBytes) {
            const asMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
            return NextResponse.json(
                {
                    error: `This video is ${asMb(fileSize)} MB but storage accepts at most ${asMb(maxBytes)} MB. Compress it below ${asMb(maxBytes)} MB, or raise the limit by upgrading the Supabase plan.`,
                    maxBytes,
                    fileSize,
                },
                { status: 413 },
            )
        }

        // Keep only a safe extension from whatever the browser sent.
        const extension = String(fileName || "")
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "")
        const fallback = isThumbnail ? "jpg" : "mp4"
        const safeExtension = extension && extension.length <= 5 ? extension : fallback

        // Thumbnails live in their own prefix so cleanup can tell them apart.
        const folder = isThumbnail ? `${session.userId}/thumbs` : session.userId
        const path = `${folder}/${Date.now()}.${safeExtension}`

        const { data, error } = await supabase.storage
            .from(MEDIA_BUCKET)
            .createSignedUploadUrl(path)

        if (error || !data?.signedUrl) {
            throw new Error(error?.message || "Could not sign the upload URL")
        }

        const {
            data: { publicUrl },
        } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)

        return NextResponse.json({ uploadUrl: data.signedUrl, publicUrl, path, maxBytes })
    } catch (error: any) {
        console.error("[Post] Signing the upload URL failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

/** Lets the composer show the real ceiling before a file is chosen. */
export async function GET() {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const supabase = await getSupabaseServerClient()
        return NextResponse.json({ maxBytes: await getUploadLimitBytes(supabase) })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
