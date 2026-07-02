import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get("insta_session")?.value

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  try {
    const parsed = JSON.parse(session)
    if (!parsed?.userId || !parsed?.username) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    return NextResponse.json({
      authenticated: true,
      userId: String(parsed.userId),
      username: String(parsed.username),
    })
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
}
