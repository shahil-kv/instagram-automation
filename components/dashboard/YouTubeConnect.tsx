"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Youtube, AlertTriangle, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

export type YouTubeStatus = {
    connected: boolean
    channelTitle?: string | null
    needsReconnect?: boolean
}

interface YouTubeConnectProps {
    status: YouTubeStatus | null
    loading: boolean
    onChange: () => void
}

export function YouTubeConnect({ status, loading, onChange }: YouTubeConnectProps) {
    const [disconnecting, setDisconnecting] = useState(false)

    // Surface the outcome of the OAuth round trip, then clean the URL.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const error = params.get("yt_error")
        const connected = params.get("yt_connected")

        if (error) toast.error(`YouTube connection failed: ${error}`)
        if (connected) toast.success("YouTube channel connected")

        if (error || connected) {
            window.history.replaceState({}, "", window.location.pathname)
            onChange()
        }
    }, [onChange])

    const disconnect = async () => {
        setDisconnecting(true)
        try {
            const res = await fetch("/api/youtube/status", { method: "DELETE" })
            if (!res.ok) throw new Error(await res.text())
            toast.success("YouTube channel disconnected")
            onChange()
        } catch {
            toast.error("Could not disconnect")
        } finally {
            setDisconnecting(false)
        }
    }

    return (
        <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-600/15 border border-red-600/30 flex items-center justify-center">
                        <Youtube className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">YouTube</p>
                        {loading ? (
                            <p className="text-xs text-neutral-500">Checking…</p>
                        ) : status?.connected ? (
                            <p className="text-xs text-neutral-400 truncate">
                                {status.channelTitle || "Connected channel"}
                            </p>
                        ) : (
                            <p className="text-xs text-neutral-500">Not connected</p>
                        )}
                    </div>
                    {!loading && status?.connected && (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 shrink-0">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Ready
                        </Badge>
                    )}
                </div>

                {status?.needsReconnect && (
                    <p className="flex gap-2 text-xs text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        No refresh token stored — this connection expires within the hour. Remove the app
                        under your Google account permissions, then reconnect.
                    </p>
                )}

                <div className="flex gap-2">
                    {status?.connected ? (
                        <>
                            <Button asChild variant="outline" size="sm" className="flex-1">
                                <a href="/api/youtube/connect">Reconnect</a>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={disconnect}
                                disabled={disconnecting}
                                className="text-neutral-400 hover:text-red-400"
                            >
                                {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disconnect"}
                            </Button>
                        </>
                    ) : (
                        <Button asChild size="sm" className="w-full" disabled={loading}>
                            <a href="/api/youtube/connect">Connect YouTube</a>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
