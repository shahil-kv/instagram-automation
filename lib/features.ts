/**
 * Feature switches for dashboard sections.
 *
 * Flip a flag to true to bring a section back — the routes and components are
 * left intact, only the navigation and access are gated.
 */
export const FEATURES = {
    publisher: false,
    iceBreakers: false,
    analytics: false,
    /** Story automations — Instagram serves stories from a separate edge we don't use. */
    stories: false,
} as const

export type FeatureKey = keyof typeof FEATURES

export function isEnabled(feature: FeatureKey) {
    return FEATURES[feature]
}

/** Routes that are switched off, used to bounce direct/bookmarked visits. */
export const DISABLED_ROUTES: string[] = [
    ...(FEATURES.publisher ? [] : ["/dashboard/publisher"]),
    ...(FEATURES.iceBreakers ? [] : ["/dashboard/ice-breakers"]),
    ...(FEATURES.analytics ? [] : ["/dashboard/analytics"]),
]
