/**
 * Server-side Instagram long-lived token lifecycle.
 *
 * Long-lived tokens last 60 days and MUST be refreshed before they expire —
 * once expired there is no refresh path and the user has to redo OAuth by hand.
 */

/** Refresh when the stored token expires within this window. */
export const TOKEN_REFRESH_THRESHOLD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_LONG_LIVED_TTL_SECONDS = 60 * 24 * 60 * 60 // 60 days

export type InstagramTokenResult = {
  accessToken: string
  expiresIn: number
  expiresAt: string
}

function expiryFrom(expiresIn: number) {
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

/** True for auth failures (expired/revoked token) as opposed to transient/rate-limit errors. */
export function isInstagramOAuthError(error: any) {
  if (!error) return false
  const code = Number(error.code)
  return (
    error.type === "OAuthException" ||
    code === 190 ||
    code === 102 ||
    code === 463 ||
    code === 467
  )
}

/**
 * `refresh_access_token` rejects tokens younger than 24 hours. That is expected
 * right after an OAuth connect and is NOT a failure worth alerting on.
 */
export function isTokenTooNewError(error: any) {
  const message = String(error?.message || error?.error_user_msg || "")
  return /24 hours|at least 24|too soon/i.test(message)
}

/**
 * A long-lived Instagram token can never be valid for more than 60 days.
 * Anything further out was written by a buggy/defaulted expiry and cannot be trusted.
 */
export function hasImplausibleExpiry(tokenExpiresAt?: string | null) {
  const days = daysUntilExpiry(tokenExpiresAt)
  return days === null || days > 61
}

/**
 * Asks Instagram whether the token is actually alive, instead of trusting the
 * stored expiry. This is the only reliable check for rows written before the
 * long-lived exchange was made to hard-fail, whose stored expiry is fiction.
 */
export async function probeToken(accessToken: string): Promise<{ ok: boolean; error?: any }> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v24.0/me?fields=user_id&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    )
    const data = await res.json()
    if (data?.error) return { ok: false, error: data.error }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: { message: e?.message || String(e), transient: true } }
  }
}

/**
 * Loud failure path: an OAuth error means automations are silently dead until
 * someone reconnects. Log at error level and persist an event so it is visible
 * in the dashboard/webhook_events instead of only in ephemeral function logs.
 */
export async function logInstagramApiError(
  supabase: any,
  context: { step: string; userId?: string | number | null; username?: string | null },
  error: any,
  extra: Record<string, any> = {},
) {
  const oauth = isInstagramOAuthError(error)
  const prefix = oauth ? "[v0] 🚨 INSTAGRAM TOKEN INVALID" : "[v0] 🔴 Instagram API error"

  console.error(
    `${prefix} | step=${context.step} user=${context.username ?? context.userId ?? "unknown"} | ${JSON.stringify(error)}`,
  )

  if (oauth) {
    console.error(
      "[v0] 🚨 ACTION REQUIRED: the Instagram access token is expired or revoked. " +
        "Automations (comments/DMs) will not run until the account reconnects via OAuth.",
    )
  }

  if (!supabase || context.userId == null) return

  try {
    await supabase.from("webhook_events").insert({
      event_type: oauth ? "instagram_token_invalid" : "instagram_api_error",
      user_id: context.userId,
      data: { step: context.step, error, ...extra },
    })
  } catch (e) {
    console.error("[v0] ⚠️ Failed to persist Instagram error event:", e)
  }
}

/**
 * Positive health marker. Alerts must compare the newest failure against the
 * newest success — without this, an error logged seconds before a successful
 * reconnect keeps firing the "connection broken" banner forever.
 */
export async function logInstagramTokenHealthy(
  supabase: any,
  userId: string | number,
  step: string,
  extra: Record<string, any> = {},
) {
  if (!supabase || userId == null) return
  try {
    await supabase.from("webhook_events").insert({
      event_type: "instagram_token_connected",
      user_id: userId,
      data: { step, ...extra },
    })
  } catch (e) {
    console.error("[v0] ⚠️ Failed to record token health event:", e)
  }
}

