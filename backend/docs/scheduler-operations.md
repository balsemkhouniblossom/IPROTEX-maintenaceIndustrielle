# Scheduler Operations

Scheduled jobs are designed to be safe on more than one backend instance. The
`AUTOMATION_SCHEDULER_ENABLED` flag can disable cron triggers on selected Render
instances, but correctness does not rely on that flag alone: singleton jobs use
an expiring MongoDB lease in `automationjoblocks`.

## Settings

Recommended production defaults:

- `AUTOMATION_SCHEDULER_ENABLED=true`
- `AUTOMATION_BATCH_SIZE=250`
- `AUTOMATION_CONCURRENCY=4`
- `AUTOMATION_EXTERNAL_CONCURRENCY=2`
- `AUTOMATION_MAX_ITEMS_PER_RUN=5000`
- `AUTOMATION_JOB_TIMEOUT_MS=600000`
- `AUTOMATION_LOCK_HEARTBEAT_MS=60000`
- `AUTOMATION_LOCK_TTL_MS=900000`

The lock TTL must exceed the job timeout plus heartbeat interval. Startup fails
for malformed, zero, negative, or unsafe scheduler values.

## Multi-Instance Behavior

Every singleton scheduler run writes a unique run ID and instance owner to
MongoDB through an atomic `findOneAndUpdate` upsert. A second instance skips the
same job while the lease is active. If an instance crashes, another instance may
acquire the job after `expires_at`.

Long-running jobs heartbeat the lease between batches. Release is conditional on
both owner ID and run ID, so an old run cannot delete a newer run's lock.

## Job Bounds

Growing scheduler workloads use deterministic `_id` or time-ordered batches,
bounded by `AUTOMATION_BATCH_SIZE`, `AUTOMATION_MAX_ITEMS_PER_RUN`, and
`AUTOMATION_JOB_TIMEOUT_MS`. Side-effect operations use
`AUTOMATION_EXTERNAL_CONCURRENCY`; local database transformations use
`AUTOMATION_CONCURRENCY`.

## Rollout

1. Deploy code with scheduler defaults.
2. Run `npm run scheduler:benchmark` in a non-production environment.
3. On Render, keep schedulers enabled on all instances if desired; Mongo locks
   prevent duplicate singleton execution. For reduced noise, set
   `AUTOMATION_SCHEDULER_ENABLED=false` on non-primary instances.
4. Watch structured scheduler logs for repeated `failed`, `partial`, or
   `timed_out` status.

## Rollback

Revert the scheduler code and redeploy. Existing lock documents expire
automatically via `expires_at`; no destructive cleanup is normally required. If
an emergency manual cleanup is needed, delete only documents in
`automationjoblocks` after confirming no old code still depends on them.
