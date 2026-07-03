THIS REPO IS A FORKED VRSN OF https://github.com/ayuuxh2/insta-p8
<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Supabase-Postgres-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/Instagram-Automation-E4405F?style=for-the-badge&logo=instagram" alt="Instagram automation" />
  <img src="https://img.shields.io/badge/Vercel-Deployable-000000?style=for-the-badge&logo=vercel" alt="Vercel deployable" />
</p>

<h1 align="center">Instagram Automation</h1>

<p align="center">
  <strong>Self-hosted Instagram automation for comments, DMs, stories, public replies, and Reels workflows.</strong>
</p>

<p align="center">
  Build ManyChat-style comment-to-DM funnels without giving up your database, webhook logic, or deployment.
  <br />
  No closed SaaS dependency. Your automations, tokens, logs, and content live in your own Supabase project.
</p>

<p align="center">
  <a href="#quick-start-self-host"><strong>Self Host</strong></a> .
  <a href="#features"><strong>Features</strong></a> .
  <a href="#comment-to-reply-then-dm"><strong>Comment to DM</strong></a> .
  <a href="#environment-variables"><strong>Env Setup</strong></a> .
  <a href="#deploy-to-vercel"><strong>Deploy</strong></a> .
  <a href="#roadmap"><strong>Roadmap</strong></a>
</p>

---

## What is Instagram Automation?

**Instagram Automation** is an open-source Instagram automation platform for creators, agencies, brands, indie hackers, and developers who want to automate Instagram engagement from their own stack.

Use it to build:

- Instagram comment-to-DM funnels
- Public comment replies before sending a private DM
- Instagram DM keyword automations
- Instagram story mention, reaction, and reply automations
- Reels-specific comment automations
- Reply-all automations for selected posts or Reels
- Instagram Ice Breakers
- Reels content pool and scheduler
- Self-hosted creator automation workflows
- Developer-owned Instagram webhook automation

If you are searching for a **self-hosted ManyChat alternative**, **open-source Instagram DM automation**, **Instagram comment-to-DM automation**, **Instagram Reels comment automation**, or an **Instagram automation starter built on Supabase**, this project is built for that use case.

---

## Why Self-Host?

Paid Instagram automation tools are useful, but they are usually closed-source and subscription-based. This project is for people who want ownership and flexibility.

| Feature | Closed SaaS tools | Instagram Automation |
|---|---:|---:|
| Open source | No | Yes |
| Self-hosted | No | Yes |
| Own your database | No | Yes |
| Custom webhook logic | Limited | Yes |
| Comment-to-DM workflows | Yes | Yes |
| Public comment reply before DM | Yes | Yes |
| Reels publishing workflows | Depends | Yes |
| Supabase/Postgres backend | No | Yes |
| Vercel deployable | Depends | Yes |
| Full source code access | No | Yes |

This is not a drop-in clone of any paid tool. It is a customizable automation base for builders who want to control the whole Instagram workflow.

---

## Features

### Instagram Comment Automation

- Keyword-based comment triggers
- Reels-specific and post-specific automations
- Global comment automations across posts
- Reply-all mode for selected posts or Reels
- Public comment reply before the private DM is sent
- Randomized public replies such as `Check your DMs`
- Private reply / DM sent from the matched comment
- Comment-to-DM funnels for links, offers, lead magnets, coupons, downloads, products, and courses
- Exact comment dedupe to avoid repeated sends
- Per-user per-Reel cooldown
- Hourly and daily safety caps
- Rate-limit and error event logging

### Comment to Reply, Then DM

The main Reels/comment workflow is:

1. Someone comments on a selected Reel or post.
2. The webhook matches the comment against your automation.
3. The app replies publicly to the comment.
4. The app sends the configured private DM using Instagram's official API.
5. The event is logged for dedupe, safety checks, dashboard stats, and debugging.

This supports the common flow: **comment on Reel -> public reply -> DM with link/message/card**.

### Instagram DM Automation

