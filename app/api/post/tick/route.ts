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
 * How long a tick's claim on a target stays valid.
 *
 * Long enough to cover a full YouTube chunk run (the publisher yields at 45s),
 * short enough that a crashed request cannot strand a post for long.
 */
const LOCK_TTL_MS = 2 * 60 * 1000

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
            // Select * rather than naming columns: youtube_shorts may not exist yet,
            // and an absent one simply reads as undefined (Shorts default on).
            .select("*")
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

            // Exactly one caller may advance a target at a time. Without this,
            // an overlapping tick (composer polling while Resume is pressed, or
            // two open tabs) could publish the same Reel twice.
            if (!(await claim(supabase, target))) {
                notes[target.platform] = "Already publishing…"
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
            } finally {
                await release(supabase, target)
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

/**
 * Try to take the lock on a target.
 *
 * The filter is the guard: the update only matches a row whose claim is absent
 * or stale, so a concurrent tick gets zero rows back and stands down. Returns
 * true when this caller may proceed.
 */
async function claim(supabase: any, target: PostTarget): Promise<boolean> {
    const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString()

    const { data, error } = await supabase
        .from("post_targets")
        .update({ locked_at: new Date().toISOString() })
        .eq("id", target.id)
        .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
        .select("id")

    // Column absent = scripts/11 has not run yet. Proceed unlocked rather than
    // block posting; the race it guards against needs two concurrent ticks.
    if (error) {
        if (isMissingColumn(error)) return true
        console.warn(`[Post] Could not claim ${target.platform}:`, error.message)
        return false
    }

    return (data?.length ?? 0) > 0
}

async function release(supabase: any, target: PostTarget) {
    const { error } = await supabase
        .from("post_targets")
        .update({ locked_at: null })
        .eq("id", target.id)

    if (error && !isMissingColumn(error)) {
        console.warn(`[Post] Could not release ${target.platform}:`, error.message)
    }
}

/** True when Postgres/PostgREST is telling us a column does not exist. */
function isMissingColumn(error: { code?: string; message?: string }) {
    return (
        error.code === "42703" ||
        error.code === "PGRST204" ||
        /column .* does not exist|could not find the '.*' column/i.test(error.message ?? "")
    )
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
