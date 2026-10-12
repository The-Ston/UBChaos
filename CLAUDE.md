# UBChaos

Ultimate Bravery rooms for League of Legends, on Cloudflare Workers + Durable Objects.

- `src/`: Worker (`index.ts`) and the per-room Durable Object (`room.ts`).
- `public/`: static vanilla JS client; rolls are computed client-side from Data Dragon.
- Local dev: `npm run dev`, then open http://127.0.0.1:8787 (not `localhost`: IPv6 fallback adds ~200 ms per request on this machine).
- Checks: `npm run check` (tsc).
- Tests: `npm test` (node:test, ~30 s): `test/bravery.test.mjs` roll rules on live Data Dragon, `test/room.test.mjs` room rules over WebSockets, `test/e2e.test.mjs` browser flows with puppeteer-core. Each server-backed file starts its own `wrangler dev` (ports 8791/8792, temp storage); e2e needs a Chromium-based browser (`CHROME_PATH`, auto-detects Chrome/Edge). The release workflow runs them before deploying. Add or update tests with each feature.
- Link previews: the Worker serves `/` and `/r/*` and fills the Open Graph tags (room details, absolute URLs) with HTMLRewriter. Preview images are rendered from `scripts/og-image.html` by `node scripts/render-og-image.mjs` and committed: `public/og-image.png` for the site, and `public/og/<mode>-<choices>-<rerolls|x>.jpg` for each room setting combination (re-run it when modes or room limits change).
- Item groups (items that cannot be owned together): Data Dragon lacks them, so `public/item-groups.js` is generated from the game files on CommunityDragon by `node scripts/update-item-groups.mjs` (never edit it by hand, no per-mode exceptions). A test fails when it is outdated (skipped if CommunityDragon is down). The `Item groups` workflow runs daily: when the groups changed since the latest release, the bot publishes a patch release built from that release tag (the tag is off master, so pending changes are never released by the bot) and commits the same table, version and changelog section to master. Any failure opens one `item-groups-sync` issue.
- Production: https://ubchaos.pilalheur.workers.dev (the Cloudflare account's workers.dev subdomain is shared with Pilalheur; do not rename it).

## Versioning

Semantic versioning, single source of truth: `version` in `package.json`.
- Build number = `git rev-list --count HEAD`, injected with the short commit SHA at deploy time (`BUILD_NUMBER`, `COMMIT_SHA` vars). Exposed at `/api/version` and shown in the header.
- First real release was `1.0.0` (2026-10-09); the 0.x test phase is over.

## Release procedure ("fais une release")

1. Pick the bump from the `[Unreleased]` entries and the commits behind them, unless the user names it (the latest tag may be a bot release off master, so `git log <last-tag>..HEAD` can show more than what is pending):
   breaking change -> major, new feature -> minor, fix only -> patch.
   State the chosen bump and why.
2. `npm version <bump> --no-git-tag-version`.
3. In `CHANGELOG.md`, move `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD` and leave an empty `[Unreleased]`.
4. Commit `Release vX.Y.Z`, tag `vX.Y.Z` (annotated), push commit and tag as The-Ston.
5. The `Release` GitHub workflow deploys to Cloudflare and publishes the GitHub release; check it with `gh run watch`.
