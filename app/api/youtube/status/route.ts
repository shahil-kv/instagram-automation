import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSession } from "@/lib/session"
import { describeSocialAccountsError } from "@/lib/youtube-auth"

/**
 * Which YouTube channel, if any, is connected.
 * GET /api/youtube/status
 */
export async function GET() {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const supabase = await getSupabaseServerClient()

        // Tokens are deliberately not selected — this response reaches the browser.
        const { data, error } = await supabase
            .from("social_accounts")
            .select("external_id, display_name, token_expires_at, refresh_token")
            .eq("user_id", session.userId)
            .eq("provider", "youtube")
            .maybeSingle()

        if (error) {
            // Don't report a setup problem as "not connected".
            return NextResponse.json(
                { connected: false, error: describeSocialAccountsError(error) },
                { status: 500 },
            )
        }

        if (!data) {
            return NextResponse.json({ connected: false })
        }

        return NextResponse.json({
            connected: true,
            channelId: data.external_id,
            channelTitle: data.display_name,
            // Without a refresh token the connection dies in an hour.
            needsReconnect: !data.refresh_token,
        })
    } catch (error: any) {
        console.error("[YouTube] Status failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

/**
 * Disconnect the channel.
 * DELETE /api/youtube/status
 */
export async function DELETE() {
    try {
        const session = await getSession()
        if (!session) {
            return NextResponse.json({ error: "Not signed in" }, { status: 401 })
        }

        const supabase = await getSupabaseServerClient()

        const { error } = await supabase
            .from("social_accounts")
            .delete()
            .eq("user_id", session.userId)
            .eq("provider", "youtube")

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error("[YouTube] Disconnect failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
