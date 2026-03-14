# New Computer Setup Guide

## System Requirements

- **Node.js**: v22 or v24 (project uses v24.11.0)
- **npm**: v9+

> Install Node.js via [nvm](https://github.com/nvm-sh/nvm) or [Node.js installer](https://nodejs.org).

---

## 1. Clone the Repository

```bash
git clone <repo-url>
cd RelationMap
```

---

## 2. Install Dependencies

```bash
npm install
```

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | ^16.1.6 | React framework |
| `react` | 19.0.0 | UI library |
| `react-dom` | 19.0.0 | React DOM rendering |
| `node-cron` | ^3.0.3 | Scheduled sync tasks |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.8.2 | Type checking |
| `@types/node` | ^22.13.9 | Node.js type definitions |
| `@types/react` | ^19.0.10 | React type definitions |
| `@types/react-dom` | ^19.0.4 | React DOM type definitions |
| `tailwindcss` | ^3.4.17 | Utility-first CSS framework |
| `autoprefixer` | ^10.4.20 | CSS vendor prefixing |
| `postcss` | ^8.5.3 | CSS processing |
| `eslint` | ^9.21.0 | Code linting |
| `eslint-config-next` | 15.2.4 | Next.js ESLint rules |
| `tsx` | ^4.19.3 | TypeScript script runner |

---

## 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.local.example .env.local  # if example exists, otherwise create manually
```

Add the following variables:

```env
NOTION_TOKEN=<your_notion_integration_token>
NOTION_ROOT_PAGE=<notion_page_url_or_id>
```

| Variable | Description |
|----------|-------------|
| `NOTION_TOKEN` | Notion integration secret token — get from [Notion Integrations](https://www.notion.so/my-integrations) |
| `NOTION_ROOT_PAGE` | URL or ID of the Notion root page to crawl for child databases |

---

## 4. Sync Data from Notion

Pull the initial data from your Notion workspace:

```bash
npm run sync
```

---

## 5. Start the Development Server

```bash
npm run dev
```

App will be available at [http://localhost:3000](http://localhost:3000).

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run sync` | Sync data from Notion |
