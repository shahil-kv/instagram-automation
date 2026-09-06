"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Clock } from "lucide-react"
import { buildInstagramAuthorizeUrl } from "@/lib/instagram-auth"

type ConnectionStatus = {
    connected: boolean
    needsReconnect?: boolean
    expiringSoon?: boolean
    daysLeft?: number | null
    reason?: string | null
    lastErrorStep?: string | null
}

export function ConnectionAlert({ userId }: { userId: string | null }) {
    const [status, setStatus] = useState<ConnectionStatus | null>(null)

    useEffect(() => {
        if (!userId) return
        let active = true

        fetch(`/api/instagram/connection-status?userId=${encodeURIComponent(userId)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (active && data) setStatus(data)
            })
            .catch(() => { })

        return () => {
            active = false
        }
    }, [userId])

    if (!status) return null
    if (!status.needsReconnect && !status.expiringSoon) return null

    const broken = status.needsReconnect

    return (
        <div
            className={`flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${broken
                ? "border-red-500/30 bg-red-500/10 text-red-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                }`}
        >
            <div className="flex items-start gap-3">
                {broken ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="text-xs leading-relaxed">
                    <p className="font-bold">
                        {broken
                            ? "Instagram connection is broken — automations are not running"
                            : `Instagram token expires in ${status.daysLeft} days`}
                    </p>
                    <p className="opacity-80">
                        {broken
                            ? status.reason === "expired"
                                ? "The access token expired. Reconnect to restore comment and DM replies."
                                : `Instagram rejected the token${status.lastErrorStep ? ` on ${status.lastErrorStep}` : ""}. Reconnect to restore comment and DM replies.`
                            : "The daily refresh job should handle this automatically. Reconnect if this warning persists."}
                    </p>
                </div>
            </div>

            <button
                onClick={() => {
                    window.location.href = buildInstagramAuthorizeUrl()
                }}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-widest transition-transform hover:scale-105 ${broken ? "bg-red-500 text-white" : "bg-amber-500 text-black"
                    }`}
            >
                Reconnect Instagram
            </button>
        </div>
    )
}
