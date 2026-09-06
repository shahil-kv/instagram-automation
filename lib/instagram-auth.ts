/**
 * Isomorphic Instagram OAuth helpers (safe to import from Client Components).
 * Server-only token operations live in `lib/instagram-token.ts`.
 */

/**
 * Scopes MUST match the permissions actually granted on the Meta app
 * (App Dashboard → Permissions and features). Requesting a permission the app
 * does not hold makes Instagram fail the authorize call with a misleading
 * "Invalid redirect_uri" error.
 *
 * Add `instagram_business_content_publish` / `instagram_business_manage_insights`
 * here ONLY after those permissions are approved on the app.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const

export const INSTAGRAM_AUTHORIZE_ENDPOINT = "https://www.instagram.com/oauth/authorize"

/**
 * Builds the authorize URL. URLSearchParams encodes redirect_uri and scope,
 * so the values never need hand-rolled escaping.
 */
export function buildInstagramAuthorizeUrl(options?: { state?: string }) {
  const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID
  const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

  if (!clientId || !redirectUri) {
    throw new Error(
      "Missing NEXT_PUBLIC_INSTAGRAM_APP_ID or NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI",
    )
  }

  const params = new URLSearchParams({
    client_id: clientId,
    // Must be byte-identical to the redirect_uri sent in the token exchange.
    redirect_uri: redirectUri,
    response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","),
  })

  if (options?.state) params.set("state", options.state)

  return `${INSTAGRAM_AUTHORIZE_ENDPOINT}?${params.toString()}`
}

/**
 * Instagram appends a literal `#_` to the redirect. Browsers usually keep it in
 * the fragment, but it leaks into the code often enough that the exchange fails
 * with "Invalid authorization code". Strip it (and any stray whitespace) before use.
 */
export function normalizeAuthCode(code: string) {
  return code.trim().replace(/#_+$/, "")
}
