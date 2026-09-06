import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getFreshAccessToken, logInstagramApiError } from "@/lib/instagram-token"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("userId")

    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    // 1. Get Access Token
    const { data: user } = await supabase
      .from("users")
      .select("id, username, access_token, token_expires_at") // Business ID ki zaroorat nahi hai ab
      .eq("id", userId)
      .single()

    if (!user?.access_token) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    // Refresh the long-lived token if it is inside the expiry window.
    const accessToken = await getFreshAccessToken(supabase, user)

    // 2. Fetch Media (Smart Method: /me/media)
    // Ye 'instagram.com' use karega jo aapke token ke saath compatible hai.
    // Hum '/me' use kar rahe hain taaki ID mismatch ka lafda hi na ho.
    const url = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=24&access_token=${encodeURIComponent(accessToken)}`
    
    console.log("[v0] Fetching Media from: https://graph.instagram.com/me/media (token redacted)")

    const res = await fetch(url, { cache: 'no-store' }) 
    const data = await res.json()

    if (data.error) {
      await logInstagramApiError(supabase, { step: "media_list", userId: user.id, username: user.username }, data.error)
      // Agar Token Invalid hai, to user ko Logout karne bolenge frontend pe
      if (data.error.code === 190) {
         return NextResponse.json({ error: "Session Expired. Please Logout & Login." }, { status: 401 })
      }
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data.data || [] })
  } catch (error) {
    console.error("[v0] Server Error:", error)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
