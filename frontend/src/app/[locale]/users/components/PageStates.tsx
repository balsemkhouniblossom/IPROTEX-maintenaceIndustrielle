import { useTranslations } from 'next-intl';
import { ApprovalView } from '@/services/userApprovals';

type UserTranslator = ReturnType<typeof useTranslations>;

type AccessDeniedProps = Readonly<{
  tUsers: UserTranslator;
}>;

type ErrorStateProps = Readonly<{
  message: string;
  onRetry: () => void;
  tUsers: UserTranslator;
}>;

type LoadingTableProps = Readonly<{
  tUsers: UserTranslator;
}>;

type EmptyStateProps = Readonly<{
  view: ApprovalView;
  search: string;
  tUsers: UserTranslator;
}>;

export function AccessDenied({
  tUsers,
}: AccessDeniedProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
      <h2 className="text-lg font-semibold">{tUsers('approvals.accessDenied')}</h2>
      <p className="mt-2 text-sm">{tUsers('approvals.accessDeniedDescription')}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  tUsers,
}: ErrorStateProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800">
      <p className="font-semibold">{message}</p>
      <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
        {tUsers('approvals.retry')}
      </button>
    </div>
  );
}

export function LoadingTable({ tUsers }: LoadingTableProps) {
  return (
    <output className="block space-y-3">
      <span className="sr-only">{tUsers('approvals.loading')}</span>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </output>
  );
}

export function EmptyState({
  view,
  search,
  tUsers,
}: EmptyStateProps) {
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
