import api, { apiService } from './api.ts';
import {
  buildPendingApprovalsParams,
  buildRejectAccountPayload,
  buildUsersListParams,
} from './userApprovalLogic';
export { getApprovalErrorCode } from './userApprovalLogic';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalRole = 'operator' | 'technician';
export type ApprovalView = 'pending' | 'approved' | 'rejected' | 'all';
export type EmailVerificationFilter = 'verified' | 'unverified' | 'all';
export type SortOrder = 'asc' | 'desc';

export interface ApprovalUser {
  id: string;
  nom_complet: string;
  email: string;
  phone?: string;
  department?: string;
  photo?: string;
  role: ApprovalRole;
  is_verified: boolean;
  is_active: boolean;
  approval_status?: ApprovalStatus;
  created_at: string;
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
}

export interface PendingApprovalsParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: ApprovalRole | 'all';
  emailVerified?: EmailVerificationFilter;
  sortOrder?: SortOrder;
}

export interface UsersListParams {
  page?: number;
  limit?: number;
  search?: string;
  approvalStatus?: ApprovalStatus;
}

export interface PaginatedApprovalUsers {
  items: ApprovalUser[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  code?: string;
}

export interface PendingApprovalCount {
  code?: string;
  count: number;
  verified?: number;
  unverified?: number;
}

export {
  buildPendingApprovalsParams,
  buildRejectAccountPayload,
  buildUsersListParams,
};

function readPaginatedUsers(data: unknown): PaginatedApprovalUsers {
  const payload = data as Partial<PaginatedApprovalUsers>;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    page: Number(payload.page) || 1,
    limit: Number(payload.limit) || 20,
    totalItems: Number(payload.totalItems) || 0,
    totalPages: Number(payload.totalPages) || 1,
    code: payload.code,
  };
}

export async function getPendingApprovals(
  params: PendingApprovalsParams = {},
): Promise<PaginatedApprovalUsers> {
  const response = await api.get('/users/pending-approvals', {
    params: buildPendingApprovalsParams(params),
  });
  return readPaginatedUsers(response.data);
}

export async function getPendingApprovalCount(): Promise<PendingApprovalCount> {
  const response = await api.get('/users/pending-approvals/count');
  const data = response.data as PendingApprovalCount;
  return {
    count: Number(data.count) || 0,
    verified: Number(data.verified) || 0,
    unverified: Number(data.unverified) || 0,
    code: data.code,
  };
}

export async function approveUserAccount(userId: string) {
  return api.patch(`/users/${encodeURIComponent(userId)}/approve`);
}

export async function rejectUserAccount(userId: string, reason: string) {
  return api.patch(
    `/users/${encodeURIComponent(userId)}/reject`,
    buildRejectAccountPayload(reason),
  );
}

export async function getApprovalAwareUsers(
  params: UsersListParams = {},
): Promise<PaginatedApprovalUsers> {
  const response = await apiService.getUsers(buildUsersListParams(params));
  return readPaginatedUsers(response.data);
}
