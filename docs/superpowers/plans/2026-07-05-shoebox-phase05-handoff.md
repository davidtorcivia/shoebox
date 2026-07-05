# Shoebox Phase 05 Handoff - 2026-07-05

## Current State

Phase 05 is implemented through Task 10 and the worktree was clean after the last commit.

Latest commit:

- `57548bd feat: add person edit page`

Recent Phase 05 commits:

- `57548bd feat: add person edit page`
- `d8d2f97 feat: add person timeline sections`
- `8a41983 feat: add markdown bios and person slugs`
- `d81f473 feat: add gradient person detail page`
- `6d289d0 fix: align people gradient with timeline`
- `f20eb40 feat: add gradient people index`
- `660375f feat: add people API routes`
- `527abc0 feat: add person write service`
- `10c20aa feat: add people read service`
- `00791cc feat: add age calculation helpers`
- `6aa58ea feat: add relationship derivation helpers`

## Completed

- Relationship domain helpers and tests.
- Age calculation helpers and tests.
- People read service and DTOs.
- People write service, guarded delete, and relationship mutation support.
- People API routes:
  - `/api/people`
  - `/api/people/[id]`
  - `/api/people/[id]/relationships`
- Gradient `/people` index with cropped portrait cards.
- Person detail page using shared timeline-style gradient treatment.
- People slugs / pretty URLs. Person pages resolve either slug or legacy id.
- Markdown bios with sanitization.
- Person timeline sections grouped by year with age captions.
- Person edit page:
  - Details edit form.
  - Accent swatches.
  - Live accent updates for gradient, save button, selected avatar ring, and errors.
  - Tagged-item avatar picker.
  - 4:5 crop drag UI.
  - Admin delete button with guarded delete behavior.

## Design Decisions To Preserve

- New pages should use the shared `Gradient` layer, matching the timeline/person-room design.
- Do not add a separate page/menu-bar background. Root `Nav` remains the only nav.
- Avoid the earlier conic/pointed gradient treatment; it was removed.
- Use pretty person slugs in public links, not opaque ids.
- API routes remain id-based for writes.

## Verified Last

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm vitest run src/lib/ui/crop.test.ts` passed.
- Live HTTP checks returned `200` for:
  - `/people`
  - `/people/pretty-link-person/edit`

Full suites were green after Task 9:

- Full UI suite: 87 tests passed.
- Full unit suite: 50 files, 291 tests passed.

## Local Dev Notes

- Temp login:
  - Username: `matriarch`
  - Password: `super-secret-8`
- Cookie jar used for curl checks:
  - `/private/tmp/shoebox-cookies.txt`
- Dev server commonly falls back to:
  - `http://127.0.0.1:5176/`
  - Ports `5173` through `5175` may already be occupied.
- If `pnpm check` triggers an ENOENT involving `.svelte-kit/types/src/routes/proxy+layout.server.ts`, rerun `pnpm check` alone, then restart Vite before live checks.

## Next Task

Start Phase 05 Task 11: relationship editor UI on the person edit page.

Expected files from the plan:

- Add `src/lib/ui/RelEditor.svelte`
- Extend `src/routes/people/[id]/edit/+page.svelte`
- Reuse existing `data.person.family`, `data.others`, and `/api/people/[id]/relationships`
- Preserve slug navigation for public routes and id-based API calls.
- Keep the same gradient/page design already used by the edit page.

Implementation notes:

- The edit page server already loads `others` with `listPeople`; this was added during Task 10 specifically for Task 11.
- There is a placeholder in the edit page:
  - `<!-- Task 11 appends the relationships editor here -->`
- Relationship route already exists and was tested in Task 5.
- Watch for same-person and duplicate relationship handling; the server service already canonicalizes symmetric relationships.

## Still To Do After Task 11

- Task 12: Album DTO/service.
- Task 13: Album API routes.
- Task 14: Album index/detail pages and reorder UI.
- Task 15: Album toggle on media/item surfaces.
- Task 16: profile page actions and admin user-person linking endpoint.
- Task 17: comments service, API, and item-room comments UI.
- Task 18: Phase 05 e2e seed/spec and full verification.

Before finalizing Phase 05, rerun:

- `pnpm check`
- `pnpm vitest run`
- Relevant Playwright/e2e suite from Phase 05

