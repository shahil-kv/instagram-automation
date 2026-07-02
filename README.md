# Instagram Automation

Self-hosted Instagram automation for creators, agencies, and builders who want comment-to-DM funnels, public comment replies, DM keyword replies, story automations, and Reels publishing without a closed SaaS dependency.

## Features

- Comment keyword triggers
- Public reply to comments before sending the private DM
- Comment-to-DM flows for links, offers, lead magnets, courses, coupons, and downloads
- Specific-post and global comment automations
- DM keyword automations
- Story mention, reaction, and reply automations
- Ice Breakers
- Reels content pool and scheduler
- Safety controls for comment automations:
  - exact comment dedupe
  - per-user per-reel cooldown
  - hourly and daily automation caps
  - rate-limit/error logging

## Comment-To-DM Flow

The core flow is:

1. A user comments a matching keyword on a Reel or post.
2. The app replies publicly to that comment, for example: `Check your DMs`.
3. The app sends the configured private DM using Instagram's official API.
4. The event is logged in `webhook_events` for dedupe, safety limits, and dashboard activity.

This mirrors the common ManyChat-style comment automation pattern while keeping the app self-hosted and customizable.

## Tech Stack

- Next.js
- React
- Supabase
- Instagram Graph API
- Vercel
- Tailwind CSS

## Project Structure

```text
app/api/instagram/callback       OAuth login + token exchange
app/api/instagram/webhook        DM/comment/story webhook automation engine
app/api/automations              Automation CRUD
app/api/scheduler                Reels scheduler
components/dashboard             Dashboard, automations, content pool
lib/instagram-publishing.ts      Reels container/publish helpers
schema.sql                       Supabase schema
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_INSTAGRAM_APP_ID=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/instagram/callback
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=

INSTAGRAM_COMMENT_COOLDOWN_MINUTES=10
INSTAGRAM_COMMENT_AUTOMATION_HOURLY_LIMIT=120
INSTAGRAM_COMMENT_AUTOMATION_DAILY_LIMIT=800

GATEWAY_SECRET=
API_SECRET_KEY=
```

3. Run the Supabase SQL from:

```text
schema.sql
```

or:

```text
scripts/setup-supabase.sql
```

4. Start development:

```bash
npm run dev
```

5. Configure Meta/Instagram:

- OAuth redirect URI:

```text
https://your-domain.com/api/instagram/callback
```

- Webhook callback URL:

```text
https://your-domain.com/api/instagram/webhook
```

Required permissions depend on your enabled features, but usually include:

```text
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

## Notes

- This project uses official Instagram/Meta APIs, not browser automation.
- Automation safety limits are configurable through environment variables.
- The MIT license notice must remain included with redistributed copies.

## License

MIT. See [LICENSE](./LICENSE).