- Keyword-based DM auto-replies
- Multi-keyword matching
- Postback/button payload handling
- Text replies
- Rich card replies with buttons
- Follow-gated locked content flows
- Incoming event logging
- Outgoing automation event logging

### Instagram Story Automation

- Story mention automation
- Story reply automation
- Story reaction automation
- Optional emoji reaction filters
- Specific story matching support
- Automatic DM responses for story engagement

### Instagram Ice Breakers

- Add Instagram Ice Breaker questions
- Save question and auto-response pairs
- Sync Ice Breakers to the Instagram Messenger profile
- Handle Ice Breaker postback responses in the webhook

### Reels Publishing and Scheduling

- Content pool for Reels
- Supabase Storage-backed media uploads
- Import Instagram media into the pool
- Scheduler configuration API
- Create Instagram Reels containers
- Poll publishing status
- Publish ready containers
- Track published Reel history
- Direct publish hook protected by an API secret

### Dashboard

- Automation management
- Comment, DM, and story automation tabs
- Reels/post picker for targeted automations
- Public reply controls for comment automations
- Content pool management
- Scheduler settings
- Dashboard stats from webhook events

---

## Tech Stack

- **Framework:** Next.js 16 App Router
- **Frontend:** React 19, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui-style components
- **Icons:** Lucide React
- **Database:** Supabase Postgres
- **Storage:** Supabase Storage
- **Deployment:** Vercel
- **Analytics:** Vercel Analytics
- **Instagram API:** Instagram Login and Graph API v24.0

---

## Architecture

```txt
Instagram User
     ↓
Instagram Webhook
     ↓
Next.js API Routes
     ↓
Automation Matcher
     ↓
Supabase Database
     ↓
Instagram Graph API Reply / Publish
```

Important modules:

```txt
app/api/instagram/callback       OAuth login + token exchange
app/api/instagram/webhook        DM/comment/story webhook automation engine
app/api/instagram/media          Instagram media cache/import support
app/api/automations              Automation CRUD
app/api/ice-breakers             Ice Breaker management + sync
app/api/dashboard/stats          Dashboard metrics from webhook events
app/api/hooks                    Reels publishing/upload hooks
app/api/scheduler                Reels/content scheduling APIs
components/dashboard             Dashboard, automations, content pool, scheduler
lib/supabase-server.ts           Supabase server client
lib/instagram-publishing.ts      Reels container/publish helpers
scripts/setup-supabase.sql       One-pass Supabase schema setup
```

---

## Quick Start: Self Host

### 1. Clone the repo

```bash
git clone <your-fork-url>
cd instagram-automation
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Supabase project

- Create a new Supabase project.
- Copy your project URL.
- Copy the anon key.
- Copy the service role key.
- Run the SQL setup script from `scripts/setup-supabase.sql` in the Supabase SQL Editor.

### 4. Create a Meta / Instagram app

You need an Instagram Business or Creator account and a Meta Developer app configured for Instagram Login and webhooks.

Common permissions for this app:

```txt
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

### 5. Configure environment variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

NEXT_PUBLIC_INSTAGRAM_APP_ID=your_instagram_app_id
INSTAGRAM_APP_ID=your_instagram_app_id
INSTAGRAM_APP_SECRET=your_instagram_app_secret
NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/instagram/callback
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=choose_a_strong_verify_token

INSTAGRAM_COMMENT_COOLDOWN_MINUTES=10
INSTAGRAM_COMMENT_AUTOMATION_HOURLY_LIMIT=120
INSTAGRAM_COMMENT_AUTOMATION_DAILY_LIMIT=800
INSTAGRAM_WEBHOOK_DEBUG=false

