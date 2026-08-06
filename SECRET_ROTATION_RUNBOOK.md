# Secret Rotation & Git History Remediation Runbook

> **This is the single canonical source of truth for the git-exposure
> incident.** `GIT_HISTORY_PURGE.md` and `DEPLOYMENT.md`'s "Environment
> file & secret hygiene" section both point here rather than restate
> status themselves — if either ever seems to say something different
> about whether this is resolved, this document is correct and the other
> is stale. Re-run the checks in Section D yourself before trusting any
> status claim, including this one.

**Status as of 2026-08-06: the exposure is still live and UNRESOLVED.**
`origin/main` on GitHub (`balsemkhouniblossom/IPROTEX-maintenaceIndustrielle`,
a **public** repository) still has commits reachable in its history
containing `backups/mongodb/*/GMAO_IPROTEX/users.bson` — raw MongoDB exports
with bcrypt password hashes and refresh-token hashes. **Verified directly,
right now, not assumed**: `git rev-list --objects origin/main | grep
'\.bson'` against a fresh clone of `origin/main` still lists every one of
those blobs by path and hash (see Section A).

Since this document was first written, `origin/main` has moved forward
(ordinary, non-force pushes — new work landing normally) from tip `ff74a10`
to tip `670d26b`. **This does not touch the incident either way**: a normal
push only adds commits, it never removes anything already reachable in
history, so all the old exposed commits are still exactly as reachable
today as they were before. Do not mistake "origin/main has new commits
since the last status check" for "the exposure was addressed" — it wasn't;
they're unrelated facts that happen to both be true right now.

This document supersedes `GIT_HISTORY_PURGE.md`'s "What you still need to
do" section — that doc's prepared mirror is stale (see History below).
Everything up to the actual push, session invalidation, and external
credential rotation is prepared and verified; the actions marked
**YOU RUN THIS** require dashboard access or a `git push` this tool will not
perform, and are not yet done. **Do not treat this incident as closed until
every checkbox in section D is checked and independently confirmed.**

## Owner-only actions required (nothing below can be done from this tool)

1. **Push the rewritten history** — Section A, "YOU RUN THIS — push the
   rewritten history". Requires `git push --force` from
   `GMAO-purge-workspace-final-v2.git`, a destructive operation this tool
   will not perform under any circumstances.
2. **Reset every existing local clone** to the new history afterward —
   Section A, second "YOU RUN THIS". Every collaborator, not just this
   machine.
3. **Decide repository visibility** (keep public now that history is clean,
   or flip to private) — Section A.
4. **Force-reset the 4 active leaked accounts** — Section B. Either approve
   the direct DB write this tool already attempted and was blocked from, or
   run the admin-panel action yourself.
5. **Rotate `JWT_SECRET` / `JWT_REFRESH_SECRET` / `MONGODB_URI` /
   `GOOGLE_CLIENT_SECRET` / `SUPABASE_SECRET_KEY` / `SMTP_PASS` /
   `BREVO_API_KEY`** — Section C. All require dashboard access (Render,
   MongoDB Atlas, Google Cloud Console, Supabase, Brevo/SMTP) this tool has
   none of.
6. **Independently confirm every box in Section D** after doing the above —
   this tool cannot verify any of them from inside this environment.

---

## A. Git history purge — current, verified-clean mirror

### History of this mirror (why it changed three times)

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
3. `GMAO-purge-workspace-final.git` (built from `origin` + the single
   `087d37e` commit, filtered, verified clean) was the mirror this document
   pointed to for several days. By the final release-closure pass
   (2026-08-06, later the same day) it was **9 commits behind** current
   `origin/main` — nine more commits (Phases C through G of the
   enterprise-hardening work, `a7b69b2`..`670d26b`) had landed on
   `origin/main` in the meantime via ordinary pushes. Pushing that mirror
   would have silently discarded all nine. Discarded, rebuilt a third time.
4. **Current, verified-clean mirror** (built this pass): cloned fresh from
   `origin` (GitHub only, `git clone --mirror`), confirmed its tip matched
   current `origin/main` exactly (`670d26bfea71dae9ad47d7f0284b475c88fbbb12`,
   120 commits) before filtering, *then* filtered with the same command as
   every prior attempt (`git filter-repo --path backups --path-glob
   '*.bson' --invert-paths --force`). Verified:
   - Only one ref present: `refs/heads/main` (no stray refs — a fresh clone
     from GitHub never picks up local-only refs like `refs/codex/*` in the
     first place).
   - `git rev-list --objects --all | grep -i backups/` → 0 hits.
   - `git rev-list --objects --all | grep -i "\.bson"` → 0 hits.
   - `git log --all --oneline -- backups` → 0 hits.
   - `git fsck --full` → clean, no errors.
   - `main` tip: `ffaef7555fc906fcfbd610ad39ed989054bf4ca6`, 119 commits
     (filter-repo drops the one commit whose only change was under
     `backups/`, same as every prior filter run — expected, not data loss),
     ending in `a11y: associate form labels with their controls via
     htmlFor/id` — the actual latest commit on `main` as of this pass.
   - **File-tree parity, not just a tip-message match**: `git archive
     <mirror-tip> | tar -t` (files only) diffed against `git ls-tree -r
     --name-only HEAD` from the live working tree — **zero differences,
     964 files on both sides**. The mirror's tip is byte-identical in
     content to current `main`, minus only the removed `backups/*.bson`
     files.

