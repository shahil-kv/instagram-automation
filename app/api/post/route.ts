import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"
import { describeSocialAccountsError } from "@/lib/youtube-auth"
import type { Platform } from "@/lib/publishers/types"

const SUPPORTED: Platform[] = ["instagram", "youtube"]

/**
 * Create one post and its per-platform targets.
 * POST /api/post
 * Body: { videoUrl, title?, caption?, thumbnailUrl?, platforms: ["instagram","youtube"], privacy? }
 *
 * The user comes from the session cookie, never from the request body — this
 * endpoint publishes to a connected account, so it must not accept a userId.
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const { videoUrl, title, caption, thumbnailUrl, platforms, privacy } = await request.json()

        if (!videoUrl) {
            return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 })
        }

        const targets: Platform[] = Array.isArray(platforms)
            ? SUPPORTED.filter((p) => platforms.includes(p))
            : []

        if (targets.length === 0) {
            return NextResponse.json({ error: "Pick at least one platform" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // Reject platforms that are not actually connected, before creating the job.
        if (targets.includes("youtube")) {
            const { data: channel, error: channelError } = await supabase
                .from("social_accounts")
                .select("id")
                .eq("user_id", session.userId)
                .eq("provider", "youtube")
                .maybeSingle()

            // A query failure is a setup problem, not a missing connection.
            if (channelError) {
                return NextResponse.json(
                    { error: describeSocialAccountsError(channelError) },
                    { status: 500 },
                )
            }

            if (!channel) {
                return NextResponse.json(
                    { error: "Connect a YouTube channel before posting to YouTube" },
                    { status: 400 },
                )
            }
        }

        const { data: job, error: jobError } = await supabase
            .from("post_jobs")
            .insert({
                user_id: session.userId,
                video_url: videoUrl,
                thumbnail_url: thumbnailUrl || null,
                title: title || null,
                caption: caption || null,
            })
            .select()
            .single()

        if (jobError) throw jobError

        const { data: rows, error: targetError } = await supabase
            .from("post_targets")
            .insert(
                targets.map((platform) => ({
                    job_id: job.id,
                    user_id: session.userId,
                    platform,
                    status: "pending",
                    privacy: platform === "youtube" ? privacy || "private" : null,
                })),
            )
            .select()

        if (targetError) throw targetError

        return NextResponse.json({ jobId: job.id, targets: rows }, { status: 201 })
    } catch (error: any) {
        console.error("[Post] Create failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

/**
 * Recent posts with their per-platform status.
 * GET /api/post?limit=20
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100)
        const supabase = await getSupabaseServerClient()

        const { data, error } = await supabase
            .from("post_jobs")
            .select("id, video_url, thumbnail_url, title, caption, created_at, post_targets(*)")
            .eq("user_id", session.userId)
            .order("created_at", { ascending: false })
            .limit(limit)

        if (error) throw error

        return NextResponse.json({ jobs: data ?? [] })
    } catch (error: any) {
        console.error("[Post] History failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
