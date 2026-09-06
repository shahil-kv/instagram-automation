import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { TOKEN_REFRESH_THRESHOLD_DAYS, daysUntilExpiry, hasImplausibleExpiry } from "@/lib/instagram-token"

export const dynamic = "force-dynamic"

/**
 * Surfaces token health to the dashboard. Without this, `instagram_token_invalid`
 * events are written to a table nobody reads, which is the same as no alert.
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

  const supabase = await getSupabaseServerClient()

  const { data: user } = await supabase
    .from("users")
    .select("id, username, access_token, token_expires_at")
    .eq("id", userId)
    .single()

  if (!user?.access_token) {
    return NextResponse.json({ connected: false, needsReconnect: true, reason: "not_connected" })
  }

  // Any auth failure logged in the last 3 days means automations are down now.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data: authErrors } = await supabase
    .from("webhook_events")
    .select("processed_at, data")
    .eq("user_id", user.id)
    .eq("event_type", "instagram_token_invalid")
    .gte("processed_at", since)
    .order("processed_at", { ascending: false })
    .limit(1)

  const lastAuthError = authErrors?.[0] || null
  const daysLeft = daysUntilExpiry(user.token_expires_at)
  const expired = daysLeft !== null && daysLeft <= 0

  return NextResponse.json({
    connected: true,
    username: user.username,
    daysLeft: daysLeft === null ? null : Number(daysLeft.toFixed(1)),
    expiresAt: user.token_expires_at,
    // An untrustworthy expiry is not proof of breakage — the cron's live probe decides that.
    untrustworthyExpiry: hasImplausibleExpiry(user.token_expires_at),
    needsReconnect: expired || Boolean(lastAuthError),
    expiringSoon: daysLeft !== null && daysLeft > 0 && daysLeft < TOKEN_REFRESH_THRESHOLD_DAYS,
    reason: expired ? "expired" : lastAuthError ? "auth_error" : null,
    lastErrorAt: lastAuthError?.processed_at || null,
    lastErrorStep: (lastAuthError?.data as any)?.step || null,
  })
}
