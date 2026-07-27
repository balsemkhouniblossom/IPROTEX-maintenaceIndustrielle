'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/contexts/AuthContext';
import {
  exchangeGoogleLoginCode,
  getGooglePostExchangeRedirect,
  isGoogleResultStatus,
  type GoogleResultStatus,
} from '@/services/googleAuth';

type ResultView = {
  titleKey: string;
  descriptionKey: string;
  tone: 'success' | 'warning' | 'danger';
};

const RESULT_VIEWS: Record<GoogleResultStatus, ResultView> = {
  'created-pending': {
    titleKey: 'googleAccountCreatedTitle',
    descriptionKey: 'googleAccountCreatedPendingApproval',
    tone: 'success',
  },
  pending: {
    titleKey: 'googlePendingTitle',
    descriptionKey: 'googleAccountPendingApproval',
    tone: 'warning',
  },
  rejected: {
    titleKey: 'googleRejectedTitle',
    descriptionKey: 'googleAccountRejected',
    tone: 'danger',
  },
  inactive: {
    titleKey: 'googleInactiveTitle',
    descriptionKey: 'googleAccountInactive',
    tone: 'danger',
  },
  failed: {
    titleKey: 'googleFailedTitle',
    descriptionKey: 'googleSignInFailed',
    tone: 'danger',
  },
};

const TONE_CLASS: Record<ResultView['tone'], string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

export default function GoogleAuthResultClient() {
  const params = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const { clearSession, completeSocialLogin } = useAuth();
  const t = useTranslations('auth');
  const locale = params.locale || 'en';
  const processedRef = useRef(false);
  const [exchangeError, setExchangeError] = useState(false);

  const status = searchParams.get('status');
  const exchange = searchParams.get('exchange');
  const statusView = useMemo(() => {
    return isGoogleResultStatus(status) ? RESULT_VIEWS[status] : null;
  }, [status]);

  useEffect(() => {
    if (processedRef.current) {
      return;
    }

    processedRef.current = true;

    if (!exchange) {
      clearSession();
      return;
    }

    window.history.replaceState(null, '', `/${locale}/auth/google-result`);

    void exchangeGoogleLoginCode(exchange)
      .then((session) => {
        completeSocialLogin(
          session.authToken,
          session.user,
          session.refreshToken,
        );

        const destination = getGooglePostExchangeRedirect(locale, session.user);
        window.location.replace(destination);
      })
      .catch(() => {
        clearSession();
        setExchangeError(true);
      });
  }, [clearSession, completeSocialLogin, exchange, locale]);

  const view = exchangeError
    ? {
        titleKey: 'googleLinkExpiredTitle',
        descriptionKey: 'googleLoginLinkExpired',
        tone: 'danger' as const,
      }
    : statusView;

  if (!view && exchange) {
    return (
      <GoogleResultShell tone="warning">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('googleSigninCompletingTitle')}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {t('googleSigninCompletingDescription')}
        </p>
        <p className="mt-4 text-xs font-medium text-slate-500">
          {t('googleDoNotClose')}
        </p>
      </GoogleResultShell>
    );
  }

  const safeView = view ?? RESULT_VIEWS.failed;

  return (
    <GoogleResultShell tone={safeView.tone}>
      <h1 className="text-2xl font-semibold text-slate-900">
        {t(safeView.titleKey)}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {t(safeView.descriptionKey)}
      </p>
      <Link
        href={`/${locale}/auth/login`}
        className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
      >
        {exchangeError ? t('tryGoogleSignInAgain') : t('returnToLogin')}
      </Link>
    </GoogleResultShell>
  );
}

function GoogleResultShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: ResultView['tone'];
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div
          className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-current" />
        </div>
        {children}
      </div>
    </div>
  );
}
