import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ApprovalRole,
  ApprovalStatus,
  ApprovalView,
  EmailVerificationFilter,
  getApprovalAwareUsers,
  getApprovalErrorCode,
  getPendingApprovalCount,
  getPendingApprovals,
} from '@/services/userApprovals';
import { User } from '../types';
import { errorMessageForCode, normalizeView } from '../utils';

export function useUsersApprovalsList(tUsers: ReturnType<typeof useTranslations>) {
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
  const requestSequence = useRef(0);

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

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([loadCurrentView(), loadPendingCount()]);
    window.dispatchEvent(new Event('users:approvals-changed'));
  }, [loadCurrentView, loadPendingCount]);

  function switchView(view: ApprovalView) {
    setActiveView(view);
    setPage(1);
    setErrorState(null);
  }

  return {
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
  };
}
