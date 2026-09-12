import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"

export const SESSION_COOKIE = "insta_session"

export type SessionPayload = {
    userId: string
    username: string
}

/**
 * Secret used to sign the session cookie.
 *
 * Falls back to INSTAGRAM_APP_SECRET so existing deployments keep working
 * without a new env var. Set SESSION_SECRET to rotate sessions independently
 * of the Meta app secret.
 */
function secret() {
    const value = process.env.SESSION_SECRET || process.env.INSTAGRAM_APP_SECRET
    if (!value) throw new Error("[session] Missing SESSION_SECRET / INSTAGRAM_APP_SECRET")
    return value
}

function sign(body: string) {
    return createHmac("sha256", secret()).update(body).digest("base64url")
}

/** Encode a session as `<base64url payload>.<hmac>`. */
export function serializeSession(payload: SessionPayload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
    return `${body}.${sign(body)}`
}

/**
 * Decode and verify a cookie value. Returns null unless the HMAC checks out.
 *
 * The legacy unsigned `{"userId":...}` format is deliberately NOT accepted:
 * anyone could hand-write one and publish to that account. Sessions created
 * before signing existed are rejected, and the user reconnects once.
 */
export function parseSession(raw?: string | null): SessionPayload | null {
    if (!raw) return null

    const dot = raw.lastIndexOf(".")
    if (dot <= 0) return null

    const body = raw.slice(0, dot)
    const mac = raw.slice(dot + 1)
    const expected = sign(body)

    // timingSafeEqual throws on length mismatch, so check that first.
    if (mac.length !== expected.length) return null
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null

    try {
        const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
        if (!parsed?.userId || !parsed?.username) return null
        return { userId: String(parsed.userId), username: String(parsed.username) }
    } catch {
        return null
    }
}

/**
 * Read the signed-in user from the request cookie.
 *
 * Use this in every route that acts on an account — never trust a `userId`
 * sent in the query string or body.
 */
export async function getSession(): Promise<SessionPayload | null> {
    const store = await cookies()
    return parseSession(store.get(SESSION_COOKIE)?.value)
}

/** Cookie options shared by login and logout. */
export function sessionCookieOptions(maxAge: number) {
    return {
        path: "/",
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        maxAge,
    }
}
