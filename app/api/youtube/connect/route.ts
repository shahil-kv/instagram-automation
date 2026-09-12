import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { buildYouTubeAuthUrl, YOUTUBE_STATE_COOKIE } from "@/lib/youtube-auth"
import { getSession } from "@/lib/session"

/**
 * Start the YouTube OAuth flow.
 * GET /api/youtube/connect  ->  302 to Google's consent screen
 */
export async function GET() {
    const session = await getSession()
    if (!session) {
        return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"))
    }

    try {
        // CSRF guard: the value we hand Google must come back unchanged.
        const nonce = randomBytes(16).toString("hex")
        const state = `${session.userId}:${nonce}`

        const response = NextResponse.redirect(buildYouTubeAuthUrl(state))
        response.cookies.set(YOUTUBE_STATE_COOKIE, nonce, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 600,
        })
        return response
    } catch (error: any) {
        console.error("[YouTube] Connect failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
