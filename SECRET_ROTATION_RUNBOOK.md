# Secret Rotation & Git History Remediation Runbook

**Status as of 2026-08-06: the exposure is still live and UNRESOLVED.**
`origin/main` on GitHub (`balsemkhouniblossom/IPROTEX-maintenaceIndustrielle`,
a **public** repository) still has commits reachable in its history
containing `backups/mongodb/*/GMAO_IPROTEX/users.bson` — raw MongoDB exports
with bcrypt password hashes and refresh-token hashes. This is true right now,
as of the last check in this document.

This document supersedes `GIT_HISTORY_PURGE.md`'s "What you still need to
do" section — that doc's prepared mirror is stale (see History below).
Everything up to the actual push, session invalidation, and external
credential rotation is prepared and verified; the actions marked
**YOU RUN THIS** require dashboard access or a `git push` this tool will not
perform, and are not yet done. **Do not treat this incident as closed until
every checkbox in section D is checked and independently confirmed.**

---

## A. Git history purge — current, verified-clean mirror

### History of this mirror (why it changed twice)

1. `GIT_HISTORY_PURGE.md` (2026-08-01) prepared a mirror at
   `GMAO-purge-workspace.git`. By 2026-08-06 it was **20 commits behind**
   `origin/main` — pushing it would have destroyed 20 real commits. Rebuilt.
