/* @ts-nocheck */

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "your_verify_token"
const COMMENT_COOLDOWN_MINUTES = Number(process.env.INSTAGRAM_COMMENT_COOLDOWN_MINUTES || 10)
const COMMENT_HOURLY_LIMIT = Number(process.env.INSTAGRAM_COMMENT_AUTOMATION_HOURLY_LIMIT || 120)
const COMMENT_DAILY_LIMIT = Number(process.env.INSTAGRAM_COMMENT_AUTOMATION_DAILY_LIMIT || 800)

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

async function logAutomationEvent(supabase: any, eventType: string, userId: string | number, data: Record<string, any>) {
  const { error } = await supabase.from("webhook_events").insert({
    event_type: eventType,
    user_id: userId,
    data,
  })

  if (error) console.error(`[v0] ⚠️ Failed to log ${eventType}:`, error.message)
}

async function hasProcessedComment(supabase: any, userId: string | number, commentId: string) {
  const { count, error } = await supabase
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("event_type", ["comment_automation_processing", "comment_automation_sent"])
    .contains("data", { comment_id: commentId })

  if (error) {
    console.error("[v0] ⚠️ Dedupe check failed:", error.message)
    return false
  }

  return Boolean(count)
}

async function getAutomationSafetyBlock(
  supabase: any,
  userId: string | number,
  senderId: string,
  mediaId: string,
) {
  const cooldownSince = minutesAgo(COMMENT_COOLDOWN_MINUTES)
  const oneHourAgo = hoursAgo(1)
  const oneDayAgo = hoursAgo(24)

  const [{ count: cooldownCount, error: cooldownError }, { count: hourlyCount, error: hourlyError }, { count: dailyCount, error: dailyError }] =
    await Promise.all([
      supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "comment_automation_sent")
        .gte("processed_at", cooldownSince)
        .contains("data", { sender_id: senderId, media_id: mediaId }),
      supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "comment_automation_sent")
        .gte("processed_at", oneHourAgo),
      supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "comment_automation_sent")
        .gte("processed_at", oneDayAgo),
    ])

  if (cooldownError || hourlyError || dailyError) {
    console.error("[v0] ⚠️ Safety check failed:", cooldownError?.message || hourlyError?.message || dailyError?.message)
    return "safety_check_failed"
  }

  if ((cooldownCount || 0) > 0) return `cooldown_${COMMENT_COOLDOWN_MINUTES}m`
  if ((hourlyCount || 0) >= COMMENT_HOURLY_LIMIT) return `hourly_limit_${COMMENT_HOURLY_LIMIT}`
  if ((dailyCount || 0) >= COMMENT_DAILY_LIMIT) return `daily_limit_${COMMENT_DAILY_LIMIT}`

  return null
}

function getInstagramErrorCode(error: any) {
  return error?.code || error?.error_subcode || error?.fbtrace_id || "unknown"
}

