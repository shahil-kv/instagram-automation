import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"

const BUCKET = "reels"

/**
 * Hand the browser a one-shot signed upload URL.
 * POST /api/post/upload-url  Body: { fileName }
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

        const { fileName } = await request.json()

        // Keep only a safe extension from whatever the browser sent.
        const extension = String(fileName || "")
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "")
        const safeExtension = extension && extension.length <= 5 ? extension : "mp4"

        const path = `${session.userId}/${Date.now()}.${safeExtension}`
        const supabase = await getSupabaseServerClient()

        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)

        if (error || !data?.signedUrl) {
            throw new Error(error?.message || "Could not sign the upload URL")
        }

        const {
            data: { publicUrl },
        } = supabase.storage.from(BUCKET).getPublicUrl(path)

        return NextResponse.json({ uploadUrl: data.signedUrl, publicUrl, path })
    } catch (error: any) {
        console.error("[Post] Signing the upload URL failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