/** Short-lived (1h) token → long-lived (60d) token. */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  clientSecret: string,
): Promise<InstagramTokenResult> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: clientSecret,
    access_token: shortLivedToken,
  })

  const res = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`, {
    cache: "no-store",
  })
  const data = await res.json()

  if (!res.ok || data.error || !data.access_token) {
    const err = data.error || { message: "Long-lived token exchange failed" }
    throw Object.assign(new Error(err.message || "Long-lived token exchange failed"), {
      instagramError: err,
    })
  }

  const expiresIn = Number(data.expires_in) || DEFAULT_LONG_LIVED_TTL_SECONDS
  return { accessToken: data.access_token, expiresIn, expiresAt: expiryFrom(expiresIn) }
}

/**
 * Refreshes a long-lived token, resetting it to 60 days.
 * The token must be at least 24 hours old, otherwise Instagram rejects the call.
 */
export async function refreshLongLivedToken(currentToken: string): Promise<InstagramTokenResult> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: currentToken,
  })

  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`, {
    cache: "no-store",
  })
  const data = await res.json()

  if (!res.ok || data.error || !data.access_token) {
    const err = data.error || { message: "Token refresh failed" }
    throw Object.assign(new Error(err.message || "Token refresh failed"), { instagramError: err })
  }

  const expiresIn = Number(data.expires_in) || DEFAULT_LONG_LIVED_TTL_SECONDS
  return { accessToken: data.access_token, expiresIn, expiresAt: expiryFrom(expiresIn) }
}

export function daysUntilExpiry(tokenExpiresAt?: string | null) {
  if (!tokenExpiresAt) return null
  const ms = new Date(tokenExpiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return ms / DAY_MS
}

export function needsRefresh(tokenExpiresAt?: string | null) {
  const days = daysUntilExpiry(tokenExpiresAt)
  // Unknown expiry → refresh so we start tracking one.
  if (days === null) return true
  return days < TOKEN_REFRESH_THRESHOLD_DAYS
}

/**
 * Returns a usable access token for a user row, refreshing + persisting it first
 * when the stored expiry is inside the refresh window. Never throws: on failure it
 * logs loudly and falls back to the stored token so the current request can proceed.
 */
export async function getFreshAccessToken(
  supabase: any,
  user: { id: string | number; username?: string | null; access_token: string; token_expires_at?: string | null },
): Promise<string> {
  if (!user?.access_token) return user?.access_token

  const days = daysUntilExpiry(user.token_expires_at)

  if (days !== null && days <= 0) {
    await logInstagramApiError(
      supabase,
      { step: "token_expired", userId: user.id, username: user.username },
      { type: "OAuthException", code: 190, message: "Stored Instagram token has expired" },
      { token_expires_at: user.token_expires_at },
    )
    return user.access_token
  }

  if (!needsRefresh(user.token_expires_at)) return user.access_token

  try {
    const refreshed = await refreshLongLivedToken(user.access_token)

    const { error } = await supabase
      .from("users")
      .update({
        access_token: refreshed.accessToken,
        token_expires_at: refreshed.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)

    if (error) throw error

    console.log(
      `[v0] 🔄 Refreshed Instagram token for ${user.username ?? user.id} → expires ${refreshed.expiresAt}`,
    )
    await logInstagramTokenHealthy(supabase, user.id, "token_refresh", {
      expires_at: refreshed.expiresAt,
    })
    return refreshed.accessToken
  } catch (e: any) {
    const igError = e?.instagramError || { message: e?.message || String(e) }

    // "must be at least 24 hours old" is expected right after connecting — not an alert.
    if (isTokenTooNewError(igError)) {
      console.warn(
        `[v0] ⏳ Token for ${user.username ?? user.id} is under 24h old; refresh deferred.`,
      )
      return user.access_token
    }

    // Every other failure IS an alert. Falling back to the stored token here is
    // exactly the shape of the bug that caused the outage, so it must never be silent.
    await logInstagramApiError(
      supabase,
      { step: "token_refresh", userId: user.id, username: user.username },
      igError,
      {
        token_expires_at: user.token_expires_at,
        days_left: days,
        fallback: "continuing with the stored token, which may already be dead",
      },
    )
    console.error(
      `[v0] 🚨 Token refresh FAILED for ${user.username ?? user.id} (${days === null ? "unknown" : days.toFixed(1)} days left). ` +
        "Continuing with the stored token — if this repeats, the account will need to reconnect.",
    )
    return user.access_token
  }
}
