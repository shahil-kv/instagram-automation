import type { SupabaseClient } from "@supabase/supabase-js"

/** Short-lived CSRF nonce cookie for the OAuth round trip. */
export const YOUTUBE_STATE_COOKIE = "yt_oauth_state"

/**
 * YouTube OAuth 2.0 (web app flow).
 *
 * `youtube.upload` is what lets us post; `youtube.readonly` is only used to
 * read back the channel title so the UI can show which account is connected.
 * Both are sensitive scopes — Google requires app verification before other
 * people can connect, and YouTube requires a separate compliance audit before
 * uploads stop being forced to private.
 */
export const YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]

/** Refresh when the access token has under 5 minutes left. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export type YouTubeAccount = {
    id: string
    user_id: number
    external_id: string | null
    display_name: string | null
    access_token: string
    refresh_token: string | null
    token_expires_at: string | null
}

function requireEnv(name: string) {
    const value = process.env[name]
    if (!value) throw new Error(`[youtube] Missing ${name}`)
    return value
}

export function youtubeRedirectUri() {
    return requireEnv("YOUTUBE_REDIRECT_URI")
}

/** Consent URL. `state` carries the Instagram user id we attach the channel to. */
export function buildYouTubeAuthUrl(state: string) {
    const params = new URLSearchParams({
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        redirect_uri: youtubeRedirectUri(),
        response_type: "code",
        scope: YOUTUBE_SCOPES.join(" "),
        // offline + consent is what gets us a refresh_token we can keep using.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

type TokenResponse = {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
    error?: string
    error_description?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
    })
    const data = (await res.json()) as TokenResponse

    if (!res.ok || data.error) {
        throw new Error(`YouTube token error: ${data.error_description || data.error || res.status}`)
    }
    return data
}

export async function exchangeYouTubeCode(code: string) {
    return tokenRequest({
        code,
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: youtubeRedirectUri(),
        grant_type: "authorization_code",
    })
}

export async function refreshYouTubeToken(refreshToken: string) {
    return tokenRequest({
        refresh_token: refreshToken,
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        grant_type: "refresh_token",
    })
}

/** Channel id + title for the connected account, for display only. */
export async function fetchYouTubeChannel(accessToken: string) {
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()

    if (!res.ok) {
        throw new Error(`YouTube channel lookup failed: ${data?.error?.message || res.status}`)
    }

    const channel = data.items?.[0]
    return {
        id: channel?.id ?? null,
        title: channel?.snippet?.title ?? null,
    }
}

/**
 * Returns a usable access token, refreshing and persisting it when needed.
 *
 * Mirrors getFreshAccessToken() in lib/instagram-token.ts so both providers
 * behave the same way at call sites.
 */
export async function getFreshYouTubeToken(
    supabase: SupabaseClient,
    account: YouTubeAccount,
): Promise<string> {
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0
    const stillValid = expiresAt - Date.now() > REFRESH_SKEW_MS

    if (stillValid) return account.access_token

    if (!account.refresh_token) {
        throw new Error("YouTube access token expired and no refresh token is stored — reconnect the channel")
    }

    const refreshed = await refreshYouTubeToken(account.refresh_token)
    const nextExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

    await supabase
        .from("social_accounts")
        .update({
            access_token: refreshed.access_token,
            // Google only returns a new refresh_token on re-consent.
            refresh_token: refreshed.refresh_token ?? account.refresh_token,
            token_expires_at: nextExpiry,
            updated_at: new Date().toISOString(),
        })
        .eq("id", account.id)

    return refreshed.access_token
}

/**
 * The connected YouTube channel for a user, or null.
 *
 * Throws on a query error rather than returning null, so a missing
 * `social_accounts` table is not silently reported as "not connected".
 */
export async function getYouTubeAccount(
    supabase: SupabaseClient,
    userId: string,
): Promise<YouTubeAccount | null> {
    const { data, error } = await supabase
        .from("social_accounts")
        .select("id, user_id, external_id, display_name, access_token, refresh_token, token_expires_at")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .maybeSingle()

    if (error) throw new Error(describeSocialAccountsError(error))

    return (data as YouTubeAccount) ?? null
}

/** PGRST205 means the table is absent — point at the migration, not at OAuth. */
export function describeSocialAccountsError(error: { code?: string; message?: string }) {
    if (error.code === "PGRST205") {
        return "The social_accounts table is missing — run scripts/09-social-posting.sql in the Supabase SQL editor"
    }
    return error.message || "Could not read the connected YouTube channel"
}
