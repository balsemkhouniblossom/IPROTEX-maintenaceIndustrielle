import type { Request } from 'express';
import type { UserDocument } from '../../schemas/user.schema';

export type JwtRequestUser = {
  userId?: string;
  email?: string;
  role?: string;
  user_id?: string;
  is_active?: boolean;
  is_verified?: boolean;
  approval_status?: string;
  profile_completed?: boolean;
  must_reset_password?: boolean;
};

export type AuthenticatedRequest = Request & {
  user?: JwtRequestUser;
  currentUser?: UserDocument;
};
