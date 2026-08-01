/* eslint-disable no-console */
import '../src/load-env';
import mongoose from 'mongoose';

const USER_COLLECTION = 'users';

/**
 * Incident-response tool: revokes every currently-issued access and
 * refresh token for every user, in one pass, without touching any
 * password. Sets `credentials_invalidated_at` to now (JwtStrategy and
 * AuthService.refreshToken both reject any token whose `iat` predates this
 * value, even one still inside its normal expiry window) and clears every
 * stored `refresh_token_hash` (belt-and-suspenders — refresh would already
 * fail the iat check on its own).
 *
 * This does NOT set `must_reset_password` — that is a separate, narrower
 * action for specifically-identified accounts, via
 * `POST /auth/force-password-reset/:userId` (admin-only). Running this
 * script just means "everyone has to log in again"; it does not force
 * anyone to choose a new password.
 *
 * Dry-run by default. Pass --apply to actually write.
 */

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
  };
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri?.trim()) {
    throw new Error('Missing MONGODB_URI or MONGO_URI');
  }

  return uri;
}

function sanitizeMongoUri(uri: string): string {
  return uri.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const uri = getMongoUri();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  const dbName = mongoose.connection.name;
  const users = mongoose.connection.collection(USER_COLLECTION);

  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`MongoDB URI: ${sanitizeMongoUri(uri)}`);
  console.log(`Database: ${dbName}`);
  console.log(`Collection: ${USER_COLLECTION}`);

  const totalUsers = await users.countDocuments();
  const withActiveRefreshHash = await users.countDocuments({
    refresh_token_hash: { $exists: true, $ne: null },
  });

  console.log('Before:', {
    totalUsers,
    usersWithAnActiveRefreshTokenHash: withActiveRefreshHash,
  });

  if (apply) {
    const now = new Date();
    const result = await users.updateMany(
      {},
      {
        $set: { credentials_invalidated_at: now },
        $unset: { refresh_token_hash: '' },
      },
    );
    console.log('Updated:', {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      invalidatedAt: now.toISOString(),
    });
  } else {
    console.log(
      `No updates were written. Would set credentials_invalidated_at on ${totalUsers} user(s) and clear ${withActiveRefreshHash} refresh-token hash(es). Re-run with --apply to do it.`,
    );
  }

  const afterWithActiveRefreshHash = await users.countDocuments({
    refresh_token_hash: { $exists: true, $ne: null },
  });

  console.log('After:', {
    usersWithAnActiveRefreshTokenHash: afterWithActiveRefreshHash,
  });
}

main()
  .catch((error: Error) => {
    console.error('Session invalidation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.connection.close();
  });
