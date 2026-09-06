/**
 * Instagram User Profile API — the only way to verify follow status.
 *
 * Verified against a live account: `is_user_follow_business` returns a real
 * boolean, but ONLY once the user has given consent by messaging the business
 * (a DM, an ice breaker tap, or a button tap). A user who merely commented
 * returns error code 230, "User consent is required to access user profile".
 *
 * That constraint is what forces the two-step gate: reply to the comment with a
 * button first, then check follow status once they tap it.
 *
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile
 */

export type FollowStatus =
    /** Confirmed follower. */
    | "follower"
    /** Confirmed NOT a follower. */
    | "not_follower"
    /** Consent not granted yet — they have not messaged us. Not a failure. */
    | "no_consent"
    /** Lookup failed for some other reason. */
    | "error"

export interface FollowCheckResult {
    status: FollowStatus
    username?: string
    followerCount?: number
    error?: any
}

/** Meta's code for "this user has not consented to a profile lookup". */
const CONSENT_REQUIRED_CODE = 230

export async function checkFollowStatus(
    igsid: string,
    accessToken: string,
): Promise<FollowCheckResult> {
    if (!igsid || !accessToken) return { status: "error", error: { message: "Missing igsid or token" } }

    try {
        const res = await fetch(
            `https://graph.instagram.com/v24.0/${encodeURIComponent(igsid)}` +
            `?fields=username,follower_count,is_user_follow_business&access_token=${encodeURIComponent(accessToken)}`,
            { cache: "no-store" },
        )
        const data = await res.json()

        if (data.error) {
            const code = Number(data.error.code)
            if (code === CONSENT_REQUIRED_CODE) return { status: "no_consent", error: data.error }
            return { status: "error", error: data.error }
        }

        // Treat a missing field as unknown rather than silently "not a follower" —
        // wrongly locking out a real follower is worse than letting one through.
        if (typeof data.is_user_follow_business !== "boolean") {
            return { status: "error", username: data.username, error: { message: "is_user_follow_business absent" } }
        }

        return {
            status: data.is_user_follow_business ? "follower" : "not_follower",
            username: data.username,
            followerCount: data.follower_count,
        }
    } catch (e: any) {
        return { status: "error", error: { message: e?.message || String(e) } }
    }
}

/** Postback payload that (re)runs the follow check for a rule. */
export const FOLLOW_CHECK_PREFIX = "FOLLOW_CHECK_"

export function followCheckPayload(ruleId: string) {
    return `${FOLLOW_CHECK_PREFIX}${ruleId}`
}

/**
 * Button template — a plain text bubble with buttons underneath, which is how
 * ManyChat's Instagram DMs render. The generic (card) template was wrong here:
 * it draws card chrome and truncates the subtitle near 80 characters, whereas
 * this allows 640.
 *
 * Instagram allows 1-3 buttons; titles should stay short (~20 chars) or they
 * get clipped on narrow screens.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/button-template/
 */
function buttonTemplate(text: string, buttons: any[]) {
    return {
        attachment: {
            type: "template",
            payload: {
                template_type: "button",
                text: text.slice(0, 640),
                buttons: buttons.slice(0, 3),
            },
        },
    }
}

/**
 * Step 1 — sent when follow status cannot be read yet (the usual case for a
 * commenter). Tapping the button is what grants consent for the real check.
 */
export function buildUnlockPrompt(ruleId: string, _gateMessage?: string) {
    return buttonTemplate("Hey! I've got that link for you 👇", [
        { type: "postback", title: "Send me the link 🔗", payload: followCheckPayload(ruleId) },
    ])
}

/** Step 2 — sent when the API confirms they are NOT following. */
export function buildFollowGateCard(ruleId: string, username: string, gateMessage?: string) {
    const text =
        gateMessage ||
        `🔒 One quick thing — follow @${username} first, it really helps me keep making videos like this`

    return buttonTemplate(text, [
        { type: "web_url", url: `https://instagram.com/${username}`, title: "Follow" },
        // Same payload — every tap re-runs the real API check.
        { type: "postback", title: "I followed ✅", payload: followCheckPayload(ruleId) },
    ])
}
