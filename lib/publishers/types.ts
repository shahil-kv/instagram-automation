export type Platform = "instagram" | "youtube"

export type TargetStatus = "pending" | "processing" | "published" | "failed"

export type PostJob = {
    id: string
    user_id: number
    video_url: string
    thumbnail_url: string | null
    title: string | null
    caption: string | null
    /** Append #Shorts to the YouTube description. Defaults to true. */
    youtube_shorts?: boolean | null
}

export type PostTarget = {
    id: string
    job_id: string
    user_id: number
    platform: Platform
    status: TargetStatus
    external_ref: string | null
    external_id: string | null
    permalink: string | null
    privacy: string | null
    error_message: string | null
    attempts: number
}

/**
 * Result of advancing one target by one step.
 *
 * Both platforms are multi-step (Instagram transcodes before it will publish,
 * YouTube has to receive the bytes), so `tick` is called repeatedly until the
 * status is terminal. `processing` means call again.
 */
export type TickResult = {
    status: TargetStatus
    external_ref?: string | null
    external_id?: string | null
    permalink?: string | null
    privacy?: string | null
    error_message?: string | null
    /** Shown in the UI while the target is still working. */
    note?: string
    /**
     * 0-100 for platforms that can report it. YouTube knows exactly how many
     * bytes it has accepted; Instagram transcodes opaquely, so it stays
     * undefined there and the UI shows an indeterminate state.
     */
    progress?: number
    /**
     * Which named step the target is on, so the UI can show a real checklist
     * instead of one undifferentiated spinner.
     */
    stage?: Stage
}

/** Ordered publish steps, per platform. */
export type Stage =
    | "ig_container"
    | "ig_transcoding"
    | "ig_publishing"
    | "yt_session"
    | "yt_uploading"
    | "yt_processing"
    | "done"
