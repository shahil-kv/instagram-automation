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
            // CASE B: Restore Session from LocalStorage
            else {
                const savedId = localStorage.getItem("ig_user_id")
                const savedName = localStorage.getItem("ig_username")

                if (savedId && savedName) {
                    setUserId(savedId)
                    setUsername(savedName)
                } else {
                    try {
                        const res = await fetch("/api/auth/session")
                        const data = await res.json()

                        if (res.ok && data.authenticated) {
                            localStorage.setItem("ig_user_id", data.userId)
                            localStorage.setItem("ig_username", data.username)
                            setUserId(data.userId)
                            setUsername(data.username)
                        }
                    } catch (err) {
                        console.error("Session restore failed:", err)
                    }
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = () => {
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        document.cookie = "insta_session=; Max-Age=0; path=/;"
        setUsername(null)
        setUserId(null)
        router.push("/")
    }

    return { userId, username, isLoading, logout }
}