**Location: `C:\Users\Balsem\Desktop\GMAO-purge-workspace-final-v2.git`.**
This is the only mirror that should be pushed from. All three prior
mirrors (`GMAO-purge-workspace.git`, `GMAO-purge-workspace-current.git`,
`GMAO-purge-workspace-final.git`) have been deleted from disk (stale,
superseded) — if any reappears from a backup, do not use it; rebuild
following the process below instead, since `origin/main` may well have
moved again since this document was last updated.

**Lesson for future history rewrites on this machine (updated after two
separate staleness incidents, not just the original refs/codex/ one)**:

1. Always build the mirror from a fresh `git clone <github-url> --mirror`,
   never from `git clone --mirror <local-working-tree>`.
2. Always run `git for-each-ref` on the fresh mirror before filtering, to
   confirm it has exactly one `refs/heads/main` and nothing under
   `refs/codex/*` or similar.
3. **Always confirm the mirror's pre-filter tip matches current
   `origin/main`'s tip** (`git ls-remote origin main` vs. the mirror's
   `refs/heads/main`) immediately before filtering — a "verified clean"
   mirror from even a few hours ago can already be behind `origin/main` if
   any ordinary push has landed since, and pushing a stale filtered mirror
   silently discards every commit that landed after it was built.
4. After filtering, verify file-tree parity against the live working tree
   (`git archive <tip> | tar -t`, files only, diffed against `git ls-tree
   -r --name-only HEAD`) — a tip commit *message* matching isn't proof the
   *content* matches; the file list must match too.

### Safety net

**`C:\Users\Balsem\Desktop\GMAO-backup-before-purge-3.git`** — fresh,
unfiltered mirror clone of current `origin/main`, confirmed 19 `.bson`
blobs present (the exposure, as it currently exists on GitHub), tip
`670d26bfea71dae9ad47d7f0284b475c88fbbb12`. Untouched — do not filter or
push from this one, it exists only as a restore point in case the push
below goes wrong. (Two earlier safety-net copies —
`GMAO-backup-before-purge.git` and `GMAO-backup-before-purge-2.git` — are
stale relative to current `origin/main` and should not be relied on;
`GMAO-backup-before-purge-2.git` is left on disk only because deleting it
isn't necessary for correctness, `GMAO-backup-before-purge.git` no longer
exists.)

### YOU RUN THIS — push the rewritten history

```bash
cd "C:/Users/Balsem/Desktop/GMAO-purge-workspace-final-v2.git"
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

- [ ] `git push --force` completed from `GMAO-purge-workspace-final-v2.git`
      (rebuild it first if `origin/main` has moved since — see "Lesson for
      future history rewrites" in Section A); `git log --all --oneline --
      backups` (against a **fresh** clone of `origin/main`) returns nothing.
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

## E. Done across sessions (all read-only against production or GitHub, or local-mirror-only — nothing pushed, no production writes beyond the index repair in the separate MongoDB report)

**Earlier session:**

- Diagnosed and fixed a real contamination bug in the mirror-rebuild process
  (stray non-GitHub refs defeating the filter) before it could have produced
  a false sense of "clean" — see History above.
- Rebuilt the mirror correctly: verified clean, current, and lossless
  (includes the latest commit at that time).
- Recreated a local safety-net copy of the unfiltered original.
- Re-confirmed the 4 currently-active affected accounts (no hashes read into
  any output).
- Attempted direct session invalidation for those 4 accounts; blocked by the
  permission classifier, awaiting your approval.
- Re-confirmed no `.env`/`.env.production` file has ever appeared in git
  history.

**This session (final release-closure pass):**

- Discovered the mirror built in the earlier session had gone stale again —
  9 ordinary (non-force) pushes to `origin/main` had landed since it was
  built, none of them related to the incident. Rebuilt the mirror a third
  time from a fresh GitHub clone, this time also verifying full file-tree
  parity against the live working tree (not just a matching tip commit
  message) and running `git fsck --full` — see History above.
- Directly confirmed, right now, that `origin/main` still has every
  `users.bson` blob reachable (`git rev-list --objects origin/main | grep
  '\.bson'` against a fresh clone) — the exposure was re-verified rather
  than assumed still present from an earlier check.
- Rebuilt the safety-net mirror to match current `origin/main` (the old one
  was itself stale by the same 9 commits); the first clone attempt failed
  from network flakiness mid-transfer and was caught by direct verification
  (file count, object count) rather than trusted from the tool's own "done"
  signal — retried and confirmed clean on the second attempt.
- Reconciled this document, `GIT_HISTORY_PURGE.md`, and `DEPLOYMENT.md` into
  one consistent status: this document is now the single canonical source,
  the other two point here instead of restating (and previously
  contradicting) the incident's status.
