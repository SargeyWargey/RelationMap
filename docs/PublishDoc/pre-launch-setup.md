# RelationCity — Pre-Launch Setup Guide
## Domain, Notion OAuth Review & Legal/Stripe Setup

**Date:** 2026-03-20
**These steps must be completed before any code ships to production.**

---

## Overview

Three things that are NOT code changes but are critical blockers for launch:

| Task | Time to Complete | Blocks |
|---|---|---|
| 1. Register a domain | 15 min (+ DNS propagation 24–48 hrs) | Everything |
| 2. Notion public integration review | 1–2 weeks (Notion's timeline) | OAuth login |
| 3. Legal entity + Stripe setup | 1–3 days | Taking payments |

Do all three in parallel as soon as possible. The Notion review is the longest lead time — start it first.

---

## 1. Domain Name

### Why this comes first

Your domain is referenced in:
- The Notion OAuth redirect URI (required before submitting for Notion review)
- Stripe's success/cancel redirect URLs
- Supabase's allowed auth redirect URLs
- Your SSL certificate

You need a domain locked in before you can complete steps 2 or 3.

### What to look for in a domain

- Short, memorable, and related to the product
- `.com` is preferred for credibility; `.app` or `.io` are acceptable alternatives
- Avoid hyphens
- Examples to check availability: `relationcity.com`, `relationcity.app`, `relationcity.io`, `getcity.app`, `citygraph.app`

### Step-by-step: Register a domain

1. **Check availability**
   - Go to [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) — they sell domains at cost with no markup
   - Alternatively: [Namecheap](https://www.namecheap.com) or [Google Domains (now Squarespace Domains)](https://domains.squarespace.com)
   - **Recommended: Cloudflare Registrar** — since you'll likely use Cloudflare for DNS anyway, keeping everything in one place simplifies management

2. **Purchase the domain**
   - Create a Cloudflare account if you don't have one (free)
   - Search for your chosen domain in the Registrar section
   - Purchase — typical cost is $8–15/year for `.com`, $8–12/year for `.app` or `.io`
   - Auto-renewal is on by default — leave it on

3. **Set up DNS**
   - After purchase, DNS is automatically managed by Cloudflare
   - You'll add DNS records for Vercel after you deploy — Vercel gives you the exact records to add
   - For now, just having the domain registered is enough to proceed

4. **Decide on subdomain structure**
   - `www.yourdomain.com` — standard
   - `app.yourdomain.com` — if you want to separate marketing site from the app later
   - For v1: `www.yourdomain.com` for everything is fine

5. **Record the domain** — you'll need it in both steps 2 and 3 below

---

## 2. Notion Public Integration Review

### Why this is required

Notion has two types of integrations:
- **Internal integrations** — private, token-only, what the app uses today
- **Public integrations** — OAuth-based, shown to users in the Notion UI, requires Notion's approval

To let other users connect their Notion workspaces to RelationCity, you must create a Public integration and pass Notion's review. There is no way around this.

**Notion's review typically takes 1–2 weeks.** Submit as early as possible.

### What Notion reviews

Notion checks that your integration:
- Has a real, working product (they may test the OAuth flow)
- Has a published privacy policy and terms of service
- Only requests the scopes it actually needs
- Has a real domain (not localhost)

This means you need a domain (step 1) and basic privacy policy / terms pages live before submitting.

### Step-by-step: Create and submit the Notion integration

#### Phase 1: Create the integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and sign in with your Notion account
2. Click **"New integration"**
3. Fill in:
   - **Name:** RelationCity (or your product name)
   - **Logo:** Upload a square logo (PNG, at least 512×512px)
   - **Associated workspace:** Select your personal workspace for development
4. Under **"Type"**, select **"Public"** — this is what enables OAuth
5. Under **"Capabilities"**, select only what you need:
   - ✅ Read content (required — to read databases and pages)
   - ✅ Read user information including email addresses (required — to identify the user)
   - ❌ Update/insert/delete content — do NOT request these, you don't need them and it reduces user trust
6. Under **"OAuth Domain & URIs"**, add:
   - **Redirect URIs:** `https://yourdomain.com/api/notion/callback`
   - You can also add `http://localhost:3000/api/notion/callback` for development
7. Save the integration
8. Copy and securely store:
   - **OAuth client ID** → will become `NOTION_CLIENT_ID` in your env vars
   - **OAuth client secret** → will become `NOTION_CLIENT_SECRET` in your env vars

#### Phase 2: Prepare required content

Before submitting for review, you must have these live on your domain:

1. **Privacy Policy page** (`/privacy`)
   - What data you collect (email, Notion workspace info, synced database content)
   - How it's stored (Supabase, encrypted)
   - How long it's retained (30-day policy after cancellation)
   - How users can request deletion
   - Contact email for privacy inquiries
   - You can generate a solid first draft using a privacy policy generator like [Termly](https://termly.io) or [iubenda](https://www.iubenda.com) — both have free tiers

2. **Terms of Service page** (`/terms`)
   - What the service does
   - Acceptable use
   - Payment and refund terms
   - Limitation of liability
   - Same generators as above work for ToS

3. **A working OAuth flow** (can be on a staging/preview URL)
   - Notion may test the actual OAuth flow during review
   - Vercel preview deployments are fine for this — you'll get a URL like `yourdomain.vercel.app`
   - Add that URL's callback to your allowed redirect URIs temporarily

#### Phase 3: Submit for review

1. Back in your integration settings at notion.so/my-integrations, look for the **"Submit for review"** option
2. Fill out the submission form:
   - **Product description:** What RelationCity does, who it's for
   - **OAuth use case:** "Users connect their Notion workspace so RelationCity can read their databases and visualize them in 3D spatial views"
   - **Privacy policy URL:** `https://yourdomain.com/privacy`
   - **Terms of service URL:** `https://yourdomain.com/terms`
   - **Screenshot or demo video:** Record a short Loom or video showing the OAuth flow and the app in action
3. Submit and wait — Notion will email you with approval or requests for changes

#### Phase 4: After approval

1. Your integration will be listed publicly in Notion's integration directory (optional — you can set it to unlisted)
2. The OAuth flow will work for all Notion users, not just your workspace
3. Update your `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` env vars in Vercel's dashboard

### Development tip

While waiting for Notion review, you can build and test the entire OAuth flow using your integration in **internal mode** — it will work for your own workspace. The only thing that changes after approval is that other users' workspaces will also be able to authorize.

---

## 3. Legal Entity & Stripe Setup

### Why this matters

Stripe requires:
- A business or individual identity to pay out to
- A bank account or debit card for payouts
- Tax information (EIN if a business, SSN if sole proprietor in the US)

You cannot receive payments to a Stripe account without completing identity verification.

### Option A: Sole Proprietor (Simplest, fastest)

If you don't have an LLC or corporation, you can sign up as an individual / sole proprietor. This is legitimate and common for indie SaaS.

- **Pros:** No setup cost, no extra paperwork, can start immediately
- **Cons:** Personal liability (unlikely to matter at this scale), revenue attributed to your personal SSN

### Option B: LLC (Recommended if you're serious)

An LLC separates your personal finances from the business, gives you a business bank account, and looks more professional to users.

- **Cost:** $50–300 one-time state filing fee (varies by state; Delaware and Wyoming are popular for low fees and flexible laws)
- **Time:** 1–5 business days online in most states
- **After forming:** Get an EIN (free, instant, at irs.gov), open a business checking account
- **Recommended service:** [Stripe Atlas](https://stripe.com/atlas) ($500, forms a Delaware C-Corp or LLC + opens Stripe account together) or [Clerky](https://www.clerky.com) for C-Corp, or just file directly with your state for an LLC

### Step-by-step: Set up Stripe

#### Phase 1: Create your Stripe account

1. Go to [stripe.com](https://stripe.com) and click "Start now"
2. Enter your email and create a password
3. Verify your email

#### Phase 2: Activate your account (required to receive real payments)

1. In the Stripe dashboard, click **"Activate your account"** in the top banner
2. Fill in:
   - **Business type:** Individual / sole proprietor, or LLC if you have one
   - **Business name:** Your product name or legal name
   - **Business address:** Your real address (used for tax documents)
   - **Business website:** `https://yourdomain.com`
   - **Product description:** "SaaS subscription — 3D Notion data visualization tool"
   - **Bank account:** Routing + account number for payouts
   - **SSN or EIN:** For identity verification
3. Submit — Stripe typically approves within minutes to a few hours

#### Phase 3: Create your product and prices

1. In Stripe dashboard → **Products** → **Add product**
2. **Product name:** "RelationCity Pro"
3. **Description:** "Unlimited Notion database connections, daily auto-sync, no watermark"
4. Add two prices:
   - **Monthly:** $4.99, recurring, monthly interval
     - Copy the Price ID (looks like `price_xxxxxxxx`) → store as `STRIPE_PRICE_MONTHLY`
   - **Annual:** $39.99, recurring, yearly interval
     - Copy the Price ID → store as `STRIPE_PRICE_ANNUAL`

#### Phase 4: Configure webhooks

1. Stripe dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. **Endpoint URL:** `https://yourdomain.com/api/billing/webhook`
3. **Events to listen for:**
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. After saving, copy the **Signing secret** (looks like `whsec_xxxxxxxx`) → store as `STRIPE_WEBHOOK_SECRET`

#### Phase 5: Enable Customer Portal

1. Stripe dashboard → **Settings** → **Billing** → **Customer portal**
2. Enable it and configure:
   - ✅ Allow customers to cancel subscriptions
   - ✅ Allow customers to update payment methods
   - ✅ Show invoice history
   - Set cancellation behavior: cancel at end of billing period (not immediately)
3. Save

#### Phase 6: Collect your env vars

At the end of Stripe setup, you should have these values ready for your `.env.local` and Vercel environment variables:

```
STRIPE_SECRET_KEY=sk_live_xxxxxxxx        # Stripe dashboard → Developers → API keys
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxx   # Same location (publishable key)
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx      # From the webhook endpoint you created
STRIPE_PRICE_MONTHLY=price_xxxxxxxx       # From the monthly price you created
STRIPE_PRICE_ANNUAL=price_xxxxxxxx        # From the annual price you created
```

**Important:** Use `sk_test_` and `pk_test_` keys during development, and only switch to `sk_live_` / `pk_live_` when you're ready to accept real payments in production.

---

## Master Checklist

Use this to track progress before launch:

### Domain
- [ ] Choose and register domain name
- [ ] DNS pointed to Cloudflare (if using Cloudflare Registrar, this is automatic)
- [ ] Note the domain — needed for steps below

### Notion Review
- [ ] Create Public integration at notion.so/my-integrations
- [ ] Copy and store `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`
- [ ] Add redirect URI: `https://yourdomain.com/api/notion/callback`
- [ ] Add redirect URI: `http://localhost:3000/api/notion/callback` (dev)
- [ ] Write Privacy Policy and publish to `/privacy`
- [ ] Write Terms of Service and publish to `/terms`
- [ ] Build OAuth flow on staging/preview URL for Notion to test
- [ ] Record demo video or screenshots of the flow
- [ ] Submit integration for review
- [ ] Receive approval from Notion

### Legal & Stripe
- [ ] Decide: sole proprietor or LLC
- [ ] If LLC: file with state, obtain EIN from irs.gov, open business bank account
- [ ] Create Stripe account
- [ ] Activate Stripe account (identity + bank account)
- [ ] Create "RelationCity Pro" product with monthly ($4.99) and annual ($39.99) prices
- [ ] Configure Stripe webhook endpoint and copy signing secret
- [ ] Enable Stripe Customer Portal
- [ ] Copy all Stripe env vars to a secure location (1Password, etc.)

### Ready to build when:
- [ ] Domain is live
- [ ] Stripe test keys are in `.env.local`
- [ ] Notion OAuth is testable (review pending is fine — use your own workspace for dev)
- [ ] Privacy policy and Terms pages exist (even as stubs)
