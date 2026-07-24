export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalRole = 'operator' | 'technician';
export type EmailVerificationFilter = 'verified' | 'unverified' | 'all';
export type SortOrder = 'asc' | 'desc';

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

export function buildPendingApprovalsParams(params: PendingApprovalsParams) {
  return {
    page: params.page,
    limit: params.limit,
    search: params.search?.trim() || undefined,
    role: params.role && params.role !== 'all' ? params.role : undefined,
    emailVerified: params.emailVerified,
    sortOrder: params.sortOrder,
  };
}

export function buildUsersListParams(params: UsersListParams) {
  return {
    page: params.page,
    limit: params.limit,
    search: params.search?.trim() || undefined,
    approvalStatus: params.approvalStatus,
  };
}

export function buildRejectAccountPayload(reason: string) {
  return {
    reason: reason.trim(),
  };
}

export function getApprovalErrorCode(error: unknown): string | null {
  const data = (
    error as { response?: { data?: { code?: unknown; message?: unknown } } }
  )?.response?.data;

  if (typeof data?.code === 'string') {
    return data.code;
  }

  if (
    data?.message &&
    typeof data.message === 'object' &&
    'code' in data.message &&
    typeof (data.message as { code?: unknown }).code === 'string'
  ) {
    return (data.message as { code: string }).code;
  }

  return null;
}
