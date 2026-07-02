"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { LandingPage } from "@/components/layout/landing-page"
import { Loader2 } from "lucide-react"

export default function Home() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let isMounted = true

    // Check if we have an active session or a callback code
    const code = searchParams.get("code")
    const savedId = localStorage.getItem("ig_user_id")

    if (code) {
      // If code exists, Redirect to dashboard to handle the handshake (via the new hook)
      router.replace("/dashboard?code=" + code)
      return
    }

    if (savedId) {
      router.replace("/dashboard")
      return
    }

    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.authenticated) return
        localStorage.setItem("ig_user_id", data.userId)
        localStorage.setItem("ig_username", data.username)
        router.replace("/dashboard")
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsCheckingSession(false)
      })

    return () => {
      isMounted = false
    }
  }, [searchParams, router])

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white" />
      </div>
    )
  }

  return <LandingPage />
}
