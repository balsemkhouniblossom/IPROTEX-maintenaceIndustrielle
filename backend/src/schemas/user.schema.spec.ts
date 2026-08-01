import mongoose from 'mongoose';
import { Role, UserSchema } from './user.schema';

const MODEL_NAME = 'UserSchemaSanitizationSpec';
const UserModel =
  (mongoose.models[MODEL_NAME] as mongoose.Model<mongoose.Document>) ||
  mongoose.model(MODEL_NAME, UserSchema);

function buildUserDoc() {
  return new UserModel({
    user_id: 'U-1',
    nom_complet: 'Jane Doe',
    email: 'jane@example.com',
    password: '$2b$10$hashedpasswordvalue',
    refresh_token_hash: 'hashed-refresh-token-value',
    reset_password_token: 'hashed-reset-token-value',
    reset_password_expires: new Date('2026-01-01T00:00:00.000Z'),
    google_id: 'google-subject-123',
    google_auth_history: [
      { action: 'linked', google_id: 'google-subject-123', at: new Date() },
    ],
    role: Role.TECHNICIAN,
  });
}

describe('User schema — toJSON/toObject sanitization backstop', () => {
  it('strips every sensitive field from toJSON() while keeping safe fields', () => {
    const json = buildUserDoc().toJSON() as Record<string, unknown>;

    expect(json.password).toBeUndefined();
    expect(json.refresh_token_hash).toBeUndefined();
    expect(json.reset_password_token).toBeUndefined();
    expect(json.reset_password_expires).toBeUndefined();
    expect(json.google_id).toBeUndefined();
    expect(json.google_auth_history).toBeUndefined();

    expect(json.nom_complet).toBe('Jane Doe');
    expect(json.email).toBe('jane@example.com');
    expect(json.role).toBe(Role.TECHNICIAN);
    expect(json.user_id).toBe('U-1');
  });

  it('strips every sensitive field from toObject() as well', () => {
    const obj = buildUserDoc().toObject() as unknown as Record<string, unknown>;

    expect(obj.password).toBeUndefined();
    expect(obj.refresh_token_hash).toBeUndefined();
    expect(obj.reset_password_token).toBeUndefined();
    expect(obj.reset_password_expires).toBeUndefined();
    expect(obj.google_id).toBeUndefined();
    expect(obj.google_auth_history).toBeUndefined();
    expect(obj.nom_complet).toBe('Jane Doe');
  });

  it('strips sensitive fields under a real JSON.stringify — the actual HTTP response path', () => {
    const serialized = JSON.parse(JSON.stringify(buildUserDoc())) as Record<
      string,
      unknown
    >;

    expect(serialized.password).toBeUndefined();
    expect(serialized.refresh_token_hash).toBeUndefined();
    expect(serialized.reset_password_token).toBeUndefined();
    expect(serialized.google_id).toBeUndefined();
    expect(serialized.nom_complet).toBe('Jane Doe');
  });

  it('still strips sensitive fields when the User document is embedded as a populated field on another object — the real .populate() leak path', () => {
    // Mirrors what Mongoose does internally when a ref path (e.g.
    // WorkOrder.technician_id) has been populated: the populated User
    // document is a plain property of the parent, and JSON.stringify
    // invokes each nested value's own toJSON() while walking the tree.
    const parentLikeResponse = {
      id: 'wo-1',
      technician_id: buildUserDoc(),
    };

    const serialized = JSON.parse(JSON.stringify(parentLikeResponse)) as {
      technician_id: Record<string, unknown>;
    };

    expect(serialized.technician_id.password).toBeUndefined();
    expect(serialized.technician_id.refresh_token_hash).toBeUndefined();
    expect(serialized.technician_id.google_id).toBeUndefined();
    expect(serialized.technician_id.nom_complet).toBe('Jane Doe');
  });
});
