# RelationCity — Future Design Document
## Multi-User SaaS Product Vision

**Date:** 2026-03-20
**Status:** Design — not yet spec'd for implementation

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [User Journey](#2-user-journey)
3. [New Screens & Pages](#3-new-screens--pages)
4. [Updated App Architecture](#4-updated-app-architecture)
5. [Notion OAuth Connection Flow](#5-notion-oauth-connection-flow)
6. [Free Tier Enforcement](#6-free-tier-enforcement)
7. [Account & Billing Management](#7-account--billing-management)
8. [App Enhancements for Multi-User](#8-app-enhancements-for-multi-user)
9. [Open Design Questions](#9-open-design-questions)

---

## 1. Product Vision

RelationCity goes from a local single-user visualization tool to a hosted, multi-user SaaS product. The core value proposition doesn't change: visualize your Notion data in rich 3D spatial views. The product upgrade is accessibility — anyone can sign up, connect their Notion workspace, and immediately explore their data without running any code locally.

**Target user:** Notion power users who manage complex interconnected databases and want a spatial, visual way to explore relationships and timelines.

**What stays the same:**
- All 5 visualization modes (Graph, City, Mountain, Timeline, User)
- The look, feel, and interactions of the canvases
- Notion as the sole data source

**What changes:**
- App is hosted and publicly accessible
- Users create accounts and log in
- Each user connects their own Notion workspace via OAuth
- Sync is triggered per-user from the UI (not a local CLI)
- Free tier limits to 2 Notion databases; paid unlocks everything

---

## 2. User Journey

### New User (Free)

```
Landing Page
    ↓
Sign Up (Google / Apple / Email)
    ↓
Onboarding: "Connect your Notion workspace"
    ↓
Notion OAuth → User picks pages/databases to share
    ↓
First Sync (background, ~10-30 seconds)
    ↓
Dashboard — pick a visualization mode
    ↓
[Uses the app, hits 2-database limit]
    ↓
Upgrade prompt → Pricing page → Stripe Checkout
    ↓
Paid account activated
```

### Returning User

```
Landing Page / Direct URL
    ↓
Sign In (existing session → auto redirect)
    ↓
Dashboard
    ↓
Visualization mode of choice
```

### Upgrade Flow

```
[In app — sees "Upgrade to unlock X databases"]
    ↓
Pricing page
    ↓
Stripe Checkout (hosted)
    ↓
Payment confirmed → webhook → plan upgraded in DB
    ↓
Redirect back to app, now unlocked
```

---

## 3. New Screens & Pages

### 3.1 Landing Page (`/`)

**Purpose:** Convert visitors to sign-ups.

**Sections:**
- Hero: animated or screenshot of a visualization (Graph or City mode)
- Value prop: "Your Notion data, visualized in 3D"
- Feature highlights: the 5 visualization modes with short descriptions + screenshots
- Pricing section (abbreviated — full detail on `/pricing`)
- CTA: "Get started free — no credit card required"
- Footer: About, Pricing, Privacy, Terms, Contact

**Design notes:**
- The hero visualization should be a live embed or a high-quality video loop if a live embed is too heavy for the landing page
- Use the existing CSS custom property theme system

### 3.2 Auth Pages

**`/auth/sign-up`** — Sign up form
- Google OAuth button (primary)
- Apple Sign-In button
- Divider: "or"
- Email + password fields
- Link: "Already have an account? Sign in"

**`/auth/sign-in`** — Sign in form
- Same providers as sign-up
- Link: "Don't have an account? Get started free"
- Forgot password link (if email/password auth)

**`/auth/callback`** — OAuth callback handler (invisible redirect page)

**Design:** Simple, centered card layout. Use the existing font stack (Geist body, Lora headings).

### 3.3 Onboarding Flow (`/onboarding`)

Shown once, right after first sign-up.

**Step 1: Welcome**
- "Welcome to RelationCity"
- Brief 1-sentence description of what the app does
- CTA: "Connect your Notion workspace"

**Step 2: Notion OAuth**
- Explanation of what permissions are requested
- "We only read your Notion data — we never write or modify anything"
- Large CTA: "Connect Notion"
- → triggers OAuth redirect

**Step 3: Select databases (Free tier)**
- After OAuth, show discovered databases
- Free tier: "Select up to 2 databases to visualize"
- Paid tier: all selected by default
- Note: user can change this later in Settings

**Step 4: First sync**
- Progress indicator: "Syncing your Notion data…"
- Show node count as it builds
- On completion: "Ready! Choose a visualization to explore your data"

### 3.4 Dashboard (`/dashboard`)

The app's home screen after sign-in.

**Layout:**
- Header: logo, nav links, user avatar/menu
- Main area: 6 cards — one per visualization mode + a "Sync" status card
  - Each card shows: mode name, icon/preview, last visited timestamp
  - "Sync" card shows: last sync time, node count, database count, "Sync Now" button
- Sidebar or top bar: current workspace name, plan badge (Free / Pro)

**Quick actions:**
- "Sync Now" — triggers a fresh pull from Notion
- "Manage Databases" — goes to settings
- "Upgrade" — visible only on Free tier

### 3.5 Pricing Page (`/pricing`)

**Layout:** Two-column comparison card (Free | Pro)

| Feature | Free | Pro |
|---|---|---|
| Notion databases | 2 | Unlimited |
| Visualization modes | All 5 | All 5 |
| Manual sync | Yes | Yes |
| Scheduled auto-sync | — | Hourly (or configurable) |
| Attribution watermark | Yes | No |
| Priority support | — | Yes |
| Price | $0 | $4.99/mo or $39.99/year |

**CTA:**
- Free: "Get started free"
- Pro: "Start Pro" → Stripe Checkout

**FAQ section** (below the cards):
- What counts as a "database"?
- Can I switch which 2 databases I use on the free tier?
- What happens to my data if I cancel?
- Is there a trial period?
- Do you store my Notion content?

### 3.6 Settings (`/settings`)

Tabbed interface:

**Tab: Account**
- Display name, email
- Change password (email auth only)
- Delete account (with confirmation)

**Tab: Notion**
- Connected workspace name + icon
- List of connected databases (showing which are active)
- Free tier: shows 2/2 with "Upgrade to unlock more"
- "Reconnect Notion" — re-runs OAuth if token expires
- "Disconnect Notion" — removes OAuth token

**Tab: Billing**
- Current plan: Free or Pro
- If Pro: next renewal date, payment method last 4 digits
- "Manage Billing" → Stripe Customer Portal
- If Free: "Upgrade to Pro" CTA

**Tab: Preferences**
- Default visualization mode on load
- Theme (light/dark)
- (Future) notification preferences

### 3.7 Stripe Customer Portal

Not a custom page — Stripe provides a hosted portal at a unique URL. Users click "Manage Billing" and are redirected to Stripe's portal where they can:
- Update payment method
- Download invoices
- Cancel subscription

### 3.8 In-App Upgrade Prompts

When a free-tier user hits the 2-database limit, they should see an inline prompt (not a disruptive modal) in the relevant screens:

- In Settings > Notion: "You've reached your 2-database limit. Upgrade to Pro to connect unlimited databases."
- In Dashboard: small banner or badge: "Free plan — 2 of 2 databases used. Upgrade →"
- In any visualization where they'd see a "missing" database: context-aware prompt

---

## 4. Updated App Architecture

### Route Structure

```
/                          → Landing page (public)
/auth/sign-up              → Sign up
/auth/sign-in              → Sign in
/auth/callback             → OAuth callback (Notion + social providers)
/onboarding                → Post-signup onboarding flow
/dashboard                 → User dashboard (protected)
/pricing                   → Pricing page (public)
/settings                  → User settings (protected)
/graph                     → Graph visualization (protected, existing)
/project-city              → City visualization (protected, existing)
/project-mountain          → Mountain visualization (protected, existing)
/project-timeline          → Timeline visualization (protected, existing)
/project-user              → User visualization (protected, existing)
/api/auth/[...provider]    → Auth handlers
/api/notion/oauth          → Notion OAuth initiation
/api/notion/callback       → Notion OAuth token exchange
/api/sync                  → Trigger sync (protected, plan-gated)
/api/user                  → User profile CRUD
/api/billing/checkout      → Create Stripe checkout session
/api/billing/webhook       → Stripe webhook handler
/api/billing/portal        → Create Stripe customer portal session
```

### Data Ownership Model

All existing data (graph, nodes, schemas, config) is currently global/single-user. In the SaaS model, every piece of data is scoped to a `user_id`.

**Database schema (Postgres):**

```sql
users
  id              UUID PK
  email           TEXT UNIQUE
  display_name    TEXT
  created_at      TIMESTAMP
  plan            ENUM('free', 'pro')
  stripe_customer_id TEXT

notion_workspaces
  id              UUID PK
  user_id         UUID FK → users
  workspace_id    TEXT
  workspace_name  TEXT
  bot_id          TEXT
  access_token    TEXT (encrypted)
  connected_at    TIMESTAMP

notion_databases
  id              UUID PK
  workspace_id    UUID FK → notion_workspaces
  database_id     TEXT (Notion's UUID)
  database_name   TEXT
  is_active       BOOLEAN
  created_at      TIMESTAMP

sync_jobs
  id              UUID PK
  user_id         UUID FK → users
  workspace_id    UUID FK → notion_workspaces
  started_at      TIMESTAMP
  completed_at    TIMESTAMP
  status          ENUM('pending', 'running', 'complete', 'error')
  node_count      INTEGER
  error_message   TEXT

subscriptions
  id              UUID PK
  user_id         UUID FK → users
  stripe_subscription_id TEXT
  stripe_price_id TEXT
  status          TEXT (active, canceled, past_due)
  current_period_end TIMESTAMP
```

**Object storage (Supabase Storage buckets):**
```
user-graphs/
  {user_id}/
    graph.json
    config.json
    nodes/
      {node_id}.json
    schemas/
      {database_id}.json
```

### Auth Middleware

All `/dashboard`, `/settings`, `/graph`, `/project-*`, and `/api/*` (except `/api/billing/webhook`) routes require authentication. Implement Next.js middleware (`middleware.ts`) to:
1. Check session token
2. Redirect unauthenticated requests to `/auth/sign-in`
3. Redirect post-login to the originally requested URL

---

## 5. Notion OAuth Connection Flow

### Setup (one-time)

1. Create a Public Notion integration at [notion.so/my-integrations](https://notion.so/my-integrations)
2. Set redirect URI to `https://yourdomain.com/api/notion/callback`
3. Store `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` in env vars
4. Submit for Notion review (allow 1–2 weeks)

### Runtime Flow

```
User clicks "Connect Notion"
    ↓
GET /api/notion/oauth
    → Redirect to https://api.notion.com/v1/oauth/authorize
      ?client_id={NOTION_CLIENT_ID}
      &redirect_uri={CALLBACK_URL}
      &response_type=code
      &owner=user
    ↓
User authorizes in Notion (selects pages/databases to share)
    ↓
Notion redirects to /api/notion/callback?code=...
    ↓
POST https://api.notion.com/v1/oauth/token
    → Exchange code for { access_token, workspace_id, workspace_name, bot_id }
    ↓
Store in notion_workspaces table (access_token encrypted)
    ↓
Trigger first sync
    ↓
Redirect to /onboarding/step-3 (database selection)
```

### Token refresh

Notion OAuth tokens do not expire (they are permanent until revoked by the user). No refresh token mechanism needed. However, tokens can be revoked if the user removes your integration from their Notion settings. Handle 401 responses from the Notion API gracefully and prompt re-connection.

---

## 6. Free Tier Enforcement

### How limiting to 2 databases works

After OAuth, when you sync a user's workspace, you discover all databases. The enforcement logic:

```
1. Query notion_databases for this workspace
2. Count databases where is_active = true
3. If user.plan = 'free' AND active_count >= 2:
   - Skip all additional databases during sync
   - Return a warning in the sync response
4. If user.plan = 'pro':
   - Sync all databases
```

### UI enforcement

- Settings > Notion: show all discovered databases with toggles
- Free tier: first 2 toggles are on, rest are disabled with "Upgrade to Pro" tooltip
- After upgrade: all toggles become enabled

### Edge case: User connects 2 databases, then downgrades

If a Pro user who had 10 databases downgrades to Free:
- Keep the 2 most recently synced databases active
- Archive the rest (mark `is_active = false`, retain data for 30 days)
- Show a notification: "Your plan was downgraded. 8 databases have been paused. Upgrade to reactivate."

---

## 7. Account & Billing Management

### Stripe Integration

**Checkout flow:**
1. User clicks "Upgrade" in app
2. `POST /api/billing/checkout` creates a Stripe Checkout Session
3. User is redirected to Stripe's hosted checkout page
4. User enters card details on Stripe's page (you never see card data)
5. On success: Stripe sends `checkout.session.completed` webhook
6. Webhook handler updates `users.plan = 'pro'` and creates subscription record
7. User is redirected back to `/settings/billing` with confirmation

**Webhook events to handle:**
- `checkout.session.completed` → upgrade plan
- `invoice.payment_succeeded` → renew plan, extend period
- `invoice.payment_failed` → notify user, set plan to at-risk
- `customer.subscription.deleted` → downgrade to free
- `customer.subscription.updated` → handle plan changes

**Customer Portal:**
1. `POST /api/billing/portal` creates a Stripe Customer Portal session
2. User is redirected to Stripe's hosted portal
3. From there they can cancel, update payment, download invoices
4. On cancellation: Stripe sends `customer.subscription.deleted` webhook

---

## 8. App Enhancements for Multi-User

These are changes required to the existing visualization app to work in a multi-user, hosted environment.

### 8.1 Remove disk-based data loading

Currently: `app/graph/page.tsx` reads `data/graph.json` from disk.
Future: Load graph data from Supabase Storage (or a `/api/graph` endpoint that fetches the user's graph from storage).

Each visualization page must:
1. Get the authenticated user's session
2. Fetch that user's graph data from remote storage
3. Pass it to the Canvas component as before

### 8.2 Sync trigger moved to UI

Currently: sync is triggered via CLI (`npm run sync`) or `POST /api/sync` with no auth.
Future:
- Dashboard has a "Sync Now" button
- `POST /api/sync` requires auth, reads user's stored Notion OAuth token, scopes data to user
- Sync writes to Supabase Storage, not local disk

### 8.3 Config scoped per user

Currently: `data/config.json` is global.
Future:
- User config (field visibility, colors, etc.) stored in Postgres per user
- `/api/config` and `/api/field-config` require auth and scope reads/writes to `user_id`

### 8.4 Header & navigation

Add a persistent top header to all visualization pages:
- Logo / "RelationCity" home link
- Current visualization mode breadcrumb
- Sync status indicator (last synced X minutes ago)
- User avatar with dropdown: Settings, Billing, Sign Out

This replaces or augments the existing navigation (review current nav before designing).

### 8.5 Attribution watermark (Free tier)

Free-tier users see a small, tasteful watermark in the corner of visualizations:
- "Built with RelationCity" with a link
- Clicking it goes to the landing/pricing page
- Removed for Pro users

### 8.6 Onboarding empty state

When a user has just signed up and has no data yet, the visualization canvases should show a friendly empty state rather than an empty 3D scene:
- "Your Notion data will appear here once you've synced"
- CTA: "Connect Notion" or "Sync Now"

---

## 9. Open Design Questions

These are design decisions that need to be resolved before implementation begins.

### Product
1. **Pricing:** Is $10.99/year the right price, or should we reconsider? (See architecture-decisions.md §7 for analysis)
2. **Free tier value:** Should free-tier users get all 5 visualization modes, or should some modes be Pro-only?
3. **Auto-sync:** What cadence for paid users? Hourly seems aggressive for Notion API rate limits. Daily? Or just "on demand"?
4. **Data retention:** How long do we retain data after account deletion? 30 days? Immediately?
5. **Team/shared workspaces:** Is this a v1 feature or post-launch? (Could significantly increase complexity)

### UX
6. **Database selection (free tier):** Do free users pick 2 databases upfront (during onboarding), or do they connect everything and we only process 2? Which 2?
7. **Re-sync experience:** Does "Sync Now" wipe existing data and re-build, or is it incremental? Current code does a full rebuild — is that acceptable for v1?
8. **Navigation:** What should the "home" experience be for a logged-in user — Dashboard, or drop straight into their last-used visualization?

### Technical
9. **Graph data caching:** Graph data can be 7–30 MB. Should it be served directly from Supabase Storage (CDN), or proxied through Next.js API routes?
10. **Sync progress:** The sync can take 30+ seconds. What does the user see while waiting? A progress bar, or fire-and-forget with a notification?
11. **Mobile:** Is mobile a supported platform for v1? The 3D canvases are mouse/keyboard-driven. Probably mobile-unfriendly — is a mobile-aware layout needed, or just a "desktop recommended" message?