GATEWAY_SECRET=optional_ai_gateway_secret
API_SECRET_KEY=your_internal_hook_secret
```

### 6. Run locally

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Description |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key for API routes |
| `NEXT_PUBLIC_INSTAGRAM_APP_ID` | Yes | Public Instagram app/client ID |
| `INSTAGRAM_APP_ID` | Yes | Server-side Instagram app ID |
| `INSTAGRAM_APP_SECRET` | Yes | Instagram app secret for token exchange |
| `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` | Yes | OAuth callback URL |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Yes | Webhook verification token |
| `INSTAGRAM_COMMENT_COOLDOWN_MINUTES` | Optional | Per-user comment automation cooldown |
| `INSTAGRAM_COMMENT_AUTOMATION_HOURLY_LIMIT` | Optional | Hourly safety cap for comment automations |
| `INSTAGRAM_COMMENT_AUTOMATION_DAILY_LIMIT` | Optional | Daily safety cap for comment automations |
| `INSTAGRAM_WEBHOOK_DEBUG` | Optional | Enables raw webhook logging when set to `true` |
| `GATEWAY_SECRET` | Optional | Reserved for AI/proxy integrations |
| `API_SECRET_KEY` | Optional | Secret for internal Reels publishing/upload hooks |

**Security note:** never expose `SUPABASE_SERVICE_ROLE_KEY`, `INSTAGRAM_APP_SECRET`, access tokens, or `API_SECRET_KEY` in client-side code.

---

## Deploy to Vercel

1. Fork this repository.
2. Import it into Vercel.
3. Add all required environment variables.
4. Set the production redirect URI in Meta Developer Console:

```txt
https://your-domain.com/api/instagram/callback
```

5. Set your Instagram webhook callback URL:

```txt
https://your-domain.com/api/instagram/webhook
```

6. Deploy.
7. Connect your Instagram Business or Creator account.
8. Create your first comment-to-DM, DM, or story automation.

---

## Testing Checklist

Before going live, test these flows:

- Login with an Instagram Business or Creator account
- Create a DM keyword automation
- Send a test DM from another Instagram account
- Create a comment keyword automation
- Comment on a selected Reel or post
- Confirm the public comment reply is posted
- Confirm the private DM is sent after the comment reply
- Create a reply-all automation for one selected Reel
- Add Ice Breakers and verify they sync
- Create a story mention, reply, or reaction automation
- Upload a Reel to the content pool
- Test a Reels publishing hook if using the publisher
- Check dashboard stats and webhook event logs

---

## Use Cases

Instagram Automation can be used as:

- Self-hosted ManyChat alternative
- Instagram comment-to-DM automation tool
- Instagram Reels comment automation tool
- Instagram DM keyword bot
- Instagram story automation tool
- Instagram lead generation workflow
- Creator link delivery automation
- Coupon or download delivery bot
- Agency-owned Instagram automation stack
- Supabase Instagram API starter
- Vercel-deployable Instagram webhook app
- Reels scheduling and publishing workflow

---

## Important Notes

- This project uses official Instagram/Meta APIs, not browser automation.
- Instagram APIs require the correct Meta app permissions and review for production use.
- Some features require an Instagram Business or Creator account.
- Webhooks must be reachable from the public internet.
- Automation safety limits are configurable through environment variables.
- Respect Instagram Platform Terms and anti-spam policies.
- Do not use automation to spam, deceive, scrape, or abuse users.

---

## Roadmap

- [ ] Add official community links when available
- [ ] Add verified community and product links when ready
- [ ] One-click Vercel deploy button
- [ ] Docker setup
- [ ] Better onboarding wizard
- [ ] More automation templates
- [ ] Inbox/manual reply dashboard
- [ ] AI auto-reply API routes and model configuration
- [ ] Better analytics charts
- [ ] Webhook event debugger UI
- [ ] Export/import automations
- [ ] Public demo video

---

## Contributing

Contributions are welcome.

Good first issues:

- Improve setup docs
- Add Docker support
- Add more automation templates
- Improve dashboard analytics
- Add tests for API routes
- Improve webhook logging
- Add provider-agnostic AI configuration
- Improve Reels scheduler reliability

---

## Support

If this project helps you avoid recurring Instagram automation SaaS fees, please star the repository when the public repo is ready.

Stars help more developers discover open-source Instagram automation, self-hosted creator tools, and Instagram comment-to-DM workflows.

---

## License

MIT License. See [LICENSE](./LICENSE).
