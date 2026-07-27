'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  CameraIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import DashboardLayout from '@/components/DashboardLayout';
import InternationalPhoneInput from '@/components/InternationalPhoneInput';
import { Modal } from '@/components/Modal';
import Pagination from '@/components/Pagination';
import ProfileAvatar from '@/components/ProfileAvatar';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { SavedViewsBar, SavedView } from '@/components/SavedViewsBar';
import { apiService } from '@/services/api';
import { extractApiErrorMessage } from '@/services/apiErrors';
import {
  ApprovalRole,
  ApprovalStatus,
  ApprovalUser,
  ApprovalView,
  EmailVerificationFilter,
  approveUserAccount,
  getApprovalAwareUsers,
  getApprovalErrorCode,
  getPendingApprovalCount,
  getPendingApprovals,
  rejectUserAccount,
} from '@/services/userApprovals';
import {
  buildInternationalPhone,
  DEFAULT_PHONE_COUNTRY,
  PhoneInputValue,
  parseInternationalPhoneValue,
  validateNationalPhone,
} from '@/services/phoneNumber';
import { validatePasswordPolicy } from '@/services/userValidation';

type User = Omit<ApprovalUser, 'role'> & {
  _id?: string;
  role: 'admin' | ApprovalRole | string;
  last_login?: string;
  login_history?: string[];
};

type NotificationState = {
  type: 'success' | 'error';
  message: string;
} | null;

type ActionTarget =
  | { type: 'approve'; user: User }
  | { type: 'reject'; user: User }
  | null;

type UserFormData = {
  nom_complet: string;
  email: string;
  password: string;
  role: string;
  department: string;
  phone: PhoneInputValue;
  photo: string;
  is_active: boolean;
};

const VIEWS: ApprovalView[] = ['pending', 'approved', 'rejected', 'all'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const MAX_REJECTION_REASON_LENGTH = 500;

type UserRef = {
  id?: string;
  _id?: string;
  email?: string;
  created_at?: string;
};

function getUserKey(user: UserRef) {
  return user.id || user._id || `${user.email}-${user.created_at}`;
}

function getActionId(user: UserRef) {
  return user.id || user._id || '';
}

function initials(name?: string) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function UsersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <UsersPageContent />
    </ProtectedRoute>
  );
}

