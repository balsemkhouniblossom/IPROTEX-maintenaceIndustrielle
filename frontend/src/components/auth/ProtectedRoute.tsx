'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { evaluateProtectedRouteAccess } from '@/services/sessionGuard';

type ProtectedRouteProps = Readonly<{
  children: React.ReactNode;
  requiredRole?: string;
  allowedRoles?: string[];
}>;

export default function ProtectedRoute({
  children,
  requiredRole,
  allowedRoles,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('auth.protected');

  const decision = useMemo(
    () =>
      evaluateProtectedRouteAccess({
        user,
        pathname,
        requiredRole,
        allowedRoles,
      }),
    [allowedRoles, pathname, requiredRole, user],
  );

  useEffect(() => {
    if (!isLoading && decision.status !== 'allow') {
      router.replace(decision.to);
    }
  }, [decision, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="mt-4 text-sm font-medium text-slate-700">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || decision.status === 'redirect') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-800">{t('redirectingTitle')}</p>
          <p className="mt-2 text-sm text-slate-600">
            {t('redirectingDescription')}
          </p>
        </div>
      </div>
    );
  }

  if (decision.status === 'deny') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-amber-900">{t('accessDeniedTitle')}</p>
          <p className="mt-2 text-sm text-amber-800">
            {t('accessDeniedDescription')}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

