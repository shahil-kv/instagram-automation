import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getFreshAccessToken, logInstagramApiError } from "@/lib/instagram-token"

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  // Required to tell Reels/Stories apart — the picker checks this and it was never fetched.
  "media_product_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
].join(",")

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")

    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 24, 1), 100)
    const after = searchParams.get("after")
    const source = searchParams.get("source") === "stories" ? "stories" : "media"

    const supabase = await getSupabaseServerClient()

    // 1. Get Access Token
    const { data: user } = await supabase
      .from("users")
      .select("id, username, access_token, token_expires_at")
      .eq("id", userId)
      .single()

    if (!user?.access_token) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    // Refresh the long-lived token if it is inside the expiry window.
    const accessToken = await getFreshAccessToken(supabase, user)

    // 2a. Lookup by explicit ids — used to resolve thumbnails for rules pointing
    //     at older posts, which a first-page listing would never contain.
    const ids = (searchParams.get("ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50)

    if (ids.length > 0) {
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(
            `https://graph.instagram.com/${encodeURIComponent(id)}?fields=${MEDIA_FIELDS}&access_token=${encodeURIComponent(accessToken)}`,
            { cache: "no-store" },
          )
          const json = await res.json()
          // A deleted post is expected, not an error worth failing the whole batch.
          if (json.error) return null
          return json
        }),
      )

      const found = settled
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter(Boolean)

      return NextResponse.json({ data: found, nextCursor: null, hasMore: false })
    }

    // 2b. Fetch a page of media. Cursor-paginated: without `after` the API only
    //     ever returns the newest `limit` items, which made older posts unselectable.
    const params = new URLSearchParams({
      fields: MEDIA_FIELDS,
      limit: String(limit),
      access_token: accessToken,
    })
    if (after) params.set("after", after)

    // Storiess live on a separate edge — /me/media never returns them.
    const url = `https://graph.instagram.com/me/${source}?${params.toString()}`

    console.log(`[v0] Fetching ${source} page (limit=${limit}${after ? ", paged" : ""})`)

    const res = await fetch(url, { cache: "no-store" })
    const data = await res.json()

    if (data.error) {
      await logInstagramApiError(
        supabase,
        { step: `${source}_list`, userId: user.id, username: user.username },
        data.error,
      )
      // Agar Token Invalid hai, to user ko Logout karne bolenge frontend pe
      if (data.error.code === 190) {
        return NextResponse.json({ error: "Session Expired. Please Logout & Login." }, { status: 401 })
      }
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const items = data.data || []
    // Only advertise a next page when Instagram actually gives one.
    const nextCursor = data.paging?.next ? data.paging?.cursors?.after || null : null

    return NextResponse.json({
      data: items,
      nextCursor,
      hasMore: Boolean(nextCursor),
    })
  } catch (error) {
    console.error("[v0] Server Error:", error)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
