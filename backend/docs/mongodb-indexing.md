# MongoDB Index Deployment

This project does not create or synchronize indexes during normal production
startup. In production, Mongoose is configured with `autoIndex: false` and
`autoCreate: false`; use the controlled command below or Atlas index creation.

## Dry Run

```bash
MONGODB_URI="mongodb+srv://..." npm run mongodb:indexes
```

The dry run lists recommended indexes as `exists` or `missing`. It recognizes
equivalent existing indexes even when the names differ, and it never drops
unexpected indexes.

## Apply

Run during a low-traffic window:

```bash
MONGODB_URI="mongodb+srv://..." npm run mongodb:indexes:apply
```

The command creates only missing recommended indexes and is safe to rerun. It
does not print credentials and does not call `syncIndexes()`.

## Benchmark

For an isolated, repeatable local check:

```bash
npm run mongodb:indexes:benchmark
```

The benchmark uses `mongodb-memory-server`, seeds synthetic scale data, captures
`explain('executionStats')` before the recommended indexes, creates the
recommended indexes, and captures after plans. It does not require production
data and does not write generated data to the repository.

## Rollback

Do not drop production indexes automatically. If an index causes unacceptable
write load or storage pressure:

1. Pause the affected deployment or background job if needed.
2. In Atlas, inspect operations and confirm the index name.
3. Drop only the specific newly-created index by name.
4. Re-run the dry-run command to verify the remaining index state.
5. Reassess the query plan before replacing it with another index.
