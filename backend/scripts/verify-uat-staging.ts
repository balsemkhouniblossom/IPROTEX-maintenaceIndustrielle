/* eslint-disable no-console */
import '../src/load-env';
import mongoose from 'mongoose';
import { assertSafeUatDatabase } from '../src/config/uat-staging-safety';

async function main(): Promise<void> {
  const database = assertSafeUatDatabase(process.env);
  await mongoose.connect(process.env.MONGODB_URI!, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    const indexes = await mongoose.connection
      .collection('workorders')
      .indexes();
    const occurrenceIndex = indexes.find(
      (index) => index.name === 'work_orders_preventive_occurrence_key_unique',
    );
    if (!occurrenceIndex?.unique || !occurrenceIndex.partialFilterExpression) {
      throw new Error(
        'Required unique partial preventive occurrence index is missing or incorrect',
      );
    }
    const duplicateOccurrences = await mongoose.connection
      .collection('workorders')
      .aggregate([
        { $match: { preventive_occurrence_key: { $type: 'string' } } },
        { $group: { _id: '$preventive_occurrence_key', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
      ])
      .toArray();
    if (duplicateOccurrences.length)
      throw new Error('Duplicate preventive occurrence keys exist');

    const locks = await mongoose.connection
      .collection('automationjoblocks')
      .indexes();
    if (!locks.some((index) => index.unique && index.key?.name === 1)) {
      throw new Error('Scheduler lock unique-name index is missing');
    }
    if (!locks.some((index) => index.expireAfterSeconds === 0)) {
      throw new Error('Scheduler lock TTL index is missing');
    }

    const plan = await mongoose.connection
      .collection('maintenanceplans')
      .findOne({ plan_id: 'UAT-PLAN-6M-001' });
    if (!plan) throw new Error('Synthetic six-month UAT plan is missing');
    const count = await mongoose.connection
      .collection('workorders')
      .countDocuments({ plan_id: plan._id });
    if (count !== 1)
      throw new Error(`Expected one initial UAT occurrence; found ${count}`);
    console.log(
      `Read-only UAT database/index verification passed for ${database}.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'UAT staging verification failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