function UsersPageContent() {
  const tUsers = useTranslations('users');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = params.locale || 'en';
  const currentQueryString = searchParams.toString();
  const initialView = normalizeView(searchParams.get('view'));

  const [activeView, setActiveView] = useState<ApprovalView>(initialView);
  const [items, setItems] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<ApprovalRole | 'all'>('all');
  const [verificationFilter, setVerificationFilter] =
    useState<EmailVerificationFilter>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [pendingCountLoading, setPendingCountLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notification, setNotification] = useState<NotificationState>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget>(null);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const requestSequence = useRef(0);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Bulk approve/reject — only meaningful on the pending queue, backed by
  // the transactional /users/bulk-approve and /users/bulk-reject endpoints.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Saved views — per-user search/filter/sort presets for this page.
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);

  const emptyForm: UserFormData = {
    nom_complet: '',
    email: '',
    password: '',
    role: 'operator',
    department: '',
    phone: {
      country: DEFAULT_PHONE_COUNTRY,
      nationalNumber: '',
    },
    photo: '',
    is_active: true,
  };
  const departmentOptions = ['IT', 'Maintenance', 'Production', 'Administration'];
  const CUSTOM_DEPARTMENT_VALUE = '__custom_department__';
  const [formData, setFormData] = useState(emptyForm);
  const [useCustomDepartment, setUseCustomDepartment] = useState(false);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const loadPendingCount = useCallback(async () => {
    setPendingCountLoading(true);
    try {
      const count = await getPendingApprovalCount();
      setPendingCount(count.count);
    } catch (error) {
      const code = getApprovalErrorCode(error);
      if (code === 'ADMIN_ACCESS_REQUIRED') {
        setAccessDenied(true);
      }
    } finally {
      setPendingCountLoading(false);
    }
  }, []);

  const loadCurrentView = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setErrorState(null);

    try {
      const response =
        activeView === 'pending'
          ? await getPendingApprovals({
              page,
              limit,
              search: debouncedSearch,
              role: roleFilter,
              emailVerified: verificationFilter,
              sortOrder,
            })
          : await getApprovalAwareUsers({
              page,
              limit,
              search: debouncedSearch,
              approvalStatus:
                activeView === 'all'
                  ? undefined
                  : (activeView as ApprovalStatus),
            });

      if (requestSequence.current !== sequence) return;

      setItems(response.items as User[]);
      setTotalItems(response.totalItems);
      setTotalPages(response.totalPages);
      setAccessDenied(false);
    } catch (error) {
      const code = getApprovalErrorCode(error);
      if (code === 'ADMIN_ACCESS_REQUIRED') {
        setAccessDenied(true);
        setItems([]);
        return;
      }
      setErrorState(errorMessageForCode(code, tUsers));
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
      }
    }
  }, [
    activeView,
    debouncedSearch,
    limit,
    page,
    roleFilter,
    sortOrder,
    tUsers,
    verificationFilter,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const nextParams = new URLSearchParams(currentQueryString);
    nextParams.set('view', activeView);
    const nextQueryString = nextParams.toString();

    if (nextQueryString === currentQueryString) {
      return;
    }

    router.replace(`/${locale}/users?${nextParams.toString()}`, {
      scroll: false,
    });
  }, [activeView, currentQueryString, locale, router]);

  useEffect(() => {
    void loadCurrentView();
  }, [loadCurrentView]);

  useEffect(() => {
    void loadPendingCount();
  }, [loadPendingCount]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeView, page]);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await apiService.getSavedViews('users');
      setSavedViews(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Non-fatal — the saved-views bar just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadSavedViews();
  }, [loadSavedViews]);

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([loadCurrentView(), loadPendingCount()]);
    window.dispatchEvent(new Event('users:approvals-changed'));
  }, [loadCurrentView, loadPendingCount]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 5000);
  }

  function switchView(view: ApprovalView) {
    setActiveView(view);
    setPage(1);
    setErrorState(null);
  }

  function resetForm() {
    setFormData(emptyForm);
    setUseCustomDepartment(false);
    setEditingUser(null);
  }

  function validateForm() {
    if (!formData.nom_complet.trim()) {
      showNotification('error', tUsers('validation.nameRequired'));
      return false;
    }
    if (!formData.email.trim()) {
      showNotification('error', tUsers('validation.emailRequired'));
      return false;
    }
    if (
      !validateNationalPhone(
        formData.phone.country,
        formData.phone.nationalNumber,
      )
    ) {
      showNotification('error', tUsers('validation.invalidPhone'));
      return false;
    }
    if (!editingUser && !formData.password.trim()) {
      showNotification('error', tUsers('validation.passwordRequired'));
      return false;
    }
    if (
      formData.password.trim() &&
      !validatePasswordPolicy(formData.password.trim())
    ) {
      showNotification('error', tUsers('validation.weakPassword'));
      return false;
    }
    return true;
  }

  function handleAdd() {
    resetForm();
    setIsModalOpen(true);
  }

  function handleEdit(user: User) {
    const existingDepartment = user.department || '';
    const isCustomDepartment =
      !!existingDepartment && !departmentOptions.includes(existingDepartment);

    setEditingUser(user);
    setUseCustomDepartment(isCustomDepartment);
    setFormData({
      nom_complet: user.nom_complet || '',
      email: user.email || '',
      password: '',
      role: user.role || 'operator',
      department: existingDepartment,
      phone: parseInternationalPhoneValue(user.phone),
      photo: user.photo || '',
      is_active: user.is_active ?? true,
    });
    setIsModalOpen(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const uploadData = new FormData();
      uploadData.append('photo', file);
      const response = await apiService.uploadPhoto(uploadData);
      const photoPath = response.data.photoPath || response.data.path || '';
      setFormData((prev) => ({ ...prev, photo: photoPath }));

      if (editingUser && photoPath) {
        await apiService.updateUser(getActionId(editingUser), { photo: photoPath });
        await loadCurrentView();
      }

      showNotification('success', tUsers('notifications.photoUploaded'));
    } catch (error) {
      console.error(error);
      showNotification('error', tUsers('notifications.photoUploadFailed'));
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);

    try {
      const phone = buildInternationalPhone(
        formData.phone.country,
        formData.phone.nationalNumber,
      );
      const payload = {
        nom_complet: formData.nom_complet.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department.trim() || undefined,
        phone: phone || undefined,
        photo: formData.photo || undefined,
        is_active: formData.is_active,
        ...(formData.password.trim()
          ? { password: formData.password.trim() }
          : {}),
      };

      if (editingUser) {
        await apiService.updateUser(getActionId(editingUser), payload);
        showNotification('success', tUsers('notifications.updated'));
      } else {
        await apiService.createUser({
          ...payload,
          password: formData.password.trim(),
        });
        showNotification('success', tUsers('notifications.created'));
      }

      setIsModalOpen(false);
      resetForm();
      await loadCurrentView();
    } catch (error) {
      console.error('Save error:', error);
      showNotification('error', tUsers('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(userId?: string) {
    if (!userId) return;
    if (!confirm(tUsers('notifications.confirmDelete'))) return;

    try {
      await apiService.deleteUser(userId);
      await loadCurrentView();
      showNotification('success', tUsers('notifications.deleted'));
    } catch (error) {
      console.error('Error deleting user:', error);
      showNotification('error', tUsers('notifications.deleteFailed'));
    }
  }

  async function confirmApprove() {
    if (actionTarget?.type !== 'approve') return;
    const actionId = getActionId(actionTarget.user);
    if (!actionId || rowActionId) return;

    setRowActionId(actionId);
    try {
      const response = await approveUserAccount(actionId);
      const code = response.data?.code;
      setActionTarget(null);
      showNotification(
        'success',
        code === 'ACCOUNT_ALREADY_APPROVED'
          ? tUsers('approvals.messages.alreadyApproved')
          : tUsers('approvals.messages.approved'),
      );
      await refreshAfterDecision();
      if (items.length === 1 && page > 1) setPage((prev) => prev - 1);
    } catch (error) {
      await handleDecisionError(error);
    } finally {
      setRowActionId(null);
    }
  }

  async function confirmReject() {
    if (actionTarget?.type !== 'reject') return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError(tUsers('approvals.validation.reasonRequired'));
      return;
    }
    if (trimmedReason.length > MAX_REJECTION_REASON_LENGTH) {
      setReasonError(tUsers('approvals.validation.reasonMax'));
      return;
    }

    const actionId = getActionId(actionTarget.user);
    if (!actionId || rowActionId) return;

    setRowActionId(actionId);
    try {
      const response = await rejectUserAccount(actionId, trimmedReason);
      const code = response.data?.code;
      setActionTarget(null);
      setReason('');
      setReasonError('');
      showNotification(
        'success',
        code === 'ACCOUNT_REJECTION_UPDATED'
          ? tUsers('approvals.messages.rejectionUpdated')
          : tUsers('approvals.messages.rejected'),
      );
      await refreshAfterDecision();
      if (items.length === 1 && page > 1) setPage((prev) => prev - 1);
    } catch (error) {
      await handleDecisionError(error);
    } finally {
      setRowActionId(null);
    }
  }

  async function handleDecisionError(error: unknown) {
    const code = getApprovalErrorCode(error);
    const status = (error as { response?: { status?: number } })?.response?.status;

    if (status === 404 || status === 409) {
      await refreshAfterDecision();
    }

    showNotification('error', errorMessageForCode(code, tUsers));
  }

  function openReject(user: User) {
    setReason('');
    setReasonError('');
    setActionTarget({ type: 'reject', user });
  }

  function closeActionDialog() {
    if (rowActionId) return;
    setActionTarget(null);
    setReason('');
    setReasonError('');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(items.map((user) => getActionId(user))) : new Set());
  }

  async function handleBulkApprove() {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkSubmitting) return;
    setBulkSubmitting(true);
    const previousItems = items;
    // Optimistic: approved users leave the pending queue immediately;
    // rolled back below if the transaction fails.
    setItems((prev) => prev.filter((user) => !selectedIds.has(getActionId(user))));
    try {
      await apiService.bulkApproveUsers(ids);
      showNotification('success', tUsers('bulk.approveSuccess', { count: ids.length }));
      setSelectedIds(new Set());
      await refreshAfterDecision();
    } catch (error) {
      setItems(previousItems);
      showNotification('error', extractApiErrorMessage(error, tUsers('bulk.approveFailed')));
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function handleBulkReject() {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkSubmitting) return;
    const trimmedReason = bulkRejectReason.trim();
    if (!trimmedReason) {
      showNotification('error', tUsers('bulk.reasonRequired'));
      return;
    }
    setBulkSubmitting(true);
    const previousItems = items;
    setItems((prev) => prev.filter((user) => !selectedIds.has(getActionId(user))));
    try {
      await apiService.bulkRejectUsers(ids, trimmedReason);
      showNotification('success', tUsers('bulk.rejectSuccess', { count: ids.length }));
      setSelectedIds(new Set());
      setBulkRejectReason('');
      await refreshAfterDecision();
    } catch (error) {
      setItems(previousItems);
      showNotification('error', extractApiErrorMessage(error, tUsers('bulk.rejectFailed')));
    } finally {
      setBulkSubmitting(false);
    }
  }

  function applySavedView(view: SavedView) {
    const query = view.query as {
      view?: ApprovalView;
      search?: string;
      role?: ApprovalRole | 'all';
      verification?: EmailVerificationFilter;
      sortOrder?: 'asc' | 'desc';
    };
    setActiveSavedViewId(view._id);
    if (query.view) setActiveView(query.view);
    setSearchInput(query.search ?? '');
    setDebouncedSearch(query.search ?? '');
    if (query.role) setRoleFilter(query.role);
    if (query.verification) setVerificationFilter(query.verification);
    if (query.sortOrder) setSortOrder(query.sortOrder);
    setPage(1);
  }

  async function saveCurrentView(name: string) {
    try {
      const query = {
        view: activeView,
        search: debouncedSearch,
        role: roleFilter,
        verification: verificationFilter,
        sortOrder,
      };
      const response = await apiService.createSavedView({ pageKey: 'users', name, query });
      setSavedViews((prev) => [response.data, ...prev]);
      showNotification('success', tUsers('savedViews.saved'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tUsers('savedViews.saveFailed')));
    }
  }

  async function deleteSavedView(view: SavedView) {
    try {
      await apiService.deleteSavedView(view._id);
      setSavedViews((prev) => prev.filter((v) => v._id !== view._id));
      if (activeSavedViewId === view._id) setActiveSavedViewId(null);
      showNotification('success', tUsers('savedViews.deleted'));
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tUsers('savedViews.deleteFailed')));
    }
  }

  const activeTitle = tUsers(`approvals.tabs.${activeView}`);
  const isPending = activeView === 'pending';

  return (
    <DashboardLayout title={tUsers('pageTitle')}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border p-4 shadow-lg ${
            notification.type === 'success'
              ? 'border-green-200 bg-green-100 text-green-800'
              : 'border-red-200 bg-red-100 text-red-800'
          }`}
          role={notification.type === 'error' ? 'alert' : 'status'}
        >
          {notification.type === 'success' ? (
            <CheckCircleIcon className="h-5 w-5" />
          ) : (
            <ExclamationTriangleIcon className="h-5 w-5" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      <div className="bento-grid">
        <div className="col-span-full bento-item">
          <div className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">
                  {tUsers('heading')}
                </h1>
                <p className="mt-1 text-slate-600">{tUsers('subtitle')}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {activeView === 'pending' ? pendingCount : totalItems}
                  </div>
                  <div className="text-sm text-slate-500">
                    {activeView === 'pending'
                      ? tUsers('approvals.pendingCount')
                      : tUsers('totalUsers')}
                  </div>
                </div>
                {activeView === 'all' && (
                  <button
                    onClick={handleAdd}
                    className="btn-primary flex items-center gap-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span>{tUsers('addUser')}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2" role="tablist">
              {VIEWS.map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={activeView === view}
                  onClick={() => switchView(view)}
                  style={{ minHeight: 24 }}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    activeView === view
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                  }`}
                >
                  <span>{tUsers(`approvals.tabs.${view}`)}</span>
                  {view === 'pending' && !pendingCountLoading && pendingCount > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        activeView === view
                          ? 'bg-white text-blue-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {formatBadgeCount(pendingCount)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="input-field xl:col-span-2"
                placeholder={tUsers('approvals.filters.search')}
                aria-label={tUsers('approvals.filters.search')}
              />
              {isPending && (
                <>
                  <select
                    value={roleFilter}
                    onChange={(event) => {
                      setRoleFilter(event.target.value as ApprovalRole | 'all');
                      setPage(1);
                    }}
                    className="input-field"
                    aria-label={tUsers('approvals.filters.role')}
                  >
                    <option value="all">{tUsers('approvals.filters.allRoles')}</option>
                    <option value="operator">{tUsers('roles.operator')}</option>
                    <option value="technician">{tUsers('roles.technician')}</option>
                  </select>
                  <select
                    value={verificationFilter}
                    onChange={(event) => {
                      setVerificationFilter(
                        event.target.value as EmailVerificationFilter,
                      );
                      setPage(1);
                    }}
                    className="input-field"
                    aria-label={tUsers('approvals.filters.verification')}
                  >
                    <option value="all">{tUsers('approvals.filters.allVerification')}</option>
                    <option value="verified">{tUsers('approvals.emailVerified')}</option>
                    <option value="unverified">{tUsers('approvals.emailNotVerified')}</option>
                  </select>
                  <select
                    value={sortOrder}
                    onChange={(event) => {
                      setSortOrder(event.target.value as 'asc' | 'desc');
                      setPage(1);
                    }}
                    className="input-field"
                    aria-label={tUsers('approvals.filters.sort')}
                  >
                    <option value="asc">{tUsers('approvals.filters.oldest')}</option>
                    <option value="desc">{tUsers('approvals.filters.newest')}</option>
                  </select>
                </>
              )}
              {!isPending && (
                <select
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setPage(1);
                  }}
                  className="input-field"
                  aria-label={tUsers('approvals.filters.pageSize')}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-4">
              <SavedViewsBar
                views={savedViews}
                activeViewId={activeSavedViewId}
                onApply={applySavedView}
                onSaveCurrent={(name) => void saveCurrentView(name)}
                onDelete={(view) => void deleteSavedView(view)}
                saveLabel={tUsers('savedViews.save')}
                namePlaceholder={tUsers('savedViews.namePlaceholder')}
                emptyLabel={tUsers('savedViews.empty')}
                deleteLabel={tUsers('savedViews.delete')}
              />
            </div>
          </div>
        </div>

        <div className="col-span-full bento-item panel">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="card-title">{activeTitle}</div>
              <p className="text-sm text-slate-500">
                {tUsers(`approvals.descriptions.${activeView}`)}
              </p>
            </div>
            {loading && (
              <span className="text-sm text-slate-500" role="status">
                {tUsers('approvals.loading')}
              </span>
            )}
          </div>

          {accessDenied ? (
            <AccessDenied tUsers={tUsers} />
          ) : errorState ? (
            <ErrorState message={errorState} onRetry={() => void loadCurrentView()} tUsers={tUsers} />
          ) : loading ? (
            <LoadingTable tUsers={tUsers} />
          ) : items.length === 0 ? (
            <EmptyState view={activeView} search={debouncedSearch} tUsers={tUsers} />
          ) : (
            <>
              {isPending && (
                <BulkActionToolbar
                  selectedCount={selectedIds.size}
                  onClearSelection={() => setSelectedIds(new Set())}
                  clearLabel={tUsers('bulk.clearSelection')}
                  countLabel={(count) => tUsers('bulk.selectedCount', { count })}
                >
                  <button
                    type="button"
                    onClick={() => void handleBulkApprove()}
                    disabled={bulkSubmitting}
                    className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tUsers('bulk.approve')}
                  </button>
                  <input
                    value={bulkRejectReason}
                    onChange={(e) => setBulkRejectReason(e.target.value)}
                    placeholder={tUsers('bulk.reasonPlaceholder')}
                    className="input-field h-8 w-56 text-xs"
                    aria-label={tUsers('bulk.reasonPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => void handleBulkReject()}
                    disabled={bulkSubmitting}
                    className="btn-danger px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tUsers('bulk.reject')}
                  </button>
                </BulkActionToolbar>
              )}

              <div className="users-table-scroll hidden lg:block" tabIndex={0}>
                <table className="table users-table">
                  <colgroup>
                    {isPending && <col className="users-table__select" />}
                    <col className="users-table__photo" />
                    <col className="users-table__name" />
                    <col className="users-table__email" />
                    <col className="users-table__role" />
                    <col className="users-table__department" />
                    <col className="users-table__phone" />
                    <col className="users-table__verification" />
                    <col className="users-table__approval" />
                    <col className="users-table__date" />
                    {activeView === 'rejected' && (
                      <col className="users-table__reason" />
                    )}
                    {activeView === 'all' && (
                      <>
                        <col className="users-table__status" />
                        <col className="users-table__date" />
                        <col className="users-table__history" />
                      </>
                    )}
                    <col className="users-table__actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      {isPending && (
                        <th>
                          <input
                            type="checkbox"
                            checked={items.length > 0 && items.every((user) => selectedIds.has(getActionId(user)))}
                            onChange={(e) => toggleSelectAll(e.target.checked)}
                            aria-label={tUsers('bulk.selectAll')}
                          />
                        </th>
                      )}
                      <th>{tUsers('table.photo')}</th>
                      <th>{tUsers('table.name')}</th>
                      <th>{tUsers('table.email')}</th>
                      <th>{tUsers('table.role')}</th>
                      <th>{tUsers('table.department')}</th>
                      <th>{tUsers('table.phone')}</th>
                      <th>{tUsers('approvals.emailVerification')}</th>
                      <th>{tUsers('approvals.approvalStatus')}</th>
                      <th>{dateHeaderForView(activeView, tUsers)}</th>
                      {activeView === 'rejected' && (
                        <th>{tUsers('approvals.rejectionReason')}</th>
                      )}
                      {activeView === 'all' && (
                        <>
                          <th>{tUsers('table.status')}</th>
                          <th>{tUsers('table.lastLogin')}</th>
                          <th>{tUsers('table.loginHistory')}</th>
                        </>
                      )}
                      <th>{tCommon('table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((user) => (
                      <UserRow
                        key={getUserKey(user)}
                        user={user}
                        view={activeView}
                        rowActionId={rowActionId}
                        dateFormatter={dateFormatter}
                        onApprove={(target) =>
                          setActionTarget({ type: 'approve', user: target })
                        }
                        onReject={openReject}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onHistory={(target) => {
                          setHistoryUser(target);
                          setIsHistoryModalOpen(true);
                        }}
                        selectable={isPending}
                        selected={selectedIds.has(getActionId(user))}
                        onToggleSelect={() => toggleSelect(getActionId(user))}
                        tUsers={tUsers}
                        tCommon={tCommon}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 lg:hidden">
                {items.map((user) => (
                  <UserCard
                    key={getUserKey(user)}
                    user={user}
                    view={activeView}
                    rowActionId={rowActionId}
                    dateFormatter={dateFormatter}
                    onApprove={(target) =>
                      setActionTarget({ type: 'approve', user: target })
                    }
                    onReject={openReject}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onHistory={(target) => {
                      setHistoryUser(target);
                      setIsHistoryModalOpen(true);
                    }}
                    selectable={isPending}
                    selected={selectedIds.has(getActionId(user))}
                    onToggleSelect={() => toggleSelect(getActionId(user))}
                    tUsers={tUsers}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="col-span-full">
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            limit={limit}
            onPageChange={setPage}
          />
        </div>
      </div>

      <ApprovalDialog
        target={actionTarget}
        reason={reason}
        reasonError={reasonError}
        loading={!!rowActionId}
        onReasonChange={(nextReason) => {
          setReason(nextReason);
          setReasonError('');
        }}
        onClose={closeActionDialog}
        onApprove={() => void confirmApprove()}
        onReject={() => void confirmReject()}
        tUsers={tUsers}
      />

      <UserFormModal
        isOpen={isModalOpen}
        editingUser={editingUser}
        formData={formData}
        useCustomDepartment={useCustomDepartment}
        departmentOptions={departmentOptions}
        customDepartmentValue={CUSTOM_DEPARTMENT_VALUE}
        submitting={submitting}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        onSubmit={handleSubmit}
        onPhotoUpload={handlePhotoUpload}
        onUseCustomDepartmentChange={setUseCustomDepartment}
        onFormDataChange={setFormData}
        tUsers={tUsers}
        tCommon={tCommon}
      />

      <HistoryModal
        isOpen={isHistoryModalOpen}
        user={historyUser}
        dateFormatter={dateFormatter}
        onClose={() => {
          setIsHistoryModalOpen(false);
          setHistoryUser(null);
        }}
        tUsers={tUsers}
      />
    </DashboardLayout>
  );
}

function normalizeView(view: string | null): ApprovalView {
  return view === 'approved' ||
    view === 'rejected' ||
    view === 'all' ||
    view === 'pending'
    ? view
    : 'all';
}

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

function formatDate(
  value: string | undefined,
  dateFormatter: Intl.DateTimeFormat,
) {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

function dateHeaderForView(
  view: ApprovalView,
  tUsers: ReturnType<typeof useTranslations>,
) {
  if (view === 'approved') return tUsers('approvals.approvalDate');
  if (view === 'rejected') return tUsers('approvals.rejectionDate');
  return tUsers('approvals.requestDate');
}

function dateValueForView(user: User, view: ApprovalView) {
  if (view === 'approved') return user.approved_at;
  if (view === 'rejected') return user.rejected_at;
  return user.created_at;
}

function errorMessageForCode(
  code: string | null,
  tUsers: ReturnType<typeof useTranslations>,
) {
  const key = code ? `approvals.errors.${code}` : 'approvals.errors.generic';
  try {
    return tUsers(key);
  } catch {
    return tUsers('approvals.errors.generic');
  }
}

function RoleBadge({
  role,
  tUsers,
}: {
  role?: string;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  if (role !== 'operator' && role !== 'technician' && role !== 'admin') {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
        {tUsers('approvals.unknownRole')}
      </span>
    );
  }

  const className =
    role === 'admin'
      ? 'bg-violet-100 text-violet-800'
      : role === 'technician'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-100 text-slate-800';

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {tUsers(`roles.${role}`)}
    </span>
  );
}

function VerificationBadge({
  verified,
  tUsers,
}: {
  verified?: boolean;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${
        verified
          ? 'bg-green-100 text-green-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {verified
        ? tUsers('approvals.emailVerified')
        : tUsers('approvals.emailNotVerified')}
    </span>
  );
}

function ApprovalStatusBadge({
  status,
  tUsers,
}: {
  status?: ApprovalStatus;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const className =
    status === 'approved'
      ? 'bg-green-100 text-green-800'
      : status === 'rejected'
        ? 'bg-red-100 text-red-800'
        : status === 'pending'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
  const label = status
    ? tUsers(`approvals.status.${status}`)
    : tUsers('approvals.status.legacy');

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function UserIdentity({
  user,
  tUsers,
}: {
  user: Partial<User>;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {user.photo ? (
        <ProfileAvatar
          name={user.nom_complet}
          photo={user.photo}
          alt={user.nom_complet || tUsers('approvals.userAvatar')}
          size="sm"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
          {initials(user.nom_complet)}
        </div>
      )}
      <div className="min-w-0">
        <div className="user-table-text font-semibold text-slate-800">
          {user.nom_complet || '—'}
        </div>
        <div className="user-table-text text-xs text-slate-500">{user.email || '—'}</div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  view,
  rowActionId,
  dateFormatter,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  onHistory,
  selectable = false,
  selected = false,
  onToggleSelect,
  tUsers,
  tCommon,
}: {
  user: User;
  view: ApprovalView;
  rowActionId: string | null;
  dateFormatter: Intl.DateTimeFormat;
  onApprove: (user: User) => void;
  onReject: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (id?: string) => void;
  onHistory: (user: User) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  tUsers: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const actionId = getActionId(user);
  const actionLoading = rowActionId === actionId;
  const approveDisabled = actionLoading || !user.is_verified;

  return (
    <tr aria-selected={selectable ? selected : undefined}>
      {selectable && (
        <td>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={tUsers('bulk.selectRow', { name: user.nom_complet || user.email || '' })}
          />
        </td>
      )}
      <td>
        <ProfileAvatar
          name={user.nom_complet}
          photo={user.photo}
          alt={user.nom_complet || tUsers('approvals.userAvatar')}
          size="sm"
        />
      </td>
      <td>
        <UserIdentity user={user} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">{user.email || '—'}</span>
      </td>
      <td>
        <RoleBadge role={user.role} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">{user.department || '—'}</span>
      </td>
      <td>
        <span className="user-table-text">{user.phone || '—'}</span>
      </td>
      <td>
        <VerificationBadge verified={user.is_verified} tUsers={tUsers} />
      </td>
      <td>
        <ApprovalStatusBadge status={user.approval_status} tUsers={tUsers} />
      </td>
      <td>
        <span className="user-table-text">
          {formatDate(dateValueForView(user, view), dateFormatter)}
        </span>
      </td>
      {view === 'rejected' && (
        <td>
          <span title={user.rejection_reason || ''} className="user-table-reason">
            {user.rejection_reason || '—'}
          </span>
        </td>
      )}
      {view === 'all' && (
        <>
          <td>
            <span
              className={`rounded-full px-2 py-1 text-xs ${
                user.is_active
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {tUsers(`status.${user.is_active ? 'active' : 'inactive'}`)}
            </span>
          </td>
          <td>
            <span className="user-table-text">
              {formatDate(user.last_login, dateFormatter)}
            </span>
          </td>
          <td>
            {Array.isArray(user.login_history) && user.login_history.length > 0
              ? user.login_history.length
              : '—'}
          </td>
        </>
      )}
      <td>
        {view === 'pending' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove(user)}
              disabled={approveDisabled}
              title={
                !user.is_verified
                  ? tUsers('approvals.mustVerifyBeforeApproval')
                  : tUsers('approvals.actions.approve')
              }
              className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckIcon className="h-4 w-4 shrink-0" />
              {actionLoading
                ? tUsers('approvals.actions.processing')
                : tUsers('approvals.actions.approve')}
            </button>
            <button
              type="button"
              onClick={() => onReject(user)}
              disabled={actionLoading}
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XMarkIcon className="h-4 w-4 shrink-0" />
              {tUsers('approvals.actions.reject')}
            </button>
            {!user.is_verified && (
              <span className="max-w-48 whitespace-normal text-xs leading-snug text-amber-700">
                {tUsers('approvals.mustVerifyBeforeApproval')}
              </span>
            )}
          </div>
        ) : view === 'all' ? (
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={tUsers('actions.viewDetails')}
              title={tUsers('actions.viewDetails')}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onHistory(user)}
            >
              <EyeIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.viewDetails')}</span>
            </button>
            <button
              type="button"
              aria-label={tUsers('actions.edit')}
              title={tUsers('actions.edit')}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onEdit(user)}
            >
              <PencilIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.edit')}</span>
            </button>
            <button
              type="button"
              aria-label={tUsers('actions.delete')}
              title={tUsers('actions.delete')}
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => onDelete(getActionId(user))}
            >
              <TrashIcon className="h-4 w-4 shrink-0" />
              <span>{tUsers('actions.delete')}</span>
            </button>
          </div>
        ) : (
          <span className="text-sm text-slate-500">
            {tCommon('notAvailable')}
          </span>
        )}
      </td>
    </tr>
  );
}

function UserCard(props: {
  user: User;
  view: ApprovalView;
  rowActionId: string | null;
  dateFormatter: Intl.DateTimeFormat;
  onApprove: (user: User) => void;
  onReject: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (id?: string) => void;
  onHistory: (user: User) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const {
    user,
    view,
    rowActionId,
    dateFormatter,
    onApprove,
    onReject,
    onEdit,
    onDelete,
    onHistory,
    selectable = false,
    selected = false,
    onToggleSelect,
    tUsers,
  } = props;
  const actionLoading = rowActionId === getActionId(user);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={tUsers('bulk.selectRow', { name: user.nom_complet || user.email || '' })}
            className="mt-1"
          />
        )}
        <UserIdentity user={user} tUsers={tUsers} />
        <ApprovalStatusBadge status={user.approval_status} tUsers={tUsers} />
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{tUsers('table.role')}</span>
          <RoleBadge role={user.role} tUsers={tUsers} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{tUsers('approvals.emailVerification')}</span>
          <VerificationBadge verified={user.is_verified} tUsers={tUsers} />
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{dateHeaderForView(view, tUsers)}</span>
          <span>{formatDate(dateValueForView(user, view), dateFormatter)}</span>
        </div>
      </div>
      {view === 'pending' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onApprove(user)}
            disabled={actionLoading || !user.is_verified}
            title={!user.is_verified ? tUsers('approvals.mustVerifyBeforeApproval') : undefined}
            className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4 shrink-0" />
            {actionLoading
              ? tUsers('approvals.actions.processing')
              : tUsers('approvals.actions.approve')}
          </button>
          <button
            type="button"
            onClick={() => onReject(user)}
            disabled={actionLoading}
            className="btn-danger flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XMarkIcon className="h-4 w-4 shrink-0" />
            {tUsers('approvals.actions.reject')}
          </button>
          {!user.is_verified && (
            <p className="basis-full text-xs text-amber-700">
              {tUsers('approvals.mustVerifyBeforeApproval')}
            </p>
          )}
        </div>
      )}
      {view === 'all' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onHistory(user)}
          >
            <EyeIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.viewDetails')}
          </button>
          <button
            type="button"
            className="btn-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onEdit(user)}
          >
            <PencilIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.edit')}
          </button>
          <button
            type="button"
            className="btn-danger flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
            onClick={() => onDelete(getActionId(user))}
          >
            <TrashIcon className="h-4 w-4 shrink-0" />
            {tUsers('actions.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalDialog({
  target,
  reason,
  reasonError,
  loading,
  onReasonChange,
  onClose,
  onApprove,
  onReject,
  tUsers,
}: {
  target: ActionTarget;
  reason: string;
  reasonError: string;
  loading: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  if (!target) return null;
  const isReject = target.type === 'reject';
  const remaining = MAX_REJECTION_REASON_LENGTH - reason.length;
  const invalidReason = isReject && (!reason.trim() || reason.length > MAX_REJECTION_REASON_LENGTH);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        isReject
          ? tUsers('approvals.dialog.rejectTitle')
          : tUsers('approvals.dialog.approveTitle')
      }
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-800">{target.user.nom_complet}</p>
          <p className="text-sm text-slate-600">{target.user.email}</p>
          <div className="mt-2">
            <RoleBadge role={target.user.role} tUsers={tUsers} />
          </div>
        </div>
        {isReject ? (
          <div>
            <label htmlFor="rejection-reason" className="mb-1 block text-sm font-medium text-slate-700">
              {tUsers('approvals.rejectionReason')}
            </label>
            <textarea
              id="rejection-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={MAX_REJECTION_REASON_LENGTH + 20}
              aria-invalid={!!reasonError || invalidReason}
              aria-describedby="rejection-reason-help"
              className="input-field min-h-28"
            />
            <div id="rejection-reason-help" className="mt-1 flex justify-between text-xs">
              <span className={reasonError ? 'text-red-700' : 'text-slate-500'}>
                {reasonError || tUsers('approvals.validation.reasonRequired')}
              </span>
              <span className={remaining < 0 ? 'text-red-700' : 'text-slate-500'}>
                {remaining}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-base font-semibold text-slate-800">
              {tUsers('approvals.dialog.approveQuestion')}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {tUsers('approvals.dialog.approveDescription')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {tUsers('approvals.actions.cancel')}
          </button>
          <button
            type="button"
            className={isReject ? 'btn-danger' : 'btn-primary'}
            onClick={isReject ? onReject : onApprove}
            disabled={loading || invalidReason}
          >
            {loading
              ? tUsers('approvals.actions.processing')
              : isReject
                ? tUsers('approvals.actions.confirmReject')
                : tUsers('approvals.actions.confirmApprove')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AccessDenied({
  tUsers,
}: {
  tUsers: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
      <h2 className="text-lg font-semibold">{tUsers('approvals.accessDenied')}</h2>
      <p className="mt-2 text-sm">{tUsers('approvals.accessDeniedDescription')}</p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  tUsers,
}: {
  message: string;
  onRetry: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800">
      <p className="font-semibold">{message}</p>
      <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
        {tUsers('approvals.retry')}
      </button>
    </div>
  );
}

function LoadingTable({ tUsers }: { tUsers: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-3" role="status">
      <span className="sr-only">{tUsers('approvals.loading')}</span>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function EmptyState({
  view,
  search,
  tUsers,
}: {
  view: ApprovalView;
  search: string;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const key = search
    ? 'approvals.empty.search'
    : `approvals.empty.${view}`;
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
      <p className="font-semibold">{tUsers(key)}</p>
      {view === 'pending' && !search && (
        <p className="mt-2 text-sm">{tUsers('approvals.empty.pendingDescription')}</p>
      )}
    </div>
  );
}

function UserFormModal(props: {
  isOpen: boolean;
  editingUser: User | null;
  formData: UserFormData;
  useCustomDepartment: boolean;
  departmentOptions: string[];
  customDepartmentValue: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (event?: React.FormEvent) => void;
  onPhotoUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onUseCustomDepartmentChange: (value: boolean) => void;
  onFormDataChange: (data: UserFormData) => void;
  tUsers: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const {
    isOpen,
    editingUser,
    formData,
    useCustomDepartment,
    departmentOptions,
    customDepartmentValue,
    submitting,
    onClose,
    onSubmit,
    onPhotoUpload,
    onUseCustomDepartmentChange,
    onFormDataChange,
    tUsers,
    tCommon,
  } = props;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingUser ? tUsers('modal.editTitle') : tUsers('modal.addTitle')}
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex flex-col items-center gap-3">
          <label className="group relative cursor-pointer">
            <ProfileAvatar
              name={formData.nom_complet}
              photo={formData.photo}
              alt={tUsers('form.profilePhoto')}
              size="lg"
              className="border border-slate-300"
            />
            <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md transition-colors group-hover:bg-blue-700">
              <CameraIcon className="h-4 w-4" />
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              aria-label={tUsers('form.profilePhoto')}
              onChange={onPhotoUpload}
            />
          </label>
          <span className="text-sm text-slate-500">{tUsers('form.clickAvatar')}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <input
            type="text"
            value={formData.nom_complet}
            onChange={(event) =>
              onFormDataChange({ ...formData, nom_complet: event.target.value })
            }
            className="input-field"
            placeholder={tUsers('form.fullName')}
            aria-label={tUsers('form.fullName')}
            required
          />
          <input
            type="email"
            value={formData.email}
            onChange={(event) =>
              onFormDataChange({ ...formData, email: event.target.value })
            }
            className="input-field"
            placeholder={tUsers('form.email')}
            aria-label={tUsers('form.email')}
            required
          />
        </div>

        <input
          type="password"
          value={formData.password}
          onChange={(event) =>
            onFormDataChange({ ...formData, password: event.target.value })
          }
          className="input-field"
          required={!editingUser}
          placeholder={
            editingUser ? tUsers('placeholders.editPassword') : tUsers('placeholders.password')
          }
          aria-label={tUsers('form.password')}
        />

        <InternationalPhoneInput
          name="phone"
          value={formData.phone}
          onChange={(phone) => onFormDataChange({ ...formData, phone })}
          placeholder={tUsers('validation.phoneHint')}
          className="w-full"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <select
              value={
                useCustomDepartment
                  ? customDepartmentValue
                  : formData.department
              }
              onChange={(event) => {
                if (event.target.value === customDepartmentValue) {
                  onUseCustomDepartmentChange(true);
                  onFormDataChange({ ...formData, department: '' });
                  return;
                }
                onUseCustomDepartmentChange(false);
                onFormDataChange({ ...formData, department: event.target.value });
              }}
              className="input-field"
              aria-label={tUsers('form.department')}
            >
              <option value="">{tUsers('form.department')}</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
              <option value={customDepartmentValue}>
                {tUsers('form.customDepartment')}
              </option>
            </select>
            {useCustomDepartment && (
              <input
                type="text"
                value={formData.department}
                onChange={(event) =>
                  onFormDataChange({ ...formData, department: event.target.value })
                }
                className="input-field mt-2"
                placeholder={tUsers('form.customDepartment')}
              />
            )}
          </div>
          <select
            value={formData.role}
            onChange={(event) =>
              onFormDataChange({ ...formData, role: event.target.value })
            }
            className="input-field"
            aria-label={tUsers('form.role')}
          >
            <option value="admin">{tUsers('roles.admin')}</option>
            <option value="technician">{tUsers('roles.technician')}</option>
            <option value="operator">{tUsers('roles.operator')}</option>
          </select>
        </div>

        <select
          value={formData.is_active ? 'true' : 'false'}
          onChange={(event) =>
            onFormDataChange({
              ...formData,
              is_active: event.target.value === 'true',
            })
          }
          className="input-field"
          aria-label={tUsers('form.status')}
        >
          <option value="true">{tUsers('status.active')}</option>
          <option value="false">{tUsers('status.inactive')}</option>
        </select>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            {tCommon('actions.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? tCommon('actions.saving')
              : editingUser
                ? tUsers('actions.updateUser')
                : tUsers('actions.createUser')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({
  isOpen,
  user,
  dateFormatter,
  onClose,
  tUsers,
}: {
  isOpen: boolean;
  user: User | null;
  dateFormatter: Intl.DateTimeFormat;
  onClose: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tUsers('modal.loginHistoryTitle')}
      size="md"
    >
      <div className="space-y-4">
        <UserIdentity user={user || {}} tUsers={tUsers} />
        {Array.isArray(user?.login_history) && user.login_history.length > 0 ? (
          <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {user.login_history.map((entry, index) => (
              <li
                key={`${user.email}-history-${index}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                {dateFormatter.format(new Date(entry))}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            {tUsers('empty.loginHistory')}
          </div>
        )}
      </div>
    </Modal>
  );
}
