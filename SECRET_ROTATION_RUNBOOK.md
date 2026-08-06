# Secret Rotation & Git History Remediation Runbook

**Status as of 2026-08-06: the exposure is still live.** `origin/main` on GitHub
(`balsemkhouniblossom/IPROTEX-maintenaceIndustrielle`, a **public** repository)
still has commits reachable in its history containing `backups/mongodb/*/GMAO_IPROTEX/users.bson`
— raw MongoDB exports with bcrypt password hashes and refresh-token hashes.
This document supersedes `GIT_HISTORY_PURGE.md`'s "What you still need to do"
section, because the mirror it points to is now stale and unsafe to use (see
below). Everything in this runbook up to the actual push/rotation is done;
the actions marked **YOU RUN THIS** are yours — they need dashboard access or
a `git push` this tool will not perform.

---

## A. Git history purge — use the NEW mirror, not the old one

### Why the original mirror can no longer be used

`GIT_HISTORY_PURGE.md` (2026-08-01) prepared a clean mirror at
`C:\Users\Balsem\Desktop\GMAO-purge-workspace.git`. Verified today: **that
mirror is 20 commits behind `origin/main`.** Its `main` tip is `81f6caf`;
`origin/main`'s tip is `ff74a10`. Running the force-push command exactly as
originally drafted would have **silently destroyed 20 real commits**,
including the auth token in-memory-storage migration, the MongoDB index
manager, CI hardening (Trivy severity settings, e2e caching), and the
machine-timeline/user-management work — none of that was in the old mirror.

### What was done instead

A fresh mirror clone of the current `origin/main` was made and the identical
purge command from `GIT_HISTORY_PURGE.md` was re-run against it:

```bash
# (already done)
git clone --mirror https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git GMAO-purge-workspace-current.git
cd GMAO-purge-workspace-current.git
git filter-repo --path backups --path-glob '*.bson' --invert-paths --force
```

Verified clean and current:
- `git rev-list --objects --all | grep -i backups/` → no output
- `git rev-list --objects --all | grep -i "\.bson"` → no output
- `main` tip: `9885ccea3d6cda1808f815f5f5291366a12098c5`, 109 commits, ending in
  `feat(users): implement user management features with hooks and components`
  — the same commit as current `origin/main`'s tip, confirming no work is lost.
- Repacked size: ~44 MB in-pack (down from a repo that still carries the BSON
  blobs today).

**Location: `C:\Users\Balsem\Desktop\GMAO-purge-workspace-current.git`.**
Treat `C:\Users\Balsem\Desktop\GMAO-purge-workspace.git` (no `-current`
suffix) as obsolete — delete it or ignore it, do not push from it.

### YOU RUN THIS — push the rewritten history

```bash
cd "C:/Users/Balsem/Desktop/GMAO-purge-workspace-current.git"
git remote add origin https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git
git push --force origin refs/heads/main:refs/heads/main
```

If GitHub's branch protection blocks the force-push, temporarily disable "Do
not allow force pushes" for `main` under repo Settings → Branches, push, then
re-enable it. Re-run `git ls-remote --heads --tags origin` first in case a
branch other than `main` now exists on origin that also needs rewriting (none
did as of this check).

Consider also flipping the repository to **private** (Settings → General →
Danger Zone → Change visibility) before or immediately after the push, as an
extra margin — the force-push removes the exposure going forward, but does
not undo the fact the data was fetchable in the meantime.

### YOU RUN THIS — reset every existing local clone afterward

Including `C:\Users\Balsem\Desktop\GMAO` (this working tree) — it still has
the old, unrewritten history and must not be pushed from again:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Run `git status` first and stash/commit anything not yet pushed — this
discards local history, not working-tree changes, but confirm nothing
uncommitted would be lost.

---

## B. Accounts confirmed exposed — force a password reset now

The local (uncommitted, gitignored) backup dumps still on disk under
`backups/mongodb/` were scanned read-only (emails only — no password hashes
or tokens were read into memory beyond the scan, none printed) across all 5
`users.bson` files. **6 unique accounts** appear across the dumps; checked
read-only against the live production database just now, **4 are still
active today**:

