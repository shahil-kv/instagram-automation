/**
 * How one set of text maps onto two platforms with different shapes.
 *
 * YouTube has a mandatory `title` (100 chars) and a separate `description`.
 * Instagram Reels have neither — just a single caption blob, where the first
 * line is all that shows before the "… more" fold.
 *
 * So the title doubles as Instagram's hook: the caption is title + description
 * merged, which is what a creator would type by hand anyway.
 *
 * Pure and shared on purpose — the composer previews with the exact function
 * the publisher posts with, so the preview cannot drift from reality.
 */

export const TITLE_MAX = 100
export const IG_CAPTION_MAX = 2200
export const YT_DESCRIPTION_MAX = 5000

export type PostText = {
    title?: string | null
    description?: string | null
}

/** Instagram: one blob, title first so it lands above the fold. */
export function buildInstagramCaption({ title, description }: PostText): string {
    return [title?.trim(), description?.trim()].filter(Boolean).join("\n\n")
}

/** YouTube: title and description stay separate, title hard-capped at 100. */
export function buildYouTubeFields({ title, description }: PostText) {
    return {
        title: (title?.trim() || "Untitled").slice(0, TITLE_MAX),
        description: (description?.trim() || "").slice(0, YT_DESCRIPTION_MAX),
    }
}

/** The line Instagram shows before "… more". */
export function instagramFirstLine(text: PostText): string {
    return buildInstagramCaption(text).split("\n")[0] ?? ""
}
