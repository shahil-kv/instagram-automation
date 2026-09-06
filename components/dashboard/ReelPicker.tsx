"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Film, Loader2 } from "lucide-react"

const PAGE_SIZE = 24
/** Safety valve so a search with no matches cannot page forever. */
const MAX_PAGES = 20

interface ReelPickerProps {
    userId: string
    triggerSource: "comment" | "dm" | "story"
    onSelect: (reel: any) => void
}

function isStoryItem(item: any) {
    return item?.media_type === "STORY" || item?.media_product_type === "STORY"
}

function labelFor(item: any) {
    if (isStoryItem(item)) return "Story"
    if (item.media_product_type === "REELS" || item.media_type === "VIDEO") return "Reel"
    if (item.media_type === "CAROUSEL_ALBUM") return "Carousel"
    return "Post"
}

/**
 * Defined at module scope on purpose. It used to be declared inside
 * CreateRuleForm's render, which made React treat it as a brand new component
 * type on every keystroke — remounting it, dropping input focus and resetting
 * scroll. That is fatal once the list pages.
 */
export function ReelPicker({ userId, triggerSource, onSelect }: ReelPickerProps) {
    const [items, setItems] = useState<any[]>([])
    const [hasMore, setHasMore] = useState(true)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [pagesLoaded, setPagesLoaded] = useState(0)

    const sentinelRef = useRef<HTMLDivElement | null>(null)
    const seenIds = useRef<Set<string>>(new Set())
    // Held in a ref, not state: loadPage must read the latest cursor without
    // being re-created (which would restart the IntersectionObserver mid-scroll).
    const cursorRef = useRef<string | null>(null)
    // Guards against overlapping loads without waiting for a state flush.
    const inFlight = useRef(false)

    const source = triggerSource === "story" ? "stories" : "media"

    const loadPage = useCallback(async () => {
        if (inFlight.current || !userId) return
        inFlight.current = true
        setLoading(true)
        setError(null)

        try {
            const params = new URLSearchParams({ userId, limit: String(PAGE_SIZE), source })
            if (cursorRef.current) params.set("after", cursorRef.current)

            const res = await fetch(`/api/instagram/media?${params.toString()}`)
            const json = await res.json()

            if (!res.ok) {
                setError(json.error || "Could not load media")
                setHasMore(false)
                return
            }

            const fresh = (json.data || []).filter((item: any) => {
                if (!item?.id || seenIds.current.has(item.id)) return false
                seenIds.current.add(item.id)
                return true
            })

            setItems((prev) => [...prev, ...fresh])
            cursorRef.current = json.nextCursor || null
            setHasMore(Boolean(json.hasMore && json.nextCursor))
            setPagesLoaded((p) => p + 1)
        } catch (e: any) {
            setError(e?.message || "Could not load media")
            setHasMore(false)
        } finally {
            inFlight.current = false
            setLoading(false)
        }
    }, [userId, source])

    // Reset and reload when the source changes (comments ↔ stories).
    useEffect(() => {
        seenIds.current = new Set()
        cursorRef.current = null
        setItems([])
        setHasMore(true)
        setPagesLoaded(0)
        setError(null)
    }, [source])

    useEffect(() => {
        if (items.length === 0 && hasMore && pagesLoaded === 0) loadPage()
    }, [items.length, hasMore, pagesLoaded, loadPage])

    // Infinite scroll. While a search is active the filtered list stays short, so
    // the sentinel remains visible and keeps paging until a match turns up or the
    // account runs out of posts — which is what makes search work past page one.
    useEffect(() => {
        const el = sentinelRef.current
        if (!el || !hasMore || pagesLoaded >= MAX_PAGES) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && !inFlight.current) loadPage()
            },
            { root: el.closest("[data-picker-scroll]"), rootMargin: "120px" },
        )

        observer.observe(el)
        return () => observer.disconnect()
    }, [hasMore, pagesLoaded, loadPage, items.length])

    const filtered = useMemo(() => {
        const bySource = triggerSource === "story" ? items.filter(isStoryItem) : items
        const q = query.trim().toLowerCase()
        if (!q) return bySource
        return bySource.filter((item) => (item.caption || "").toLowerCase().includes(q))
    }, [items, query, triggerSource])

    const reachedCap = pagesLoaded >= MAX_PAGES && hasMore

    return (
        <div className="absolute top-full left-0 right-0 mt-2 bg-neutral-950 border border-white/10 rounded-xl z-50 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-2 border-b border-white/10">
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search posts..."
                    className="h-8 text-xs bg-white/5 border-white/10"
                    autoFocus
                />
            </div>

            <div className="max-h-72 overflow-y-auto" data-picker-scroll>
                {filtered.length === 0 && !loading && (
                    <div className="p-4 text-center">
                        <p className="text-neutral-500 text-sm">
                            {error
                                ? error
                                : triggerSource === "story"
                                    ? "No active stories"
                                    : query
                                        ? "No posts match that search"
                                        : "No posts found"}
                        </p>
                    </div>
                )}

                {filtered.map((reel: any) => {
                    const imageUrl = reel.thumbnail_url || reel.media_url
                    return (
                        <button
                            key={reel.id}
                            type="button"
                            onClick={() => onSelect(reel)}
                            className="w-full p-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
                        >
                            {imageUrl ? (
                                <img src={imageUrl} alt="" className="w-10 h-10 rounded object-cover opacity-80" />
                            ) : (
                                <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center">
                                    <Film className="w-4 h-4 text-neutral-600" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">{reel.caption || "Untitled"}</p>
                                <span className="text-[10px] text-neutral-500 uppercase">{labelFor(reel)}</span>
                            </div>
                        </button>
                    )
                })}

                {/* Sentinel: entering view pulls the next page. */}
                {hasMore && !reachedCap && <div ref={sentinelRef} className="h-8" />}

                {loading && (
                    <div className="flex items-center justify-center gap-2 p-3 text-neutral-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-xs">Loading more…</span>
                    </div>
                )}

                {reachedCap && (
                    <button
                        type="button"
                        onClick={() => {
                            setPagesLoaded(0)
                            loadPage()
                        }}
                        className="w-full p-3 text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        Load more posts
                    </button>
                )}
            </div>

            {items.length > 0 && (
                <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-neutral-600">
                    {query ? `${filtered.length} of ${items.length} loaded` : `${items.length} loaded`}
                    {hasMore ? " · scroll for more" : " · all loaded"}
                </div>
            )}
        </div>
    )
}
