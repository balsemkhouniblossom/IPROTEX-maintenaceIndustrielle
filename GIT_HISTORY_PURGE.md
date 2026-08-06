# Git History Purge — 2026-08-01

> **STALE — superseded by [`SECRET_ROTATION_RUNBOOK.md`](SECRET_ROTATION_RUNBOOK.md).**
> This document is kept as a historical record of the first purge attempt
> only. The mirror it references below (`GMAO-purge-workspace.git`) no
> longer exists and was superseded twice over — see
> `SECRET_ROTATION_RUNBOOK.md` Section A, "History of this mirror (why it
> changed twice)". **Do not push from the mirror path named in this
> document.** For current status, the actual mirror to push from, and
> everything still outstanding, see `SECRET_ROTATION_RUNBOOK.md` — as of
> 2026-08-06 the incident it describes is still unresolved.

**Status as of this writing (2026-08-01, now historical): history had been rewritten and verified locally in the mirror described below. It was NOT pushed to GitHub — see the superseding runbook for what happened after this document was written.**

## What happened

`backups/mongodb/*/GMAO_IPROTEX/users.bson` — raw MongoDB exports of the
`users` collection, including real bcrypt password hashes and refresh-token
hashes — was tracked in Git and reachable from `origin/main` on GitHub. The
whole `backups/` directory (241 files: those BSON/JSON dumps, plus code and
filesystem `.zip` snapshots) was committed at various points across the
project's history.

No `.env`/`.env.production` file itself was ever found in Git history (that
was checked separately and confirmed clean — see the environment-secrets
audit). This purge is specifically about `backups/`.

## What was done

1. Created a local safety branch in the working repo: `pre-history-purge-backup-20260801` (points at the pre-purge tip, `7f04704`).
2. Created two full mirror clones outside the working tree:
   - `../GMAO-backup-before-purge.git` — **untouched**, full copy of every ref exactly as it was. This is the real safety net; nothing about it should ever be modified.
   - `../GMAO-purge-workspace.git` — the copy the rewrite actually ran against.
3. Ran, inside `GMAO-purge-workspace.git`:
   ```bash
   git filter-repo --path backups --path-glob '*.bson' --invert-paths --force
   ```
4. Found and removed three leftover non-branch/non-tag refs under `refs/codex/...` (checkpoint bookkeeping left by an unrelated tool, never pushed to GitHub) that were pinning one old tree snapshot still containing `backups/`. Removed them, then:
   ```bash
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

## Verification (rerun these yourself any time — none of them print secret content, only path/object names and counts)

From inside `GMAO-purge-workspace.git`:

```bash
# 1. No commit, on any ref, touches backups/ anymore
git log --all --oneline -- backups
# expected: no output

# 2. No object anywhere is a .bson file
git rev-list --objects --all | grep -i "\.bson"
# expected: no output

# 3. No object anywhere lives under a backups/ path
git rev-list --objects --all | grep -i "backups/"
# expected: no output

# 4. Repack size — should be dramatically smaller than the original ~106 MB .git
git count-objects -v
```

**Result at the time of this purge:** all three content checks came back
empty (clean). Packed size dropped from the original repo's ~106 MB to
~32 MB. `main` went from 91 to 90 commits (filter-repo automatically drops
a commit that becomes empty once its only change — something under
`backups/` — is removed; this is expected, not data loss).

## What you still need to do

This tool will not force-push to `main`/`master` under any circumstances,
even when explicitly asked — it's a hard rule, because a force-push to a
branch others may have already pulled is not something that can be
un-done once someone else fetches it. Everything up to a clean, verified,
ready-to-push mirror is done. The push itself is yours to run:

```bash
cd "C:/Users/Balsem/Desktop/GMAO-purge-workspace.git"
git remote add origin https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git
git push --force origin refs/heads/main:refs/heads/main
```

(Only `main` exists on `origin` today — confirmed via `git ls-remote --heads --tags origin` before the purge; there are no other remote branches or tags to push. If that's changed since, run `git ls-remote --heads --tags origin` again first and push each ref you actually want rewritten.)

If GitHub's branch protection blocks the force-push, you'll need to
temporarily disable "Do not allow force pushes" for `main` in the repo's
branch protection settings, push, then re-enable it.

## After the push — re-clone steps for every collaborator (including you, on this machine)

Once the rewritten history is on GitHub, **every existing local clone —
including the one at `C:\Users\Balsem\Desktop\GMAO` used for this
session — has the old, unrewritten history and must not be pushed from
again**, or the purged commits come right back. Two options:

**Recommended — fresh clone:**
```bash
git clone https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git GMAO-fresh
```
Then copy over anything not yet committed from the old working tree
(check `git status` there first) before switching to the fresh clone.

**Alternative — reset the existing clone to the new history** (only if you
are certain there is no work in the old clone worth keeping beyond what's
already committed):
```bash
git fetch origin
git checkout main
git reset --hard origin/main
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Any collaborator who *doesn't* do one of these two things and instead
merges/pulls normally will silently resurrect the old history the next
time they push.

## Credentials that must be rotated regardless of when the push happens

The purge removes the files going forward; it does not undo the fact that
this data was already fetchable from GitHub. Treat as compromised:

- **Passwords for every account represented in the removed `users.bson`
  files** (`backups/mongodb/atlas_migration_20260623_115539/`,
  `full_migration_20262306_130521/`, `verification_atlas_20260623_120912/`,
  `verification_atlas_20260623_120912_after_cleanup/`,
  `verification_local_20260623_120912/` — force a password reset for each;
  resetting also invalidates that account's refresh token per the existing
  reset-password flow).
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — recommended, invalidates all
  outstanding sessions cheaply.
- `MONGODB_URI` (the Atlas database user's password).
- `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`, `SMTP_PASS` / `BREVO_API_KEY`.

The last four were never found in Git history itself (verified separately)
— rotating them is precautionary hygiene, not a response to a confirmed
leak of those specific values.

## Defense in depth added alongside the purge

- `.gitignore` (root): `/backups` — the directory can never be re-added.
- `backups/scripts/exclude_list.txt`: now documents `.env*`, `*.pem`,
  `*.key`, `*credentials*.json`, `*service-account*`, `*.bson` as
  never-bundle patterns.
- `backups/scripts/backup-code.bat`: `robocopy` now excludes `.env`/`.env.*`
  from the code-backup zip (it previously copied the entire source tree
  with no dotfile exclusion at all).
- `backups/scripts/backup-files.bat`: no longer copies `backend/.env` /
  `frontend/.env.local` into the filesystem-backup zip — it used to do
  this deliberately.
