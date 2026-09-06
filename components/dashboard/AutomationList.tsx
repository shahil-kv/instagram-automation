"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trash2, Globe, Instagram, Zap, ArrowRight, Lock, MessageCircle, Send } from "lucide-react"
import type { Automation } from "@/lib/types"
import { Pagination } from "@/components/dashboard/Pagination"

const PAGE_SIZE = 10

interface AutomationListProps {
  automations: Automation[]
  onDelete: (id: string) => void
  userId: string
}

export function AutomationList({ automations, onDelete, userId }: AutomationListProps) {
  const [mediaMap, setMediaMap] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)

  // Global rules first, then post-specific — one flat list so pages stay full.
  const ordered = useMemo(() => {
    const global = automations.filter((rule) => !rule.specific_media_id)
    const specific = automations.filter((rule) => rule.specific_media_id)
    return [...global, ...specific]
  }, [automations])

  const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE))
  // Deleting the last rule on the final page must not strand you on an empty one.
  const safePage = Math.min(page, totalPages)
  const visible = ordered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const neededIds = useMemo(
    () => visible.map((r) => r.specific_media_id).filter(Boolean) as string[],
    [visible],
  )

  // Ids we've already asked for. Without this, a deleted post never lands in
  // mediaMap, stays "missing", and the effect refetches itself forever.
  const requestedIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const missing = neededIds.filter((id) => !requestedIds.current.has(id))
    if (!userId || missing.length === 0) return
    missing.forEach((id) => requestedIds.current.add(id))

    const fetchMedia = async () => {
      try {
        // Fetch thumbnails by id for the rules on THIS page. The old code pulled
        // the first 24 posts and hoped, so rules on older posts had no thumbnail.
        const res = await fetch(
          `/api/instagram/media?userId=${userId}&ids=${encodeURIComponent(missing.join(","))}`,
        )
        const data = await res.json()
        if (data.data && Array.isArray(data.data)) {
          setMediaMap((prev) => {
            const map = { ...prev }
            data.data.forEach((item: any) => {
              if (item?.id) map[item.id] = item.thumbnail_url || item.media_url
            })
            return map
          })
        }
      } catch (e) { console.error("Failed to load thumbnails", e) }
    }
    fetchMedia()
  }, [userId, neededIds])

  if (automations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
          <Zap className="w-7 h-7 text-neutral-600" />
        </div>
        <h3 className="text-base font-bold text-white mb-1">No automations yet</h3>
        <p className="text-sm text-neutral-500 max-w-sm mx-auto">
          Create your first automation above — it just takes 30 seconds.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500 flex items-center gap-2">
          Active Rules
          <span className="bg-white/10 text-white px-2 py-0.5 rounded-full text-[10px]">{automations.length}</span>
        </h2>
        {totalPages > 1 && (
          <span className="text-[10px] text-neutral-600">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, ordered.length)} of {ordered.length}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {visible.map((rule, idx) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            onDelete={onDelete}
            index={idx}
            mediaUrl={mediaMap[rule.specific_media_id || ""]}
            isSpecific={Boolean(rule.specific_media_id)}
          />
        ))}
      </div>

      <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}

function RuleCard({ rule, onDelete, index, isSpecific, mediaUrl }: {
  rule: Automation
  onDelete: (id: string) => void
  index: number
  isSpecific?: boolean
  mediaUrl?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const keywords = rule.trigger_value.split(",").map(k => k.trim()).filter(Boolean)
  const isCard = !!rule.response_content?.card
  const responsePreview = isCard
    ? rule.response_content?.card?.title
    : rule.response_content?.message?.slice(0, 50) + ((rule.response_content?.message?.length ?? 0) > 50 ? "..." : "")

  return (
    <div
      className="group px-3 py-2.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all duration-200"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        {/* Left icon */}
        {isSpecific ? (
          <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
            {mediaUrl ? (
              <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Instagram className="w-4 h-4 text-neutral-600" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
            <Globe className="w-4 h-4 text-blue-400" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">{rule.name}</h4>
              <span
                className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isSpecific
                  ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                  : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  }`}
              >
                {isSpecific ? "Post" : "Global"}
              </span>
            </div>
            {confirming ? (
              <div className="flex items-center gap-1 animate-in fade-in">
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} className="h-7 text-xs text-neutral-500">Cancel</Button>
                <Button size="sm" onClick={() => onDelete(rule.id)} className="h-7 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20">Delete</Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirming(true)}
                className="h-7 w-7 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Trigger → Response flow */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Keywords */}
            <div className="flex items-center gap-1 flex-wrap">
              {keywords.slice(0, 3).map((kw, i) => (
                <Badge key={i} variant="secondary" className="bg-white/5 text-neutral-300 border border-white/10 text-[10px] font-mono px-1.5 py-0">
                  {kw}
                </Badge>
              ))}
              {keywords.length > 3 && (
                <span className="text-[10px] text-neutral-600">+{keywords.length - 3}</span>
              )}
            </div>

            <ArrowRight className="w-3 h-3 text-neutral-600 shrink-0" />

            {/* Response type */}
            <div className="flex items-center gap-1.5">
              {isCard ? (
                <Send className="w-3 h-3 text-blue-400" />
              ) : (
                <MessageCircle className="w-3 h-3 text-emerald-400" />
              )}
              <span className="text-[11px] text-neutral-400 truncate max-w-[120px]">{responsePreview}</span>
            </div>

            {rule.response_content?.check_follow && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] px-1.5 py-0">
                <Lock className="w-2.5 h-2.5 mr-0.5" /> Follow
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
