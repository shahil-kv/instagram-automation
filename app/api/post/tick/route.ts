import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"
import { deleteStagedVideo } from "@/lib/storage"
import { tickInstagram } from "@/lib/publishers/instagram"
import { tickYouTube } from "@/lib/publishers/youtube"
import type { PostJob, PostTarget, TickResult } from "@/lib/publishers/types"

// Long enough for a YouTube chunk run; the publisher itself yields at 45s.
export const maxDuration = 300

const MAX_ATTEMPTS = 40

/**
 * Advance every unfinished target of a post by one step.
 * POST /api/post/tick  Body: { jobId }
 *
 * The composer calls this on a few-second interval until nothing is
 * `processing` any more. Each platform's tick is independent, so one failing
 * does not hold up the other.
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const { jobId } = await request.json()
        if (!jobId) {
            return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // Scoped by user_id so a guessed job id reveals nothing.
        const { data: job } = await supabase
            .from("post_jobs")
            .select("id, user_id, video_url, thumbnail_url, title, caption")
            .eq("id", jobId)
            .eq("user_id", session.userId)
            .maybeSingle()

        if (!job) {
            return NextResponse.json({ error: "Post not found" }, { status: 404 })
        }

        const { data: targets } = await supabase
            .from("post_targets")
            .select("*")
            .eq("job_id", jobId)
            .order("platform", { ascending: true })

        const notes: Record<string, string> = {}
        const progress: Record<string, number> = {}
        const stages: Record<string, string> = {}

        for (const target of (targets ?? []) as PostTarget[]) {
            if (target.status === "published" || target.status === "failed") continue

            if (target.attempts >= MAX_ATTEMPTS) {
                await persist(supabase, target, {
                    status: "failed",
                    error_message: `Gave up after ${MAX_ATTEMPTS} attempts`,
                })
                continue
            }

            try {
                const result =
                    target.platform === "instagram"
                        ? await tickInstagram(supabase, job as PostJob, target)
                        : await tickYouTube(supabase, job as PostJob, target)

                if (result.note) notes[target.platform] = result.note
                if (result.progress !== undefined) progress[target.platform] = result.progress
                if (result.stage) stages[target.platform] = result.stage
                await persist(supabase, target, result)
            } catch (error: any) {
                console.error(`[Post] ${target.platform} tick failed:`, error)
                await persist(supabase, target, {
                    status: "failed",
                    error_message: error.message ?? "Unknown error",
                })
            }
        }

        const { data: fresh } = await supabase
            .from("post_targets")
            .select("*")
            .eq("job_id", jobId)
            .order("platform", { ascending: true })

        const rows = (fresh ?? []) as PostTarget[]
        const done = rows.every((t) => t.status === "published" || t.status === "failed")

        // Storage is a staging area, not a library. Once every platform has
        // published, each holds its own copy and the staged file is just
        // burning quota. A partial failure keeps the file so a retry can reuse
        // it. Best-effort: cleanup must never fail a successful post.
        let cleanedUp = false
        if (done && rows.length > 0 && rows.every((t) => t.status === "published")) {
            cleanedUp = await deleteStagedVideo(supabase, job.video_url)
        }

        return NextResponse.json({
            jobId,
            targets: rows,
            notes,
            progress,
            stages,
            done,
            cleanedUp,
        })
    } catch (error: any) {
        console.error("[Post] Tick failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

async function persist(supabase: any, target: PostTarget, result: TickResult) {
    const updates: Record<string, unknown> = {
        status: result.status,
        attempts: target.attempts + 1,
        updated_at: new Date().toISOString(),
    }

    // Only overwrite fields the tick actually returned, so a later `processing`
    // step cannot blank out an id an earlier step stored.
    if (result.external_ref !== undefined) updates.external_ref = result.external_ref
    if (result.external_id !== undefined) updates.external_id = result.external_id
    if (result.permalink !== undefined) updates.permalink = result.permalink
    if (result.privacy !== undefined) updates.privacy = result.privacy
    if (result.error_message !== undefined) updates.error_message = result.error_message
    if (result.status === "published") updates.published_at = new Date().toISOString()

    await supabase.from("post_targets").update(updates).eq("id", target.id)
}
