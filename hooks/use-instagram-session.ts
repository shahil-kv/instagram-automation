"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"

export function useInstagramSession() {
    const [username, setUsername] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const searchParams = useSearchParams()
    const router = useRouter()

    useEffect(() => {
        const code = searchParams.get("code")

        const handleSession = async () => {
            // CASE A: New Login from Instagram
            if (code) {
                const pendingKey = `ig_auth_code_pending:${code}`
                if (sessionStorage.getItem(pendingKey)) {
                    setIsLoading(false)
                    return
                }

                sessionStorage.setItem(pendingKey, "true")

                try {
                    const res = await fetch("/api/instagram/callback", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code }),
                    })
                    const data = await res.json()

                    if (data.success) {
                        localStorage.setItem("ig_user_id", data.userId)
                        localStorage.setItem("ig_username", data.username)

                        setUserId(data.userId)
                        setUsername(data.username)
                        // Remove code from URL
                        router.replace("/dashboard")
                    } else {
                        console.error("Login failed:", data.error)
                        router.replace("/")
                    }
                } catch (err) {
                    sessionStorage.removeItem(pendingKey)
                    console.error("Login failed:", err)
                }
            }
            // CASE B: Restore Session
            else {
                // localStorage is only an optimistic cache so the shell paints
                // immediately — the signed cookie on the server is the truth.
                const savedId = localStorage.getItem("ig_user_id")
                const savedName = localStorage.getItem("ig_username")

                if (savedId && savedName) {
                    setUserId(savedId)
                    setUsername(savedName)
                }

                try {
                    const res = await fetch("/api/auth/session")
                    const data = await res.json()

                    if (res.ok && data.authenticated) {
                        localStorage.setItem("ig_user_id", data.userId)
                        localStorage.setItem("ig_username", data.username)
                        setUserId(data.userId)
                        setUsername(data.username)
                    } else {
                        // Stale cache with no valid cookie: showing a signed-in
                        // shell here would just 401 on every request.
                        localStorage.removeItem("ig_user_id")
                        localStorage.removeItem("ig_username")
                        setUserId(null)
                        setUsername(null)
                    }
                } catch (err) {
                    console.error("Session restore failed:", err)
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = async () => {
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        // The cookie is httpOnly now, so only the server can clear it.
        try {
            await fetch("/api/auth/logout", { method: "POST" })
        } catch (err) {
            console.error("Logout failed:", err)
        }
        setUsername(null)
        setUserId(null)
        router.push("/")
    }

    return { userId, username, isLoading, logout }
}
