# RelationCity — Architecture Decision Record
## Going Live: Multi-User SaaS with Payments

**Date:** 2026-03-20
**Status:** Draft — decisions to be made

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Data Storage: Backend Database](#2-data-storage-backend-database)
3. [Hosting the Application](#3-hosting-the-application)
4. [Notion OAuth Integration](#4-notion-oauth-integration)
5. [Authentication (User Accounts)](#5-authentication-user-accounts)
6. [Payments & Pricing](#6-payments--pricing)
7. [Cost Model & Profitability Analysis](#7-cost-model--profitability-analysis)
8. [Decision Summary Matrix](#8-decision-summary-matrix)

---

## 1. Current State Summary

RelationCity is a local-first, single-user Next.js app. Here's what exists today:

| Concern | Current State |
|---|---|
| Notion auth | Static Bearer token in `.env.local` / `config.json` |
| Data storage | Disk — JSON files in `data/` |
| Typical data size | ~27 MB per user (7.3 MB graph.json + 20 MB node files) |
| Databases | None (no backend DB) |
| Auth | None |
| Payments | None |
| Deployment | None (no config, runs locally only) |
| Multi-user | Not supported |

The core app is ~16,500 LOC, well-structured, and the visualization layers are completely independent from each other, which makes the migration to SaaS incrementally feasible.

---

## 2. Data Storage: Backend Database

### What needs to be stored per user

| Data Type | Size Estimate | Notes |
|---|---|---|
| User profile | < 1 KB | Auth ID, email, plan, billing status |
| Notion workspace credentials | < 1 KB | OAuth access token, workspace ID, bot ID |
| `graph.json` equivalent | 3–10 MB | Synced node/edge graph per workspace |
| Individual node files | 5–25 MB | ~5,000 nodes × 400-1,300 bytes each |
| Schemas | 100–200 KB | ~29 schemas, small |
| `config.json` | < 5 KB | Field visibility, color config, preferences |
| **Total per user** | **~8–35 MB** | Your site at 27 MB is on the larger end |

**Average estimate for pricing:** ~15 MB per user (many users will have smaller Notion workspaces, connecting only 2–5 databases on the free tier).

**Free tier (2 databases):** ~2–5 MB per user
**Paid tier (unlimited):** ~10–40 MB per user

### Option A: PostgreSQL + Object Storage (Recommended)

Store structured data (users, workspaces, billing) in PostgreSQL. Store the synced graph blobs in object storage (S3-compatible).

**Stack:**
- **Postgres** for relational data: users, workspaces, subscriptions
- **S3 / R2 / Supabase Storage** for graph blobs (graph.json, node files, schemas)
- API layer reads/writes blobs on sync; serves them to the Next.js app

**Pros:**
- Scales naturally; blobs don't bloat the relational DB
- Supabase gives you Postgres + Storage + Auth in one product
- R2 (Cloudflare) is free for up to 10 GB storage + 10M reads/month

**Cons:**
- More moving parts than a pure DB solution
- Need to refactor sync to write to remote storage instead of disk

### Option B: Supabase (Postgres + Storage + Auth)

Supabase bundles everything: Postgres, file storage, and auth. This is the fastest path to production.

**Free tier:** 500 MB DB, 1 GB file storage, 50,000 MAU
**Pro tier ($25/mo):** 8 GB DB, 100 GB storage, unlimited MAU

At 15 MB avg per user:
- 100 users → 1.5 GB → Free tier maxes out fast
- 500 users → 7.5 GB → Pro tier handles this comfortably
- 1,000 users → 15 GB → Pro tier + storage add-ons (~$0.021/GB/month over)

**Decision needed:** Are you comfortable with Supabase as a hosted dependency? It's the lowest-friction option.

### Option C: PlanetScale / Neon (Serverless Postgres)

Neon is serverless Postgres with branch previews. Good for the DB layer only — you'd still need object storage separately.

**Neon Free:** 512 MB, 3 projects
**Neon Launch ($19/mo):** 10 GB, autoscaling

---

**Recommendation:** **Supabase** for the initial launch. It handles Postgres + blob storage + auth in one dashboard, has a generous free tier for development, and the Pro tier at $25/mo covers the first ~500 users comfortably.

---

## 3. Hosting the Application

The app is a Next.js 16 App Router project. You need to host the Node.js server somewhere.

### Option A: Vercel (Recommended for simplicity)

Purpose-built for Next.js. Zero-config deployment from GitHub.

| Tier | Price | Limits |
|---|---|---|
| Hobby | Free | 100 GB bandwidth, no custom domains on free (personal projects only) |
| Pro | $20/mo | 1 TB bandwidth, commercial use allowed, team access |

**Pros:** Zero-config, instant deploys, global CDN, edge functions work natively
**Cons:** Can get expensive at scale; not ideal if you have heavy server-side compute

**For your scale:** Pro at $20/mo handles thousands of users easily. The app is mostly static + API calls to Supabase.

### Option B: Railway

Container-based hosting. More control, cheaper at scale.

| Plan | Price |
|---|---|
| Hobby | $5/mo (includes $5 credit) |
| Pro | $20/mo |

Deploy as a Docker container or via GitHub. Good if you want more predictable pricing as you scale.

### Option C: Fly.io

Global edge deployment. Very competitive pricing.

- $0 for small apps (shared CPU, 256 MB RAM — probably not enough for Three.js SSR)
- ~$5–10/mo for a small VM with enough RAM

**Cons:** More DevOps setup required.

### Option D: Cloudflare Pages + Workers

Works for Next.js via the `@cloudflare/next-on-pages` adapter. Very cheap at scale.

**Free tier:** Unlimited requests, 500 builds/month
**Paid:** $5/mo (Workers Paid)

**Tradeoff:** Some Next.js features have edge-runtime restrictions. The app uses heavy server components and Node.js APIs — test compatibility before committing.

---

**Recommendation:** **Vercel Pro ($20/mo)** for launch. It's the lowest-friction path, handles everything, and $20/mo is trivial next to your revenue at even 50 paid users. Re-evaluate at 500+ users if compute costs spike.

---

## 4. Notion OAuth Integration

### Current approach: Static token

Right now, users copy their Notion integration token and paste it into the app. This is friction-heavy and means users need to manually create a Notion integration.

### Moving to OAuth

Notion supports OAuth 2.0 for public integrations. This lets users click "Connect to Notion" and authorize your app — no token copying required.

**OAuth flow:**
1. User clicks "Connect to Notion" in your app
2. Redirected to `https://api.notion.com/v1/oauth/authorize?client_id=...&redirect_uri=...&response_type=code`
3. User selects which pages/databases to share with your app
4. Notion redirects back to your `redirect_uri` with an auth code
5. Your server exchanges the code for an `access_token` + `workspace_id` + `bot_id`
6. Store the `access_token` in your DB, use it for all API calls for that user

**Key detail for free tier limiting:** When the user goes through the OAuth flow, Notion shows a page picker — the user explicitly selects which pages/databases your integration can see. However, **you cannot programmatically limit the number of databases at the OAuth step** — Notion controls that UI.

**How to enforce the 2-database limit:**
- After OAuth, when you crawl the workspace, discover all available databases
- Store all discovered database IDs
- For free-tier users: only sync/display the first 2 databases (or let them choose which 2)
- Block additional syncs beyond the limit in your API layer
- Show a clear upgrade prompt when the limit is hit

This is the correct, enforceable approach. You cannot tell Notion to only show 2 databases — but you can choose to only process 2 on your end.

### Notion OAuth App setup

1. Go to [notion.so/my-integrations](https://notion.so/my-integrations) → Create new integration
2. Set type to "Public" (required for OAuth)
3. Add OAuth redirect URI (e.g., `https://yourdomain.com/api/auth/notion/callback`)
4. You'll get a `Client ID` and `Client Secret` — store in env vars
5. Submit for Notion review (required for public OAuth apps — typically a few days)

**Important:** Notion requires review for public OAuth integrations. Plan for a 1–2 week review window before launch.

### Token storage

Store the `access_token` encrypted in Postgres (Supabase handles this well with Row Level Security). Do **not** store tokens in `config.json` on disk — that was fine for local use, not for multi-user.

---

## 5. Authentication (User Accounts)

### Options

| Provider | Best For |
|---|---|
| Google OAuth | Fastest adoption; almost everyone has a Google account |
| Apple Sign-In | Required if you ever ship an iOS app; adds trust for Apple users |
| Email/Password | Fallback for users without Google/Apple; requires email verification flow |
| Magic Link (email) | Passwordless email; lower friction than email/password |

### Recommendation: All three, via a single auth provider

Rather than building this yourself, use an auth service:

**Option A: Supabase Auth (Recommended if using Supabase)**
- Built into Supabase — zero extra cost
- Supports Google, Apple, email/password, magic link out of the box
- Row Level Security (RLS) ties directly to auth users
- No extra service to manage

**Option B: Clerk**
- Beautiful pre-built UI components
- $25/mo for production (up to 10,000 MAU free)
- Handles all providers, sessions, JWTs
- Best if you want to spend zero time on auth UI

**Option C: NextAuth.js / Auth.js**
- Open source, self-hosted
- Works with Next.js natively
- Free, but you own all the complexity
- Good if you want full control and don't mind setup

**Decision needed:** If you go with Supabase, use Supabase Auth — it's free and deeply integrated. If you want the nicest out-of-box UI, use Clerk.

### Auth flow for RelationCity

1. User signs up / signs in (Google, Apple, or email)
2. Auth provider creates a session + JWT
3. After sign-in, user is prompted to connect their Notion workspace (OAuth flow above)
4. User's plan (free/paid) is checked on every sync request
5. API routes are protected — all endpoints require a valid session token

---

## 6. Payments & Pricing

### Pricing Structure

**Free Tier:**
- 2 Notion database connections
- All visualization modes (Graph, City, Mountain, Timeline, User)
- Manual sync only (no scheduled syncs)
- Watermark or "Powered by RelationCity" attribution

**Paid Tier — $4.99/month or $39.99/year:**
- Unlimited Notion database connections
- All visualization modes
- Scheduled auto-sync (e.g., every hour)
- No attribution watermark
- Priority support

### Payment Processor Options

**Option A: Stripe (Recommended)**

The industry standard. Handles subscriptions, annual billing, trials, refunds, and tax compliance.

- **Fees:** 2.9% + $0.30 per transaction
- **Monthly at $4.99:** Stripe takes ~$0.44/mo → you net ~$4.55/mo (~$54.60/year) per user
- **Annual at $39.99:** Stripe takes ~$1.46 → you net ~$38.53 per user/year
- **Stripe Billing:** Handles recurring payments, dunning (failed payment retry), upgrade/downgrade
- **Stripe Tax:** Auto-calculates sales tax / VAT by location (important for EU users)

Setup:
1. Create Stripe account
2. Create a Product + Price ($10.99/year, recurring)
3. Use Stripe Checkout (hosted) or Stripe Elements (embedded)
4. Webhook to update user's plan in your DB on `checkout.session.completed` and `invoice.payment_failed`

**Option B: Lemon Squeezy**

Merchant of Record — they handle all tax compliance globally so you don't need to worry about VAT/GST. Slightly higher fees (~5% + $0.50) but eliminates the tax headache.

Good if you expect significant international customers early.

**Option C: Paddle**

Similar to Lemon Squeezy — Merchant of Record model. More mature, used by many SaaS apps.

---

**Recommendation:** **Stripe** for launch. The 2.9% + $0.30 fee is well-understood, and Stripe Tax handles compliance. At $4.99/month you net ~$4.55/month per user; at $39.99/year you net ~$38.53 per user.

### Pricing Page

A `/pricing` page should be added to the app that shows:
- Side-by-side Free vs Paid comparison table
- Clear CTA: "Get Started Free" and "Upgrade to Pro"
- Monthly ($4.99/mo) and Annual ($39.99/year) options — annual shown as "Save 33%"
- FAQ: "What counts as a database?", "Can I cancel?", "What happens if I exceed free limit?"

---

## 7. Cost Model & Profitability Analysis

### Infrastructure Cost Stack

| Service | Plan | Monthly Cost |
|---|---|---|
| Vercel | Pro | $20/mo |
| Supabase | Pro | $25/mo |
| **Total fixed** | | **$45/mo = $540/year** |

### Variable Costs

**Supabase Storage (Postgres + File Storage):**
- Pro: 8 GB Postgres, 100 GB file storage included
- Overage: $0.021/GB/month for storage
- 100 paid users × 20 MB avg = 2 GB → well within free
- 1,000 paid users × 20 MB = 20 GB → ~$12/mo overage
- 5,000 paid users × 20 MB = 100 GB → ~$42/mo overage (still very manageable)

**Vercel bandwidth:**
- Pro: 1 TB included
- The app is mostly 3D canvas + API calls to Supabase — bandwidth is low
- 1,000 active users at 50 MB/session = 50 GB/mo → trivial

### Revenue Model

Assumes a realistic mix: ~60% of paid users choose monthly, ~40% choose annual.
- Monthly net per user/year: ~$54.60 (12 × $4.55)
- Annual net per user/year: ~$38.53

Blended net per paid user/year: ~$48.60

| Paid Users | Annual Revenue (gross) | Annual Infrastructure | Net Profit |
|---|---|---|---|
| 10 | ~$486 | $540 | **-$54** (near break-even) |
| 15 | ~$729 | $540 | **$189** |
| 25 | ~$1,215 | $540 | **$675** |
| 50 | ~$2,430 | $545 | **$1,885** |
| 100 | ~$4,860 | $560 | **$4,300** |
| 250 | ~$12,150 | $590 | **$11,560** |
| 500 | ~$24,300 | $640 | **$23,660** |
| 1,000 | ~$48,600 | $780 | **$47,820** |
| 5,000 | ~$243,000 | $1,560 | **$241,440** |

### Is $4.99/month or $39.99/year sufficient?

**Yes — profitable from ~15 paid users.**

The $45/mo fixed infrastructure cost means you break even around 10–12 paid users, and are clearly profitable by 15. This is a dramatic improvement over the $10.99/year model which required ~50 paid users just to break even.

**Why this pricing works:**
- $4.99/month is still extremely affordable vs. comparable tools ($10–20/month is typical)
- Annual option ($39.99) gives users a ~33% discount and you get better cash flow up front
- Low price point reduces friction to upgrade from free — the "just try it" threshold is lower
- Room to raise prices later as the product matures; much harder to do in reverse

---

## 8. Decision Summary Matrix

| Decision | Options | Decision Made | Status |
|---|---|---|---|
| Backend DB | Supabase / PlanetScale + S3 / Neon + R2 | **Supabase (Postgres + Storage)** | ✅ Decided |
| App hosting | Vercel / Railway / Fly.io / Cloudflare Pages | **Vercel Pro** | ✅ Decided |
| Notion auth | Static token / OAuth | **OAuth** | ✅ Decided |
| User auth | Supabase Auth / Clerk / NextAuth | **Supabase Auth** | ✅ Decided |
| Auth providers | Google / Apple / Email | **All three** | ✅ Decided |
| Payment processor | Stripe / Lemon Squeezy / Paddle | **Stripe** | ✅ Decided |
| Pricing | Monthly / Annual | **$4.99/mo or $39.99/year** | ✅ Decided |
| Free tier limit | 2 databases | **Enforced server-side after OAuth** | ✅ Decided |
| Auto-sync | Free: manual / Paid: scheduled | **Paid-only feature** | ✅ Decided |

---

## Open Questions

1. **Domain name:** TBD — see `pre-launch-setup.md` for step-by-step instructions.
2. **Notion review:** Not yet started — see `pre-launch-setup.md`. Submit ASAP; 1–2 week wait.
3. **Tax/legal entity:** TBD (sole proprietor or LLC) — see `pre-launch-setup.md` for Stripe setup steps.
4. ~~**Sync frequency:**~~ ✅ **Daily auto-sync for paid tier. Free tier is manual on-demand only.**
5. ~~**Data deletion:**~~ ✅ **30-day retention after cancellation or payment failure for paid users. Free tier synced data expires after 30 days of inactivity — user must re-sync to refresh.**
