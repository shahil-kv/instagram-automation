import { NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session"

/** The session cookie is httpOnly, so the browser cannot clear it itself. */
export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0))
  return response
}
