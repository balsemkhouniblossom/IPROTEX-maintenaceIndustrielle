/**
 * The one field set every `.populate('technician_id' | 'actor_user_id' | ...)`
 * (or any other ref into `User`) across the backend is allowed to request.
 * Never widen this without checking `user.schema.ts`'s sensitive-field list
 * first — `password`, `refresh_token_hash`, `reset_password_token`,
 * `reset_password_expires`, `google_id`, and `google_auth_history` must
 * never appear here. The schema-level `toJSON`/`toObject` transform on
 * `UserSchema` strips those same fields as a backstop even if a caller ever
 * forgets this constant, but every live query in the codebase should still
 * request only what it needs at the query level — cheaper, and it's the
 * layer that actually protects `.lean()` reads, which bypass that backstop.
 */
export const SAFE_USER_PROJECTION = 'nom_complet user_id role';
