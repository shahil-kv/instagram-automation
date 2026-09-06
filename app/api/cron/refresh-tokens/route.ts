import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import {
  TOKEN_REFRESH_THRESHOLD_DAYS,
  daysUntilExpiry,
  hasImplausibleExpiry,
  isTokenTooNewError,
  logInstagramApiError,
  needsRefresh,
  probeToken,
  refreshLongLivedToken,
} from "@/lib/instagram-token"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Refreshes Instagram long-lived tokens before they expire.
 * Scheduled daily via vercel.json.
 *
 * A long-lived token lasts 60 days and can be refreshed any time after it is
 * 24 hours old. Once it fully expires there is NO refresh path — the account
 * has to redo the whole OAuth flow by hand.
 *
 * Every run PROBES the token against the Graph API rather than trusting the
 * stored expiry. Rows written before the long-lived exchange was made to
 * hard-fail carry a fabricated 60-day expiry on a token that died in an hour;
 * only a live probe can tell those apart from healthy ones.
 */
function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.API_SECRET_KEY
  if (!secret) return process.env.NODE_ENV !== "production"

  // Bearer header only — query strings leak into access logs and referrers.
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const force = request.nextUrl.searchParams.get("force") === "true"
  const supabase = await getSupabaseServerClient()

  const { data: users, error } = await supabase
    .from("users")
    .select("id, username, access_token, token_expires_at")

  if (error) {
    console.error("[v0] 🔴 Token refresh: could not load users:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Array<Record<string, any>> = []

  for (const user of users || []) {
    if (!user.access_token) {
      results.push({ user: user.username, status: "skipped", reason: "no_token" })
      continue
    }

    const daysLeft = daysUntilExpiry(user.token_expires_at)
    const suspectExpiry = hasImplausibleExpiry(user.token_expires_at)

    // 1. Is the token actually alive? Never trust the stored timestamp.
    const probe = await probeToken(user.access_token)

    if (!probe.ok && probe.error?.transient) {
      console.warn(`[v0] ⚠️ Token probe for ${user.username} failed transiently, skipping this run.`)
      results.push({ user: user.username, status: "probe_failed", error: probe.error.message })
      continue
    }

    if (!probe.ok) {
      await logInstagramApiError(
        supabase,
        { step: "token_probe", userId: user.id, username: user.username },
        probe.error,
        { token_expires_at: user.token_expires_at, stored_days_left: daysLeft, suspect_expiry: suspectExpiry },
      )
      results.push({
        user: user.username,
        status: "reconnect_required",
        // A live-dead token with a healthy-looking expiry is the old bug's fingerprint.
        reason:
          suspectExpiry || (daysLeft ?? 0) > TOKEN_REFRESH_THRESHOLD_DAYS ? "dead_token_stale_expiry" : "expired",
        stored_days_left: daysLeft?.toFixed(1) ?? null,
      })
      continue
    }

    // 2. Alive. Refresh if near expiry, if the stored expiry is untrustworthy, or if forced.
    if (!force && !suspectExpiry && !needsRefresh(user.token_expires_at)) {
      results.push({ user: user.username, status: "ok", days_left: daysLeft?.toFixed(1) })
      continue
    }

    try {
      const refreshed = await refreshLongLivedToken(user.access_token)

      const { error: updateError } = await supabase
        .from("users")
        .update({
          access_token: refreshed.accessToken,
          token_expires_at: refreshed.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (updateError) throw updateError

      console.log(
        `[v0] 🔄 Refreshed token for ${user.username} → ${refreshed.expiresAt}` +
          (suspectExpiry ? " (replaced an untrustworthy stored expiry)" : ""),
      )
      results.push({
        user: user.username,
        status: "refreshed",
        expires_at: refreshed.expiresAt,
        repaired_expiry: suspectExpiry,
      })
    } catch (e: any) {
      const igError = e?.instagramError || { message: e?.message || String(e) }

      // Expected for an account that connected less than a day ago.
      if (isTokenTooNewError(igError)) {
        console.warn(`[v0] ⏳ ${user.username}: token under 24h old, refresh deferred to the next run.`)
        results.push({ user: user.username, status: "too_new", days_left: daysLeft?.toFixed(1) })
        continue
      }

      await logInstagramApiError(
        supabase,
        { step: "token_refresh_cron", userId: user.id, username: user.username },
        igError,
        { token_expires_at: user.token_expires_at },
      )
      results.push({ user: user.username, status: "failed", error: igError.message })
    }
  }

  const summary = {
    checked: results.length,
    refreshed: results.filter((r) => r.status === "refreshed").length,
    reconnect_required: results.filter((r) => r.status === "reconnect_required").length,
    failed: results.filter((r) => r.status === "failed").length,
    threshold_days: TOKEN_REFRESH_THRESHOLD_DAYS,
    results,
  }

  if (summary.reconnect_required > 0 || summary.failed > 0) {
    console.error(
      `[v0] 🚨 Token cron finished with problems: ${summary.reconnect_required} account(s) need to reconnect, ${summary.failed} refresh failure(s).`,
    )
  }

  return NextResponse.json(summary)
}

export const POST = GET