| Email | Role | Status in production |
|---|---|---|
| `admin2@gmail.com` | **admin** | active — highest priority |
| `tech1@gmail.com` | technician | active |
| `operateur2@gmail.com` | operator | active |
| `operateur3@gmail.com` | operator | active |
| `superadmin@esprit.tn` | — | not found (already gone) |
| `verify.final.1782045310@example.com` | — | not found (test account, already gone) |

### YOU RUN THIS (or have another admin run it) — force-reset the 4 active accounts

The app already has the exact right mechanism for this —
`POST /auth/force-password-reset/:userId` (admin-only,
`backend/src/auth/auth.controller.ts:272`, delegates to
`AuthService.forcePasswordReset` at `auth.service.ts:1279`). Calling it for a
user: sets `must_reset_password: true`, clears `refresh_token_hash` (revokes
every outstanding session/refresh token immediately), and emails that user a
password-reset link. Use the admin Users page in the app (find each of the 4
emails above → "Force password reset") or call the endpoint directly with an
admin bearer token:

```bash
curl -X POST https://pfe-maintenaceindustrielle.onrender.com/auth/force-password-reset/<userId> \
  -H "Authorization: Bearer <admin-access-token>"
```

(`<userId>` is each account's Mongo `_id`, not its email — look it up via the
admin Users list first.)

---

## C. Rotate the remaining credentials

`GIT_HISTORY_PURGE.md` also flags `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`, and
`SMTP_PASS`/`BREVO_API_KEY` for rotation. The last four were never confirmed
present in git history — rotating them is precautionary hygiene, not a
response to a confirmed leak of those specific values. All six env var names
below already exist in `backend/.env.example`; only the dashboard-side values
need to change.

### YOU RUN THIS — per provider

1. **`JWT_SECRET` / `JWT_REFRESH_SECRET`** (Render → backend service →
   Environment): generate two new values (`openssl rand -base64 32`, or any
   equivalent 32+ byte random generator) and set both. This invalidates every
   outstanding access/refresh token app-wide the moment the new backend
   instance boots — cheapest, highest-leverage rotation on this list.
2. **`MONGODB_URI`** (MongoDB Atlas → Database Access): rotate the database
   user's password, update the URI in Render's environment accordingly. Do
   this **after** confirming the new backend deploy with new JWT secrets is
   healthy, to avoid stacking two simultaneous changes.
3. **`GOOGLE_CLIENT_SECRET`** (Google Cloud Console → APIs & Services →
   Credentials → the OAuth 2.0 Client ID used by this app): reset the client
   secret, update `GOOGLE_CLIENT_SECRET` in Render.
4. **`SUPABASE_SECRET_KEY`** (Supabase project → Settings → API): roll the
   service-role key, update in Render.
5. **`SMTP_PASS` / `BREVO_API_KEY`** (Brevo/SMTP provider dashboard → API
   keys or SMTP credentials): regenerate, update in Render.

After each dashboard change, redeploy the backend service (Render redeploys
automatically on env var save for most plans — confirm) and check
`GET /health` returns `200` before moving to the next rotation, so issues are
attributable to one change at a time.

---

## D. Verification checklist

- [ ] `git push --force` completed; `git log --all --oneline -- backups` on
      `origin/main` (via a fresh clone) returns nothing.
- [ ] Repository visibility reviewed (private, or accepted as public with the
      exposure now closed).
- [ ] This working tree and any other local clone reset to the new history.
- [ ] All 4 active leaked accounts force-password-reset.
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` rotated.
- [ ] `MONGODB_URI` password rotated.
- [ ] `GOOGLE_CLIENT_SECRET` rotated.
- [ ] `SUPABASE_SECRET_KEY` rotated.
- [ ] `SMTP_PASS` / `BREVO_API_KEY` rotated.
- [ ] `GET /health` returns `200` after each redeploy.

## E. Already done (this session, all read-only or local-mirror-only — nothing pushed, nothing in production written)

- Rebuilt the purge mirror against current `origin/main` and verified it's
  clean and lossless.
- Identified the 4 currently-active affected accounts by email/role (no
  hashes read into any output).
- Confirmed no `.env`/`.env.production` file has ever appeared in git history
  (re-confirmed via the same `git log --all -- backups` style check scoped to
  `.env*` — no hits), consistent with `GIT_HISTORY_PURGE.md`'s original
  finding.
