import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { normalizeAuthCode } from "@/lib/instagram-auth"
import { exchangeForLongLivedToken, logInstagramApiError, logInstagramTokenHealthy } from "@/lib/instagram-token"
import { SESSION_COOKIE, serializeSession, sessionCookieOptions } from "@/lib/session"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const rawCode = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    console.error(
      `[v0] 🔴 Instagram authorize denied: ${error} | reason=${searchParams.get("error_reason")} | ${searchParams.get("error_description")}`,
    )
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("error", error)
    return NextResponse.redirect(redirectUrl)
  }

  if (rawCode) {
    const redirectUrl = new URL("/", request.url)
    // Instagram appends `#_` to the redirect — strip it before it reaches the exchange.
    redirectUrl.searchParams.set("code", normalizeAuthCode(rawCode))
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.json({ error: "Invalid callback" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient()

  try {
    const body = await request.json()
    const code = body?.code ? normalizeAuthCode(String(body.code)) : ""
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 })

    // 1. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID
    const clientSecret = process.env.INSTAGRAM_APP_SECRET
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Missing Env Vars: Check INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI")
    }

    // 2. Exchange Code for Short Token.
    // redirect_uri must be byte-identical to the one used in the authorize URL —
    // both read the same env var so they cannot drift.
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    })

    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      if (tokenData.error_message?.includes("authorization code has been used")) {
        // Harmless double-fire from React StrictMode or double clicks
        return NextResponse.json({ error: "Code already used" }, { status: 400 })
      }
      await logInstagramApiError(supabase, { step: "code_exchange" }, tokenData, { redirect_uri: redirectUri })
      return NextResponse.json({ error: tokenData.error_description || tokenData.error_message || "Token failed" }, { status: 400 })
    }

    const shortToken = tokenData.access_token
    const loginUserId = tokenData.user_id.toString()

    // 3. Exchange for Long Token (60 Days).
    // This MUST succeed — storing the 1-hour short token with a 60-day expiry
    // is what makes the connection die silently about an hour later.
    let accessToken: string
    let expiresIn: number
    let tokenExpiresAt: string
    try {
      const longLived = await exchangeForLongLivedToken(shortToken, clientSecret)
      accessToken = longLived.accessToken
      expiresIn = longLived.expiresIn
      tokenExpiresAt = longLived.expiresAt
      console.log(`[v0] 🔑 Long-lived token acquired | expires ${tokenExpiresAt}`)
    } catch (e: any) {
      await logInstagramApiError(
        supabase,
        { step: "long_lived_exchange", userId: loginUserId },
        e?.instagramError || { message: e?.message || String(e) },
      )
      return NextResponse.json(
        { error: "Could not get a long-lived Instagram token. Please try connecting again." },
        { status: 502 },
      )
    }

    // 4. Get Username + IG Professional Account ID (webhook-matching ID)
    // Per Meta docs: /me?fields=user_id returns the IG_ID that matches webhook entry.id
    // https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started
    let username = `user_${loginUserId}`
    let businessAccountId = loginUserId // fallback

    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v24.0/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`,
      )
      const meData = await meRes.json()
      console.log("[v0] 📋 /me response:", JSON.stringify(meData))

      if (meData.error) {
        await logInstagramApiError(supabase, { step: "me_lookup", userId: loginUserId }, meData.error)
      }
      if (meData.username) username = meData.username
      if (meData.user_id) {
        businessAccountId = meData.user_id.toString()
        console.log(`[v0] 🎯 Got IG Professional Account ID (user_id): ${businessAccountId}`)
      } else {
        console.warn(`[v0] ⚠️ /me did not return user_id, using loginUserId: ${loginUserId}`)
      }
    } catch (e) {
      console.error("[v0] /me request failed:", e)
    }

    // 5. Save/Update User — store the computed expiry, not just the token.
    const updates: any = {
      username,
      access_token: accessToken,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
      business_account_id: businessAccountId,
      page_id: businessAccountId, // Always keep in sync
    }

    console.log(
      `[v0] 💾 Saving user: ${username} | id=${loginUserId} | biz_id=${businessAccountId} | token_expires_at=${tokenExpiresAt}`,
    )

    const { error: upsertError } = await supabase
      .from("users")
      .upsert({ id: loginUserId, ...updates }, { onConflict: "id" })

    if (upsertError) throw upsertError

    // Clears any prior failure: alerts compare the newest error to the newest success.
    await logInstagramTokenHealthy(supabase, loginUserId, "oauth_connect", {
      expires_at: tokenExpiresAt,
    })

    const response = NextResponse.json({ success: true, username, userId: loginUserId })
    // Signed + httpOnly: publish routes derive the user from this cookie, so it
    // must not be readable or forgeable from the browser.
    response.cookies.set(
      SESSION_COOKIE,
      serializeSession({ username, userId: String(loginUserId) }),
      sessionCookieOptions(expiresIn),
    )
    return response

  } catch (error: any) {
    console.error("[v0] 🔴 Instagram callback failed:", error?.message || error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
