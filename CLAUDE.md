# UBChaos

Ultimate Bravery rooms for League of Legends, on Cloudflare Workers + Durable Objects.

- `src/`: Worker (`index.ts`) and the per-room Durable Object (`room.ts`).
- `public/`: static vanilla JS client; rolls are computed client-side from Data Dragon.
- Local dev: `npm run dev`, then open http://127.0.0.1:8787 (not `localhost`: IPv6 fallback adds ~200 ms per request on this machine).
- Checks: `npm run check` (tsc).
- Production: https://ubchaos.pilalheur.workers.dev (the Cloudflare account's workers.dev subdomain is shared with Pilalheur; do not rename it).

## Versioning

Semantic versioning, single source of truth: `version` in `package.json`.
- Build number = `git rev-list --count HEAD`, injected with the short commit SHA at deploy time (`BUILD_NUMBER`, `COMMIT_SHA` vars). Exposed at `/api/version` and shown in the header.
- Major stays at `0` during the test phase. Only move to `1.0.0` when the user explicitly says it is the first real release.

## Release procedure ("fais une release")

1. Pick the bump from the changes since the last tag (`git log <last-tag>..HEAD`), unless the user names it:
   - while major is 0: breaking or significant new feature set -> minor, everything else -> patch;
   - from 1.0.0: breaking change -> major, new feature -> minor, fix only -> patch.
   State the chosen bump and why.
2. `npm version <bump> --no-git-tag-version`.
3. In `CHANGELOG.md`, move `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD` and leave an empty `[Unreleased]`.
4. Commit `Release vX.Y.Z`, tag `vX.Y.Z` (annotated), push commit and tag as The-Ston.
5. The `Release` GitHub workflow deploys to Cloudflare and publishes the GitHub release; check it with `gh run watch`.