function isInstagramThrottleError(error: any) {
  const code = Number(error?.code)
  return [4, 17, 32, 613, 80007].includes(code)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Invalid token" }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (process.env.INSTAGRAM_WEBHOOK_DEBUG === "true") {
      console.log("[v0] Instagram webhook raw payload", JSON.stringify(body))
    }

    if (!body.entry) {
      console.log("[v0] Webhook received without entry")
      return NextResponse.json({ ok: true })
    }
    const supabase = await getSupabaseServerClient()

    for (const entry of body.entry) {
      console.log("[v0] Webhook entry", {
        id: entry.id,
        changes: entry.changes?.map((change: any) => ({
          field: change.field,
          hasText: Boolean(change.value?.text),
          hasCommentId: Boolean(change.value?.id),
          hasSender: Boolean(change.value?.from?.id),
          hasMedia: Boolean(change.value?.media?.id),
        })) || [],
        messaging: entry.messaging?.map((event: any) => ({
          keys: Object.keys(event || {}),
          read: Boolean(event.read),
          delivery: Boolean(event.delivery),
          echo: Boolean(event.message?.is_echo),
          reaction: Boolean(event.reaction),
          postback: Boolean(event.postback),
          text: Boolean(event.message?.text),
          sender: Boolean(event.sender?.id),
          recipient: Boolean(event.recipient?.id),
        })) || [],
      })

      // ============================================================
      // 🔇 ECHO SILENCER (The Fix for "ID Not Found" logs)
      // ============================================================
      // If the incoming event is just a "Read Receipt", "Delivery Status",
      // or "Echo" (the bot's own reply), we skip it immediately.
      // This prevents the code from trying to find a User ID for a system event.
      if (entry.messaging) {
        const isSystemEvent = entry.messaging.every(
          (event: any) => event.read || event.delivery || (event.message && event.message.is_echo),
        )
        if (isSystemEvent) {
          console.log("[v0] 🔇 Skipped system event only")
          continue
        }
      }
      // ============================================================

      const webhookId = entry.id

      // 1. DUAL ID LOOKUP
      let { data: user } = await supabase
        .from("users")
        .select("*")
        .or(`business_account_id.eq.${webhookId},page_id.eq.${webhookId}`)
        .single()

      // ============================================================
      // 🔍 FALLBACK 1: Extract actual IG ID from payload
      // ============================================================
      if (!user) {
        console.log(`[v0] ⚠️ ID ${webhookId} not found in DB. Trying payload fallback...`)

        const candidateIds = new Set<string>()

        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
          }
        }
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
          }
        }

        for (const candidateId of candidateIds) {
          if (candidateId === webhookId) continue
          const { data: fallbackUser } = await supabase
            .from("users")
            .select("*")
            .or(`business_account_id.eq.${candidateId},page_id.eq.${candidateId}`)
            .single()

          if (fallbackUser) {
            console.log(`[v0] ✅ Payload fallback matched! ${candidateId} → ${fallbackUser.username}`)
            await supabase.from("users").update({ page_id: webhookId }).eq("id", fallbackUser.id)
            user = fallbackUser
            break
          }
        }
      }

      // ============================================================
      // 🔍 FALLBACK 2: Token verification (tests ALL users)
      // Only runs once per unknown ID, then saves the mapping forever
      // ============================================================
      if (!user) {
        console.log(`[v0] 🔎 Trying token verification for ${webhookId}...`)
        const { data: allUsers } = await supabase.from("users").select("*")

        if (allUsers) {
          for (const candidate of allUsers) {
            if (!candidate.access_token) continue
            try {
              const testRes = await fetch(
                `https://graph.instagram.com/v24.0/${webhookId}?fields=id&access_token=${candidate.access_token}`
              )
              if (testRes.ok) {
                console.log(`[v0] ✅ Token verified! ${webhookId} belongs to ${candidate.username}. Saving permanently.`)
                await supabase
                  .from("users")
                  .update({ page_id: webhookId })
                  .eq("id", candidate.id)
                user = candidate
                break
              }
            } catch (e) {
              // Network error, skip this user
            }
          }
        }
      }
      // ============================================================

      // ============================================================
      // 🔍 FALLBACK 3: Single-account self-host mapping
      // If this deployment has exactly one connected Instagram account,
      // treat unknown webhook IDs as that account and save the mapping.
      // This handles cases where Meta sends a different entry.id than /me returned.
      // ============================================================
      if (!user) {
        const { data: singleAccountUsers } = await supabase.from("users").select("*").limit(2)

        if (singleAccountUsers?.length === 1) {
          const [onlyUser] = singleAccountUsers
          console.log(`[v0] ✅ Single-user fallback mapped webhook ID ${webhookId} to ${onlyUser.username}`)
          await supabase.from("users").update({ page_id: webhookId }).eq("id", onlyUser.id)
          user = onlyUser
        }
      }
      // ============================================================

      if (!user) {
        console.log(`[v0] ❌ Could not resolve User for ID ${webhookId}`)
        continue
      }

      const { data: automations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)

      if (!automations?.length) continue
      console.log(`[v0] Loaded ${automations.length} active automation(s)`)

      // ============================================================
      //  PART A: COMMENTS
      // ============================================================
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "comments" && change.value?.text) {
            const commentId = change.value.id
            const commentText = change.value.text.toLowerCase().trim()
            const senderId = change.value.from?.id
            const mediaId = change.value.media?.id

            if (!commentId || !senderId || !mediaId) {
              console.log("[v0] ⚠️ Skipped comment event missing id/from/media", {
                hasCommentId: Boolean(commentId),
                hasSender: Boolean(senderId),
                hasMedia: Boolean(mediaId),
              })
              continue
            }

            // Safety check for self-reply
            if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

            // ============================================================
            // 🧠 SMART MATCHING LOGIC
            // ============================================================
            // Filter to comment-only automations first
            const commentAutomations = automations.filter((a: any) => a.trigger_source === 'comment')

            // Priority 1: Reply-All (Specific post, ALL comments)
            let match = commentAutomations.find(
              (a: any) => a.specific_media_id === mediaId && a.trigger_type === "reply_all",
            )

            // Priority 2: Specific Post + Keyword Match
            if (!match) {
              match = commentAutomations.find(
                (a) =>
                  a.specific_media_id === mediaId &&
                  a.trigger_type === "keyword" &&
                  a.trigger_value
                    .split(",")
                    .some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(commentText)),
              )
            }

            // Priority 3: Global Keyword Match (Only if no specific match found)
            if (!match) {
              match = commentAutomations.find(
                (a) =>
                  !a.specific_media_id && // Must be global
                  a.trigger_type === "keyword" &&
                  a.trigger_value
                    .split(",")
                    .some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(commentText)),
              )
            }

            if (match) {
              console.log(`[v0] ✅ Comment Match: "${match.name}" (ID: ${match.id})`)
              const content = match.response_content || {}
              const eventData = {
                comment_id: commentId,
                sender_id: senderId,
                media_id: mediaId,
                automation_id: match.id,
                automation_name: match.name,
              }

              if (await hasProcessedComment(supabase, user.id, commentId)) {
                console.log(`[v0] 🛡️ Skipped duplicate comment automation for ${commentId}`)
                continue
              }

              const safetyBlock = await getAutomationSafetyBlock(supabase, user.id, senderId, mediaId)
              if (safetyBlock) {
                console.log(`[v0] 🛡️ Skipped comment automation: ${safetyBlock}`)
                await logAutomationEvent(supabase, "comment_automation_blocked", user.id, {
                  ...eventData,
                  reason: safetyBlock,
                })
                continue
              }

              await logAutomationEvent(supabase, "comment_automation_processing", user.id, eventData)

              const fallbackReplies = ["Check your DMs!", "Sent!", "Check your messages!"]
              const configuredReplies = Array.isArray(content.public_replies)
                ? content.public_replies.filter((reply: unknown) => typeof reply === "string" && reply.trim())
                : []
              const publicReplies = configuredReplies.length > 0 ? configuredReplies : fallbackReplies
              const publicReply = publicReplies[Math.floor(Math.random() * publicReplies.length)]
              let publicReplySent = false
              let dmSent = false

              // Public Reply
              if (content.public_reply_enabled !== false) {
                try {
                  const pubRes = await fetch(
                    `https://graph.instagram.com/v24.0/${commentId}/replies?access_token=${encodeURIComponent(user.access_token)}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ message: publicReply }),
                    },
                  )
                  const pubJson = await pubRes.json()
                  if (pubJson.error) {
                    console.error("[v0] 🔴 Public Reply Failed:", JSON.stringify(pubJson.error))
                    await logAutomationEvent(supabase, "comment_automation_error", user.id, {
                      ...eventData,
                      step: "public_reply",
                      error_code: getInstagramErrorCode(pubJson.error),
                      error: pubJson.error,
                    })
                    if (isInstagramThrottleError(pubJson.error)) {
                      await logAutomationEvent(supabase, "comment_automation_rate_limited", user.id, {
                        ...eventData,
                        step: "public_reply",
                        error: pubJson.error,
                      })
                      continue
                    }
                  } else {
                    publicReplySent = true
                    console.log("[v0] 🟢 Public Reply Sent!", pubJson)
                  }
                } catch (e) {
                  console.error("[v0] 🔴 Public Reply Network Error:", e)
                  await logAutomationEvent(supabase, "comment_automation_error", user.id, {
                    ...eventData,
                    step: "public_reply",
                    error: e instanceof Error ? e.message : String(e),
                  })
                }
              }

              // Private Reply (DM)
              const apiBody: any = { recipient: { comment_id: commentId } }

              if (content.message) {
                // Plain Text
                apiBody.message = { text: content.message }
              } else if (content.card) {
                // Rich Card / Generic Template
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              if (!apiBody.message) {
                console.log("[v0] 🛡️ Skipped comment automation: missing DM response payload")
                await logAutomationEvent(supabase, "comment_automation_blocked", user.id, {
                  ...eventData,
                  reason: "missing_dm_payload",
                })
                continue
              }

              console.log("[v0] 📤 DM Body:", JSON.stringify(apiBody))
              try {
                const dmRes = await fetch(
                  `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
                )
                const dmJson = await dmRes.json()
                if (dmJson.error) {
                  console.error("[v0] 🔴 Private DM Failed:", JSON.stringify(dmJson.error))
                  await logAutomationEvent(supabase, "comment_automation_error", user.id, {
                    ...eventData,
                    step: "private_dm",
                    error_code: getInstagramErrorCode(dmJson.error),
                    error: dmJson.error,
                  })
                  if (isInstagramThrottleError(dmJson.error)) {
                    await logAutomationEvent(supabase, "comment_automation_rate_limited", user.id, {
                      ...eventData,
                      step: "private_dm",
                      error: dmJson.error,
                    })
                  }
                } else {
                  dmSent = true
                  console.log("[v0] 🟢 Private DM Sent!", dmJson)
                }
              } catch (e) {
                console.error("[v0] 🔴 Private DM Network Error:", e)
                await logAutomationEvent(supabase, "comment_automation_error", user.id, {
                  ...eventData,
                  step: "private_dm",
                  error: e instanceof Error ? e.message : String(e),
                })
              }

              if (publicReplySent || dmSent) {
                await logAutomationEvent(supabase, "comment_automation_sent", user.id, {
                  ...eventData,
                  public_reply_sent: publicReplySent,
                  dm_sent: dmSent,
                })
              }
            }
          }
        }
      }

      // ============================================================
      //  PART A.5: STORY AUTOMATION HANDLING
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id
          const recipientId = event.recipient?.id

          if (!senderId || !recipientId) {
            console.log("[v0] ⚠️ Skipped story event missing sender/recipient")
            continue
          }

          // Skip system events
          if (event.read || event.delivery || event.message?.is_echo || senderId === recipientId) continue

          // Filter story automations only
          const storyAutomations = automations.filter((a: any) => a.trigger_source === 'story')
          if (storyAutomations.length === 0) continue

          let match = null
          let storyMediaId: string | null = null

          // 1️⃣ Story Mention Handler
          if (event.message?.attachments?.[0]?.type === 'story_mention') {
            const attachment = event.message.attachments[0]
            storyMediaId = attachment.payload?.url || null

            match = storyAutomations.find((a: any) =>
              a.trigger_type === 'mention' &&
              (!a.specific_media_id || a.specific_media_id === storyMediaId)
            )
          }

          // 2️⃣ Story Reaction Handler  
          else if (event.reaction) {
            const reactionEmoji = event.reaction.emoji
            storyMediaId = event.reaction.mid || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reaction') return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== 'ALL' && triggers[0] !== '') {
                return triggers.includes(reactionEmoji)
              }
              return true
            })
          }

          // 3️⃣ Story Reply Handler
          else if (event.message?.reply_to?.story) {
            const messageText = event.message.text || ''
            storyMediaId = event.message.reply_to.story.id || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reply') return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== 'ALL' && triggers[0] !== 'ALL_MENTIONS' && triggers[0] !== '') {
                return triggers.some((keyword: string) =>
                  new RegExp(`\\b${keyword}\\b`, 'i').test(messageText)
                )
              }
              return true
            })
          }

          // Send response if match found
          if (match) {
            console.log(`✨ Story automation matched: ${match.name}`)

            try {
              const content =
                typeof match.response_content === "string"
                  ? JSON.parse(match.response_content)
                  : match.response_content
              const apiBody: any = { recipient: { id: senderId } }

              if (content.message) {
                apiBody.message = { text: content.message }
              } else if (content.card) {
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              await fetch(
                `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
              )

              console.log(`✅ Story automation sent: ${match.name}`)
            } catch (err) {
              console.error('❌ Story automation error:', err)
            }
          }
        }
      }

      // ============================================================
      //  PART B: MESSAGES (DMs)
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.read || event.delivery || event.reaction || event.message?.is_echo) continue

          const senderId = event.sender?.id
          if (!senderId) {
            console.log("[v0] ⚠️ Skipped DM event missing sender", {
              keys: Object.keys(event || {}),
              hasMessage: Boolean(event.message),
              hasPostback: Boolean(event.postback),
              hasReaction: Boolean(event.reaction),
              hasRead: Boolean(event.read),
              hasDelivery: Boolean(event.delivery),
            })
            continue
          }

          if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

          let triggerType = "",
            triggerValue = ""

          if (event.message?.text) {
            triggerType = "keyword"
            triggerValue = event.message.text.toLowerCase().trim()
          } else if (event.postback?.payload) {
            triggerType = "postback"
            triggerValue = event.postback.payload
          } else {
            continue
          }

          console.log(`[v0] 📩 DM from ${senderId}: "${triggerValue}"`)

          let match = null
          const dmAutomations = automations.filter((a: any) => a.trigger_source === "dm")
          if (triggerType === "postback") {
            if (triggerValue.startsWith("UNLOCK_CONTENT_")) {
              const ruleId = triggerValue.replace("UNLOCK_CONTENT_", "")
              match = automations.find((a) => a.id === ruleId)
            } else if (triggerValue.startsWith("ICE_BREAKER_")) {
              // Handle Ice Breaker
              const iceBreakerId = triggerValue.replace("ICE_BREAKER_", "")
              const { data: ibMatches } = await supabase
                .from("ice_breakers")
                .select("*")
                .eq("id", iceBreakerId)
                .eq("user_id", user.id)
                .single()

              if (ibMatches) {
                // Construct a temporary match object to reuse the sending logic
                match = {
                  name: "Ice Breaker: " + ibMatches.question,
                  response_content: { message: ibMatches.response },
                }
              }
            } else {
              match = dmAutomations.find((a) => a.trigger_type === "postback" && a.trigger_value === triggerValue)
            }
          } else {
            match = dmAutomations.find(
              (a) =>
                a.trigger_type === "keyword" &&
                a.trigger_value.split(",").some((k: string) => new RegExp(`\\b${k.trim()}\\b`, "i").test(triggerValue)),
            )
          }

          if (!match) {
            console.log(`[v0] ❌ No match.`)
            continue
          }

          console.log(`[v0] ✅ Match: "${match.name}"`)
          const content = match.response_content
          const apiBody: any = { recipient: { id: senderId } }

          let replyTextLog = ""

          if (content.message) {
            apiBody.message = { text: content.message }
            replyTextLog = content.message
          } else if (content.card) {
            const card = content.card
            replyTextLog = `[Card] ${card.title}`
            const apiButtons = card.buttons.map((b: any) => ({
              type: b.type,
              title: b.title,
              url: b.url || undefined,
              payload: b.payload || undefined,
            }))
            const element: any = { title: card.title, buttons: apiButtons }
            if (card.subtitle) element.subtitle = card.subtitle
            if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url
            apiBody.message = {
              attachment: { type: "template", payload: { template_type: "generic", elements: [element] } },
            }
          }

          // Follow Gate Logic
          const isUnlockEvent = triggerType === "postback" && triggerValue.startsWith("UNLOCK_CONTENT_")
          if (content.check_follow === true && !isUnlockEvent) {
            replyTextLog = "[Locked Content Gate]"
            apiBody.message = {
              attachment: {
                type: "template",
                payload: {
                  template_type: "generic",
                  elements: [
                    {
                      title: "🔒 Content Locked",
                      subtitle: `Please follow @${user.username} to see this!`,
                      buttons: [
                        { type: "web_url", url: `https://instagram.com/${user.username}`, title: "Follow Us" },
                        { type: "postback", title: "I Followed! ✅", payload: `UNLOCK_CONTENT_${match.id}` },
                      ],
                    },
                  ],
                },
              },
            }
          }

          // SEND REPLY
          try {
            const res = await fetch(
              `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
            )
            const json = await res.json()
            if (json.error) console.error("[v0] 🔴 Reply Failed:", json.error)
            else {
              console.log("[v0] 🟢 Reply Sent!")
              await logAutomationEvent(supabase, "dm_automation_sent", user.id, {
                sender_id: senderId,
                automation_id: match.id || null,
                automation_name: match.name,
                trigger_type: triggerType,
                reply_preview: replyTextLog,
              })
            }
          } catch (e) {
            console.error("[v0] Network Error:", e)
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Webhook Error", error)
    return NextResponse.json({ ok: true })
  }
}
