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

/**
 * Shorts eligibility, as YouTube actually decides it.
 *
 * There is no API field that marks an upload as a Short. YouTube classifies
 * automatically from the file: aspect ratio 1:1 or taller, and duration up to
 * 3 minutes (1080p max resolution). `#Shorts` in the description is only a
 * hint that helps classification and discovery — it cannot override the file.
 */
export const SHORTS_MAX_SECONDS = 3 * 60
export const SHORTS_TAG = "#Shorts"

export type PostText = {
    title?: string | null
    description?: string | null
}

/** Would YouTube treat this file as a Short? */
export function shortsEligibility(width: number, height: number, duration: number) {
    const vertical = height >= width
    const shortEnough = duration > 0 && duration <= SHORTS_MAX_SECONDS

    return {
        eligible: vertical && shortEnough,
        vertical,
        shortEnough,
        reason: !vertical
            ? "The video is landscape — Shorts must be square or vertical, so YouTube will publish this as a regular video."
            : !shortEnough
              ? `The video is longer than 3 minutes — YouTube will publish it as a regular video, not a Short.`
              : null,
    }
}

/** Instagram: one blob, title first so it lands above the fold. */
export function buildInstagramCaption({ title, description }: PostText): string {
    return [title?.trim(), description?.trim()].filter(Boolean).join("\n\n")
}

/**
 * YouTube: title and description stay separate, title hard-capped at 100.
 *
 * With `shorts`, #Shorts is appended to the description (not the title, which
 * only has 100 characters to spare). Skipped if the text already carries it.
 */
export function buildYouTubeFields(
    { title, description }: PostText,
    options: { shorts?: boolean } = {},
) {
    const body = description?.trim() || ""
    const alreadyTagged = /#shorts\b/i.test(`${title ?? ""} ${body}`)

    const withTag =
        options.shorts && !alreadyTagged ? (body ? `${body}\n\n${SHORTS_TAG}` : SHORTS_TAG) : body

    return {
        title: (title?.trim() || "Untitled").slice(0, TITLE_MAX),
        description: withTag.slice(0, YT_DESCRIPTION_MAX),
    }
}

/** The line Instagram shows before "… more". */
export function instagramFirstLine(text: PostText): string {
    return buildInstagramCaption(text).split("\n")[0] ?? ""
}
