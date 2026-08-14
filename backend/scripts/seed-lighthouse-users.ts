/* eslint-disable no-console */
import '../src/load-env';
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

const USER_COLLECTION = 'users';

// Fixed, well-known credentials for authenticated Lighthouse runs only.
// These accounts are approved/active/verified directly (bypassing the
// public registration + admin-approval flow, which cannot itself produce
// a usable admin) so the Lighthouse script can log in through the real
// login form exactly like a real user.
export const LIGHTHOUSE_TEST_USERS = [
  {
    role: 'admin',
    email: 'lighthouse-admin@gmao.local',
    password: 'LighthouseTest123!',
    nom_complet: 'Lighthouse Admin',
  },
  {
    role: 'technician',
    email: 'lighthouse-technician@gmao.local',
    password: 'LighthouseTest123!',
    nom_complet: 'Lighthouse Technician',
  },
  {
    role: 'operator',
    email: 'lighthouse-operator@gmao.local',
    password: 'LighthouseTest123!',
    nom_complet: 'Lighthouse Operator',
  },
] as const;

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

async function nextUserId(
  users: mongoose.mongo.Collection,
): Promise<string> {
  const lastUser = await users.findOne(
    {},
    { sort: { created_at: -1 }, projection: { user_id: 1 } },
  );
  let nextId = 1;
  const match = /USER-(\d+)/.exec(String(lastUser?.user_id ?? ''));
  if (match) {
    nextId = Number.parseInt(match[1], 10) + 1;
  }
  return `USER-${nextId.toString().padStart(3, '0')}`;
}

async function main() {
  const uri = getMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  const dbName = mongoose.connection.name;
  const users = mongoose.connection.collection(USER_COLLECTION);

  console.log(`MongoDB URI: ${sanitizeMongoUri(uri)}`);
  console.log(`Database: ${dbName}`);

  for (const seed of LIGHTHOUSE_TEST_USERS) {
    const hashedPassword = await bcrypt.hash(seed.password, 10);
    const existing = await users.findOne({ email: seed.email });

    // Everything validateAccountAccess() requires for a real login to
    // succeed: verified, approved, active, and a known role.
    const fields = {
      nom_complet: seed.nom_complet,
      email: seed.email,
      password: hashedPassword,
      role: seed.role,
      is_active: true,
      is_verified: true,
      approval_status: 'approved',
      profile_completed: true,
    };

    if (existing) {
      await users.updateOne({ _id: existing._id }, { $set: fields });
      console.log(`Updated existing seed user: ${seed.email} (${seed.role})`);
    } else {
      const user_id = await nextUserId(users);
      await users.insertOne({
        user_id,
        ...fields,
        created_at: new Date(),
        login_history: [],
        google_auth_history: [],
        assigned_machine_ids: [],
      });
      console.log(`Created seed user: ${seed.email} (${seed.role}, ${user_id})`);
    }
  }

  console.log('Done. Lighthouse test users are ready to log in with:');
  for (const seed of LIGHTHOUSE_TEST_USERS) {
    console.log(`  ${seed.role.padEnd(10)} ${seed.email}  /  ${seed.password}`);
  }
}

main()
  .catch((error: Error) => {
    console.error('Seeding Lighthouse test users failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.connection.close();
  });
