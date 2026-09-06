/**
 * Builds the Instagram message payload for an automation's stored response.
 * The same text/card shape was inlined in three separate places in the webhook;
 * the follow gate needs it as a value it can send later, not inline.
 */
export function buildResponseMessage(content: any): any | null {
    if (!content) return null

    if (content.message) {
        return { text: content.message }
    }

    if (content.card) {
        const card = content.card
        const apiButtons = (card.buttons || []).map((b: any) => ({
            type: b.type,
            title: b.title,
            url: b.url || undefined,
            payload: b.payload || undefined,
        }))

        const element: any = { title: card.title, buttons: apiButtons }
        if (card.subtitle) element.subtitle = card.subtitle
        if (card.image_url && String(card.image_url).startsWith("http")) element.image_url = card.image_url

        return {
            attachment: {
                type: "template",
                payload: { template_type: "generic", elements: [element] },
            },
        }
    }

    return null
}
