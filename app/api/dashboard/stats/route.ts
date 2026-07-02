import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId")
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // 1. Total Automations
        const { count: automationsCount } = await supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)

        // 2. Active Triggers
        const { count: activeTriggersCount } = await supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("is_active", true)

        // 3. Automation Sends
        const { count: automationSendsCount } = await supabase
            .from("webhook_events")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .in("event_type", ["comment_automation_sent", "dm_automation_sent"])

        // 4. Audience reached from recent automation event logs
        const { data: audienceEvents } = await supabase
            .from("webhook_events")
            .select("data")
            .eq("user_id", userId)
            .in("event_type", ["comment_automation_sent", "dm_automation_sent"])
            .order("processed_at", { ascending: false })
            .limit(1000)

        // 5. Recent Activity
        const { data: recentEvents } = await supabase
            .from("webhook_events")
            .select("id, event_type, data, processed_at")
            .eq("user_id", userId)
            .in("event_type", ["comment_automation_sent", "dm_automation_sent"])
            .order("processed_at", { ascending: false })
            .limit(5)

        const uniqueAudience = new Set(
            (audienceEvents || [])
                .map((event: any) => event.data?.sender_id)
                .filter(Boolean)
        )

        return NextResponse.json({
            metrics: {
                totalAutomations: automationsCount || 0,
                activeTriggers: activeTriggersCount || 0,
                audienceReached: uniqueAudience.size,
                automationSends: automationSendsCount || 0,
            },
            recentActivity: (recentEvents || []).map((event: any) => ({
                id: event.id,
                content: event.data?.reply_preview || event.data?.automation_name || event.event_type,
                created_at: event.processed_at,
                recipient: {
                    recipient_username: event.data?.sender_id || "user",
                },
            }))
        })
    } catch (error) {
        console.error("[v0] Dashboard Stats error:", error)
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
}
