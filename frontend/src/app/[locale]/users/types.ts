import {
  ApprovalRole,
  ApprovalUser,
  ApprovalView,
} from '@/services/userApprovals';
import { PhoneInputValue } from '@/services/phoneNumber';

export type User = Omit<ApprovalUser, 'role'> & {
  _id?: string;
  role: string;
  last_login?: string;
  login_history?: string[];
};

export type NotificationState = {
  type: 'success' | 'error';
  message: string;
} | null;

export type ActionTarget =
  | { type: 'approve'; user: User }
  | { type: 'reject'; user: User }
  | null;

export type UserFormData = {
  nom_complet: string;
  email: string;
  password: string;
  role: string;
  department: string;
  phone: PhoneInputValue;
  photo: string;
  is_active: boolean;
};

export type UserRef = {
  id?: string;
  _id?: string;
  email?: string;
  created_at?: string;
};

export const VIEWS: ApprovalView[] = ['pending', 'approved', 'rejected', 'all'];
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const MAX_REJECTION_REASON_LENGTH = 500;
