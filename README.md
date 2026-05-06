This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

## Docker

Build and run the app plus sync worker:

```bash
docker compose up --build
```

- App: [http://localhost:3000](http://localhost:3000)
- Sync worker health: [http://localhost:4000/healthz](http://localhost:4000/healthz)
- Trigger sync manually:

```bash
curl -X POST http://localhost:4000/trigger-sync
```

## CI/CD

- CI workflow (`.github/workflows/ci.yml`) runs lint + build on PRs and pushes to `main`.
- CD workflow (`.github/workflows/cd.yml`) runs on:
  - `develop` -> tags image as `staging`
  - `main` -> tags image as `latest`
- CD can also be triggered manually (`workflow_dispatch`) with environment choice:
  - `staging` -> tags image as `staging`
  - `production` -> tags image as `latest`
- Manual `production` runs require setting `confirm_production` to `deploy-production`.
- If omitted, the workflow fails fast with a clear error message and no build/deploy starts.
- CD always pushes image tags to GHCR (`ghcr.io/<owner>/<repo>`).
- Optional deploy webhook step uses these GitHub Actions secrets:
  - `DEPLOY_WEBHOOK_URL_STAGING` for `develop`
  - `DEPLOY_WEBHOOK_URL_PROD` for `main`
- If the corresponding webhook secret is missing, deploy is skipped safely.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
