import type { SupabaseClient } from "@supabase/supabase-js"
import { createReelsContainer, getContainerStatus, publishContainer } from "@/lib/instagram-publishing"
import { getFreshAccessToken } from "@/lib/instagram-token"
import type { PostJob, PostTarget, TickResult } from "./types"

/**
 * Instagram publish, one step per call:
 *
 *   pending    -> create a REELS container, store its id, return `processing`
 *   processing -> poll the container; publish it once Instagram says FINISHED
 *
 * Split this way on purpose: Instagram transcodes the video on its side and
 * that can take minutes, which is longer than a request should stay open.
 */
export async function tickInstagram(
    supabase: SupabaseClient,
    job: PostJob,
    target: PostTarget,
): Promise<TickResult> {
    const { data: user } = await supabase
        .from("users")
        .select("id, username, access_token, token_expires_at")
        .eq("id", job.user_id)
        .single()

    if (!user?.access_token) {
        return { status: "failed", error_message: "Instagram account is not connected" }
    }

    const accessToken = await getFreshAccessToken(supabase, user)

    if (!target.external_ref) {
        const containerId = await createReelsContainer(
            accessToken,
            job.video_url,
            job.caption || "",
            job.thumbnail_url || undefined,
        )
        return {
            status: "processing",
            external_ref: containerId,
            note: "Instagram is processing the video",
        }
    }

    const containerStatus = await getContainerStatus(accessToken, target.external_ref)

    if (containerStatus === "IN_PROGRESS") {
        return { status: "processing", note: "Instagram is processing the video" }
    }

    if (containerStatus !== "FINISHED") {
        return {
            status: "failed",
            error_message: `Instagram rejected the video (status: ${containerStatus})`,
        }
    }

    const mediaId = await publishContainer(accessToken, target.external_ref)

    return {
        status: "published",
        external_id: mediaId,
        permalink: await fetchPermalink(accessToken, mediaId),
    }
}

/** Best-effort: a missing permalink should never fail a successful publish. */
async function fetchPermalink(accessToken: string, mediaId: string): Promise<string | null> {
    try {
        const res = await fetch(
            `https://graph.instagram.com/${mediaId}?fields=permalink&access_token=${accessToken}`,
        )
        const data = await res.json()
        return data?.permalink ?? null
    } catch {
        return null
    }
}
