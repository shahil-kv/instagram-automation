"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
}

/**
 * Numbered pagination. Safe for Supabase-backed lists where the full set is
 * known — unlike the Instagram media edge, which is cursor-only and cannot
 * jump to an arbitrary page.
 *
 * Collapses to 1 … 4 5 6 … 12 so the control never wraps on mobile.
 */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)

    const pages: (number | "gap")[] = [1]
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)

    if (start > 2) pages.push("gap")
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < totalPages - 1) pages.push("gap")

    pages.push(totalPages)
    return pages
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
    if (totalPages <= 1) return null

    const pages = pageWindow(page, totalPages)

    return (
        <div className="flex items-center justify-center gap-1 pt-2">
            <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={page === 1}
                aria-label="Previous page"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 transition-colors"
            >
                <ChevronLeft className="w-4 h-4" />
            </button>

            {pages.map((p, i) =>
                p === "gap" ? (
                    <span key={`gap-${i}`} className="px-1 text-neutral-700 text-xs select-none">
                        …
                    </span>
                ) : (
                    <button
                        key={p}
                        type="button"
                        onClick={() => onPageChange(p)}
                        aria-current={p === page ? "page" : undefined}
                        className={`h-8 min-w-8 px-2 rounded-lg text-xs font-bold transition-all ${p === page
                            ? "bg-white text-black"
                            : "text-neutral-500 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        {p}
                    </button>
                ),
            )}

            <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={page === totalPages}
                aria-label="Next page"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 transition-colors"
            >
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    )
}
