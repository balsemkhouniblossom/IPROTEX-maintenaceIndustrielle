/* eslint-disable no-console */
import '../src/load-env';
import mongoose from 'mongoose';
import { ApprovalStatus } from '../src/schemas/user.schema';

const USER_COLLECTION = 'users';

export function buildLegacyApprovedFilter() {
  return {
    approval_status: { $exists: false },
    $or: [
      { is_active: true, is_verified: true },
      { role: 'admin', is_active: true },
    ],
  };
}

export function buildApprovalStatusUpdate() {
  return {
    $set: {
      approval_status: ApprovalStatus.APPROVED,
    },
  };
}

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes('--dry-run'),
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
  const { dryRun } = parseArgs(process.argv.slice(2));
  const uri = getMongoUri();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  const dbName = mongoose.connection.name;
  const users = mongoose.connection.collection(USER_COLLECTION);
  const filter = buildLegacyApprovedFilter();
  const update = buildApprovalStatusUpdate();

  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`MongoDB URI: ${sanitizeMongoUri(uri)}`);
  console.log(`Database: ${dbName}`);
  console.log(`Collection: ${USER_COLLECTION}`);

  const totalUsers = await users.countDocuments();
  const missingStatus = await users.countDocuments({
    approval_status: { $exists: false },
  });
  const eligibleForApproval = await users.countDocuments(filter);

  console.log('Before:', {
    totalUsers,
    missingApprovalStatus: missingStatus,
    eligibleForApproval,
  });

  if (!dryRun) {
    const result = await users.updateMany(filter, update);
    console.log('Updated:', {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } else {
    console.log('No updates were written. Re-run without --dry-run to migrate.');
  }

  const afterMissingStatus = await users.countDocuments({
    approval_status: { $exists: false },
  });
  const afterApproved = await users.countDocuments({
    approval_status: ApprovalStatus.APPROVED,
  });

  console.log('After:', {
    missingApprovalStatus: afterMissingStatus,
    approvedUsers: afterApproved,
  });
}

main()
  .catch((error: Error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.connection.close();
  });
