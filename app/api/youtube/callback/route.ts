import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"
import {
    exchangeYouTubeCode,
    fetchYouTubeChannel,
    YOUTUBE_SCOPES,
    YOUTUBE_STATE_COOKIE,
} from "@/lib/youtube-auth"

/**
 * Google redirects here after consent.
 * GET /api/youtube/callback?code=...&state=<userId>:<nonce>
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams
    const redirect = (query: string) =>
        NextResponse.redirect(new URL(`/dashboard/post?${query}`, request.url))

    const error = params.get("error")
    if (error) {
        console.error(`[YouTube] Consent denied: ${error}`)
        return redirect(`yt_error=${encodeURIComponent(error)}`)
    }

    const code = params.get("code")
    const state = params.get("state")
    if (!code || !state) {
        return redirect("yt_error=missing_code")
    }

    try {
        const session = await getSession()
        if (!session) return redirect("yt_error=not_signed_in")

        const [stateUserId, nonce] = state.split(":")
        const store = await cookies()
        const expected = store.get(YOUTUBE_STATE_COOKIE)?.value

        // The state must match both the cookie and the signed-in user.
        if (!expected || nonce !== expected || stateUserId !== session.userId) {
            return redirect("yt_error=state_mismatch")
        }

        const tokens = await exchangeYouTubeCode(code)

        if (!tokens.refresh_token) {
            // Without this we cannot post again once the hour-long access token
            // lapses. Google withholds it unless prompt=consent, so surface it.
            console.warn("[YouTube] No refresh_token returned — revoke access in the Google account and reconnect")
        }

        const channel = await fetchYouTubeChannel(tokens.access_token)
        const supabase = await getSupabaseServerClient()

        const { error: upsertError } = await supabase.from("social_accounts").upsert(
            {
                user_id: session.userId,
                provider: "youtube",
                external_id: channel.id,
                display_name: channel.title,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ?? null,
                token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
                scopes: tokens.scope ?? YOUTUBE_SCOPES.join(" "),
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,provider" },
        )

        if (upsertError) throw upsertError

        console.log(`[YouTube] Connected channel "${channel.title}" for user ${session.userId}`)

        const response = redirect("yt_connected=1")
        response.cookies.set(YOUTUBE_STATE_COOKIE, "", { path: "/", maxAge: 0 })
        return response
    } catch (err: any) {
        console.error("[YouTube] Callback failed:", err)
        return redirect(`yt_error=${encodeURIComponent(err.message ?? "callback_failed")}`)
    }
}
