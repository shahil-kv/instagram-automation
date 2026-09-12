import type { SupabaseClient } from "@supabase/supabase-js"

export const MEDIA_BUCKET = "reels"

/**
 * Fallback ceiling when the bucket has no explicit `file_size_limit`.
 *
 * A null bucket limit means "inherit the project global", which the Storage
 * API does not expose — so we need a number from somewhere. 50 MB is the
 * Supabase Free plan cap (verified by probing this project: 50 MB accepted,
 * 51 MB rejected with EntityTooLarge). Raise STORAGE_MAX_BYTES after upgrading
 * the plan, or set the bucket's file_size_limit and this is read from there.
 */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

/** Cached so we don't query the bucket on every upload. */
let cachedLimit: { value: number; at: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Largest file the bucket will accept, in bytes.
 *
 * Checked before the browser starts sending, so an oversize file fails in a
 * millisecond with a useful message instead of after a full upload.
 */
export async function getUploadLimitBytes(supabase: SupabaseClient): Promise<number> {
    const envOverride = Number(process.env.STORAGE_MAX_BYTES)
    if (envOverride > 0) return envOverride

    if (cachedLimit && Date.now() - cachedLimit.at < CACHE_TTL_MS) {
        return cachedLimit.value
    }

    try {
        const { data } = await supabase.storage.getBucket(MEDIA_BUCKET)
        const value = data?.file_size_limit ? Number(data.file_size_limit) : DEFAULT_MAX_BYTES
        cachedLimit = { value, at: Date.now() }
        return value
    } catch {
        return DEFAULT_MAX_BYTES
    }
}

/**
 * Recover the storage path from a public URL we generated.
 *
 * Public URLs look like:
 *   https://<ref>.supabase.co/storage/v1/object/public/reels/<userId>/<ts>.mp4
 *
 * Returns null for anything that isn't one of ours, so an imported or
 * hand-entered URL is never treated as a deletable object.
 */
export function storagePathFromPublicUrl(publicUrl: string): string | null {
    const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`
    const index = publicUrl.indexOf(marker)
    if (index === -1) return null

    const path = publicUrl.slice(index + marker.length).split("?")[0]
    return path || null
}

/**
 * Delete the staged video once every platform has its own copy.
 *
 * Storage here is a staging area, not a library: Instagram fetches the file
 * from the public URL and YouTube receives the bytes, so after both succeed
 * the object is dead weight against the plan's storage quota.
 *
 * Best-effort by design — a failed cleanup must never fail a published post.
 */
export async function deleteStagedVideo(
    supabase: SupabaseClient,
    publicUrl: string,
): Promise<boolean> {
    if (process.env.KEEP_UPLOADS_AFTER_PUBLISH === "true") return false

    const path = storagePathFromPublicUrl(publicUrl)
    if (!path) return false

    try {
        const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path])
        if (error) {
            console.warn(`[storage] Could not clean up ${path}: ${error.message}`)
            return false
        }
        console.log(`[storage] Cleaned up ${path} — both platforms have their own copy`)
        return true
    } catch (err) {
        console.warn("[storage] Cleanup threw:", err)
        return false
    }
}
