# Koda Website

This workspace contains Koda's public-facing website. It is a Next.js App Router application that packages the landing page, product narrative, developer workflow sections, pricing, and conversion flow for the broader Koda project.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript 5.9
- Tailwind CSS 4
- Framer Motion
- Three.js via React Three Fiber, Drei, and Postprocessing

## Scripts

Run all commands from `Website/`:

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
```

The local dev server runs on `http://localhost:3000`.

## Workspace layout

- `src/app/layout.tsx`: global app shell, metadata, font setup, and `globals.css` import
- `src/app/page.tsx`: homepage composition for the navbar, hero, stats, features, how-it-works, developer workflows, pricing, CTA, and footer sections
- `src/lib/constants.ts`: shared content model for navigation, hero copy, features, command examples, developer workflows, pricing, CTA copy, and footer metadata
- `src/components/`: section-level UI organized by domain (`hero`, `features`, `how-it-works`, `dev-workflows`, `pricing`, `footer`, `ui`, and related modules)
- `src/app/globals.css`: design tokens, typography wiring, glass/noise effects, animation primitives, and shared utility classes
- `next.config.ts`: Turbopack aliasing for Tailwind resolution
- `tsconfig.json`: strict TypeScript config with the `@/*` path alias mapped to `src/*`

## Development notes

- Treat `src/app/page.tsx` as composition only. When a section changes, update the relevant component under `src/components/` instead of growing the page file.
- Keep reusable or data-driven copy in `src/lib/constants.ts`. Reserve component files for structure, interaction, and presentation logic.
- Global typography is configured in `src/app/layout.tsx` with `Syne`, `Outfit`, and `JetBrains Mono`.
- Styling conventions live in `src/app/globals.css`. Prefer extending the existing theme tokens and shared utilities before introducing one-off values.

## Scope

Keep this README focused on the `Website/` workspace. Do not use it to document the native macOS application, infrastructure, or unrelated repository modules.
