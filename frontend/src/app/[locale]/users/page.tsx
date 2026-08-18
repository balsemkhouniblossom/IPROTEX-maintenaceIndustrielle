'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircleIcon, ExclamationTriangleIcon, PlusIcon } from '@heroicons/react/24/outline';

import DashboardLayout from '@/components/DashboardLayout';
import Pagination from '@/components/Pagination';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { SavedViewsBar } from '@/components/SavedViewsBar';
import { ApprovalRole, EmailVerificationFilter } from '@/services/userApprovals';

import { NotificationState, User, VIEWS, PAGE_SIZE_OPTIONS } from './types';
import { formatBadgeCount, dateHeaderForView, getActionId, getUserKey } from './utils';
import { useUsersApprovalsList } from './hooks/useUsersApprovalsList';
import { useUserApprovalActions } from './hooks/useUserApprovalActions';
import { useBulkUserActions } from './hooks/useBulkUserActions';
import { useSavedUserViews } from './hooks/useSavedUserViews';
import { useUserForm } from './hooks/useUserForm';
import { AccessDenied, ErrorState, LoadingTable, EmptyState } from './components/PageStates';
import { UserRow } from './components/UserRow';
import { UserCard } from './components/UserCard';
import { ApprovalDialog } from './components/ApprovalDialog';
import { UserFormModal } from './components/UserFormModal';
import { HistoryModal } from './components/HistoryModal';

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

  const [notification, setNotification] = useState<NotificationState>(null);
  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 5000);
  }

  const list = useUsersApprovalsList(tUsers);
  const {
    activeView,
    setActiveView,
    switchView,
    items,
    setItems,
    page,
    setPage,
    limit,
    setLimit,
    totalItems,
    totalPages,
    searchInput,
    setSearchInput,
    debouncedSearch,
    setDebouncedSearch,
    roleFilter,
    setRoleFilter,
    verificationFilter,
    setVerificationFilter,
    sortOrder,
    setSortOrder,
    loading,
    pendingCountLoading,
    pendingCount,
    errorState,
    accessDenied,
    dateFormatter,
    loadCurrentView,
    refreshAfterDecision,
  } = list;

  const approvalActions = useUserApprovalActions({
    items,
    page,
    setPage,
    refreshAfterDecision,
    showNotification,
    tUsers,
  });

  const bulkActions = useBulkUserActions({
    items,
    setItems,
    activeView,
    page,
    refreshAfterDecision,
    showNotification,
    tUsers,
  });

  const savedViews = useSavedUserViews({
    activeView,
    setActiveView,
    setSearchInput,
    setDebouncedSearch,
    setRoleFilter,
    setVerificationFilter,
    setSortOrder,
    setPage,
    debouncedSearch,
    roleFilter,
    verificationFilter,
    sortOrder,
    showNotification,
    tUsers,
  });

  const userForm = useUserForm({ loadCurrentView, showNotification, tUsers });

  const [historyUser, setHistoryUser] = useState<User | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

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
                  <button type="button"
                    onClick={userForm.handleAdd}
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
                views={savedViews.savedViews}
                activeViewId={savedViews.activeSavedViewId}
                onApply={savedViews.applySavedView}
                onSaveCurrent={(name) => void savedViews.saveCurrentView(name)}
                onDelete={(view) => void savedViews.deleteSavedView(view)}
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
                  selectedCount={bulkActions.selectedIds.size}
                  onClearSelection={() => bulkActions.toggleSelectAll(false)}
                  clearLabel={tUsers('bulk.clearSelection')}
                  countLabel={(count) => tUsers('bulk.selectedCount', { count })}
                >
                  <button
                    type="button"
                    onClick={() => void bulkActions.handleBulkApprove()}
                    disabled={bulkActions.bulkSubmitting}
                    className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tUsers('bulk.approve')}
                  </button>
                  <input
                    value={bulkActions.bulkRejectReason}
                    onChange={(e) => bulkActions.setBulkRejectReason(e.target.value)}
                    placeholder={tUsers('bulk.reasonPlaceholder')}
                    className="input-field h-8 w-56 text-xs"
                    aria-label={tUsers('bulk.reasonPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => void bulkActions.handleBulkReject()}
                    disabled={bulkActions.bulkSubmitting}
                    className="btn-danger px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tUsers('bulk.reject')}
                  </button>
                </BulkActionToolbar>
              )}

              <div
                className="users-table-scroll hidden lg:block"
                role="region"
                aria-label={tUsers('allUsers')}
              >
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
                            checked={items.length > 0 && items.every((user) => bulkActions.selectedIds.has(getActionId(user)))}
                            onChange={(e) => bulkActions.toggleSelectAll(e.target.checked)}
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
                        rowActionId={approvalActions.rowActionId}
                        dateFormatter={dateFormatter}
                        onApprove={approvalActions.openApprove}
                        onReject={approvalActions.openReject}
                        onEdit={userForm.handleEdit}
                        onDelete={userForm.handleDelete}
                        onHistory={(target) => {
                          setHistoryUser(target);
                          setIsHistoryModalOpen(true);
                        }}
                        selectable={isPending}
                        selected={bulkActions.selectedIds.has(getActionId(user))}
                        onToggleSelect={() => bulkActions.toggleSelect(getActionId(user))}
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
                    rowActionId={approvalActions.rowActionId}
                    dateFormatter={dateFormatter}
                    onApprove={approvalActions.openApprove}
                    onReject={approvalActions.openReject}
                    onEdit={userForm.handleEdit}
                    onDelete={userForm.handleDelete}
                    onHistory={(target) => {
                      setHistoryUser(target);
                      setIsHistoryModalOpen(true);
                    }}
                    selectable={isPending}
                    selected={bulkActions.selectedIds.has(getActionId(user))}
                    onToggleSelect={() => bulkActions.toggleSelect(getActionId(user))}
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
        target={approvalActions.actionTarget}
        reason={approvalActions.reason}
        reasonError={approvalActions.reasonError}
        loading={!!approvalActions.rowActionId}
        onReasonChange={(nextReason) => {
          approvalActions.setReason(nextReason);
          approvalActions.setReasonError('');
        }}
        onClose={approvalActions.closeActionDialog}
        onApprove={() => void approvalActions.confirmApprove()}
        onReject={() => void approvalActions.confirmReject()}
        tUsers={tUsers}
      />

      <UserFormModal
        isOpen={userForm.isModalOpen}
        editingUser={userForm.editingUser}
        formData={userForm.formData}
        useCustomDepartment={userForm.useCustomDepartment}
        departmentOptions={userForm.departmentOptions}
        customDepartmentValue={userForm.customDepartmentValue}
        submitting={userForm.submitting}
        onClose={() => {
          userForm.setIsModalOpen(false);
          userForm.resetForm();
        }}
        onSubmit={userForm.handleSubmit}
        onPhotoUpload={userForm.handlePhotoUpload}
        onUseCustomDepartmentChange={userForm.setUseCustomDepartment}
        onFormDataChange={userForm.setFormData}
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