2. The rebuild (`GMAO-purge-workspace-current.git`) was verified clean and
   current, then one more local commit landed
   (`087d37e` "fix(critical): close MongoDB index drift and add Next.js
   error boundaries"). Rebuilding a third time from a `git clone --mirror`
   of the **local working tree** (to pick up that commit) pulled in stray
   `refs/codex/turn-diffs/checkpoints/...` refs — leftover checkpoint
   bookkeeping from an unrelated tool, **never pushed to GitHub**, pointing
   directly at old **tree** objects rather than commits. `git filter-repo`
   rewrites commit history by walking commits; a ref that points straight at
   a tree is invisible to that walk, so those refs kept `backups/*.bson`
   reachable even after filtering — confirmed by direct inspection
   (`git rev-list --objects --all` still showed 19 `.bson` blobs after the
   "clean" run). This mirror was discarded, unpushed.
3. **Current, verified-clean mirror**: cloned fresh from `origin` (GitHub
   only — no local refs involved), then the single new commit was pulled in
   by SHA (`git fetch <local-repo> 087d37e...`, which only walks that
   commit's own ancestry, not sibling refs), *then* filtered. Verified:
   - Only one ref present: `refs/heads/main` (no stray refs).
   - `git rev-list --objects --all | grep -i backups/` → 0 hits.
   - `git rev-list --objects --all | grep -i "\.bson"` → 0 hits.
   - `main` tip: `6dd9bc20ad984350f97128817b8501d3e3ca4ea3`, 110 commits,
     ending in `fix(critical): close MongoDB index drift and add Next.js
     error boundaries` — i.e. it has the exposure removed *and* the latest
     local work, in one consistent history.

**Location: `C:\Users\Balsem\Desktop\GMAO-purge-workspace-final.git`.**
This is the only mirror that should be pushed from. Both prior mirrors
(`GMAO-purge-workspace.git`, `GMAO-purge-workspace-current.git`) no longer
exist on disk (removed during this session's disk-space cleanup or by this
remediation) — if either reappears from a backup, do not use it.

**Lesson for future history rewrites on this machine**: always build the
mirror from a fresh `git clone <github-url> --mirror`, never from
`git clone --mirror <local-working-tree>`, and always run
`git for-each-ref` on the fresh mirror before filtering to confirm it has
exactly one `refs/heads/main` and nothing under `refs/codex/*` or similar
before trusting a "clean" result.

### Safety net

The original untouched mirror (`GMAO-backup-before-purge.git`) no longer
exists on disk (also removed during cleanup). Since nothing has been pushed
yet, `origin/main` on GitHub itself is still the authoritative unfiltered
history — recreated a local copy anyway as cheap insurance:
**`C:\Users\Balsem\Desktop\GMAO-backup-before-purge-2.git`** (fresh mirror
clone, unfiltered, confirmed 19 `.bson` blobs present, tip `ff74a10`,
untouched — do not filter or push from this one, it exists only as a
restore point).

### YOU RUN THIS — push the rewritten history

```bash
cd "C:/Users/Balsem/Desktop/GMAO-purge-workspace-final.git"
git remote add origin https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git
git push --force origin refs/heads/main:refs/heads/main
```

Before running this: `git ls-remote --heads --tags origin` to confirm `main`
is still the only ref on origin (it was, last checked). If GitHub's branch
protection blocks the push, temporarily disable "Do not allow force pushes"
for `main` under repo Settings → Branches, push, then re-enable it.

Consider flipping the repository to **private** (Settings → General →
Danger Zone → Change visibility) before or immediately after the push, as
extra margin — the force-push removes the exposure going forward, but does
not undo the fact the data was fetchable up to this point.

### YOU RUN THIS — reset every existing local clone afterward

Including `C:\Users\Balsem\Desktop\GMAO` (this working tree) — it still has
the old, unrewritten history and must not be pushed from again, or the
purged commits come right back on the next push from it:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Run `git status` first and stash/commit anything not yet pushed — this
discards local *history*, not working-tree changes, but confirm nothing
uncommitted would be lost. **Every other collaborator with a clone of this
repository must do the same** (or a fresh `git clone`) — anyone who merges
or pulls normally instead will silently resurrect the purged commits the
next time they push.

---

## B. Accounts confirmed exposed — session invalidation status

The local (uncommitted, gitignored) backup dumps under `backups/mongodb/`
were scanned read-only (emails only — no password hashes or tokens were ever
printed) across all `users.bson` files found. **6 unique accounts** appear;
checked read-only against the live production database, **4 are still
active today**:

| Email | Role | Status in production | Session invalidated? |
| --- | --- | --- | --- |
| `admin2@gmail.com` | **admin** | active — highest priority | **NOT YET** |
| `tech1@gmail.com` | technician | active | **NOT YET** |
| `operateur2@gmail.com` | operator | active | **NOT YET** |
| `operateur3@gmail.com` | operator | active | **NOT YET** |
| `superadmin@esprit.tn` | — | not found (already gone) | n/a |
| `verify.final.1782045310@example.com` | — | not found (test account) | n/a |

An attempt to invalidate the 4 active accounts directly (setting
`must_reset_password: true`, `credentials_invalidated_at: now`, clearing
`refresh_token_hash` — the same fields `AuthService.forcePasswordReset` sets,
confirmed enforced by `account-access.validator.ts:67-72` and
`jwt.strategy.ts`) was **blocked by this environment's permission
classifier** and requires your explicit approval to run. It does not send
any email itself — only the full admin-panel action (below) does.

### YOU RUN THIS (or approve the direct DB write above) — force-reset the 4 active accounts

Preferred — via the app itself, which also emails the affected user a reset
link: `POST /auth/force-password-reset/:userId` (admin-only,
`backend/src/auth/auth.controller.ts:272` → `AuthService.forcePasswordReset`,
`auth.service.ts:1279`). Use the admin Users page (find each of the 4 emails
above → "Force password reset") or:

```bash
curl -X POST https://pfe-maintenaceindustrielle.onrender.com/auth/force-password-reset/<userId> \
  -H "Authorization: Bearer <admin-access-token>"
```

(`<userId>` is each account's Mongo `_id`, not its email — look it up via
the admin Users list first.)

---

## C. Rotate the remaining credentials — status: UNVERIFIED

`GIT_HISTORY_PURGE.md` flags `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`, and
`SMTP_PASS`/`BREVO_API_KEY` for rotation. The last four were never confirmed
present in git history — rotating them is precautionary hygiene, not a
response to a confirmed leak of those specific values. **None of these can
be verified as rotated from inside this tool** — I have no access to Render,
Vercel, MongoDB Atlas, Google Cloud Console, Supabase, or the SMTP/Brevo
dashboards, and the current values in `backend/.env` were never compared
against a "before" snapshot (they were never printed). Only you (or whoever
holds those dashboard credentials) can confirm rotation actually happened.

### YOU RUN THIS — per provider

1. **`JWT_SECRET` / `JWT_REFRESH_SECRET`** (Render → backend service →
   Environment): generate two new values (`openssl rand -base64 32`) and set
   both. Invalidates every outstanding access/refresh token app-wide the
   moment the new instance boots — cheapest, highest-leverage rotation here.
2. **`MONGODB_URI`** (MongoDB Atlas → Database Access): rotate the database
   user's password, update the URI in Render. Do this **after** confirming
   the new backend deploy with new JWT secrets is healthy.
3. **`GOOGLE_CLIENT_SECRET`** (Google Cloud Console → Credentials → the
   OAuth 2.0 Client ID used by this app): reset the client secret, update in
   Render.
4. **`SUPABASE_SECRET_KEY`** (Supabase project → Settings → API): roll the
   service-role key, update in Render.
5. **`SMTP_PASS` / `BREVO_API_KEY`** (Brevo/SMTP dashboard): regenerate,
   update in Render.

After each change, redeploy and check `GET /health` returns `200` before
moving to the next rotation, so issues are attributable to one change at a
time.

---

## D. Verification checklist — none of these are checked yet

- [ ] `git push --force` completed from `GMAO-purge-workspace-final.git`;
      `git log --all --oneline -- backups` against a **fresh** clone of
      `origin/main` returns nothing.
- [ ] Repository visibility reviewed (private, or accepted as public with
      the exposure now closed).
- [ ] This working tree and every other local clone reset to the new
      history (Section A).
- [ ] All 4 active leaked accounts have had sessions invalidated / password
      reset forced (Section B).
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` rotated (confirmed by you).
- [ ] `MONGODB_URI` password rotated (confirmed by you).
- [ ] `GOOGLE_CLIENT_SECRET` rotated (confirmed by you).
- [ ] `SUPABASE_SECRET_KEY` rotated (confirmed by you).
- [ ] `SMTP_PASS` / `BREVO_API_KEY` rotated (confirmed by you).
- [ ] `GET /health` returns `200` after each redeploy.

**The git exposure incident is not resolved until every box above is
checked.** As of this writing, none are.

## E. Done this session (all read-only against production, or local-mirror-only — nothing pushed, no production writes beyond the index repair in the separate MongoDB report)

- Diagnosed and fixed a real contamination bug in the mirror-rebuild process
  (stray non-GitHub refs defeating the filter) before it could have produced
  a false sense of "clean" — see History above.
- Rebuilt the mirror correctly: verified clean, current, and lossless
  (includes the latest commit).
- Recreated a local safety-net copy of the unfiltered original.
- Re-confirmed the 4 currently-active affected accounts (no hashes read into
  any output).
- Attempted direct session invalidation for those 4 accounts; blocked by the
  permission classifier, awaiting your approval.
- Re-confirmed no `.env`/`.env.production` file has ever appeared in git
  history.
