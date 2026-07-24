"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import api from "@/services/api";
import { useTranslations } from "next-intl";
import { buildEmailVerificationRedirect } from "@/services/emailVerification";

export default function VerifyEmailPage() {
    const params = useSearchParams();
    const router = useRouter();
    const routeParams = useParams<{ locale: string }>();
    const locale = routeParams.locale || "en";
    const t = useTranslations("auth");
    const verificationStarted = useRef(false);

    useEffect(() => {
        if (verificationStarted.current) {
            return;
        }
        verificationStarted.current = true;

        const token = params.get("token");

        if (!token) {
            router.replace(buildEmailVerificationRedirect(locale));
            return;
        }

        api
            .get(`/auth/verify-email`, {
                params: { token },
            })
            .then((response) => {
                router.replace(buildEmailVerificationRedirect(locale, response.data?.code));
            })
            .catch(() => {
                router.replace(buildEmailVerificationRedirect(locale));
            });
    }, [params, router, locale]);

    return (
        <div className="auth-shell flex min-h-screen items-center justify-center px-4">
            <div className="auth-card w-full max-w-md rounded-3xl p-8 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600 motion-reduce:animate-none dark:border-slate-700 dark:border-t-blue-400" aria-hidden="true" />
                <h1 className="auth-heading mt-5 text-xl font-semibold">{t("verifyingEmail")}</h1>
                <p className="auth-helper mt-2 text-sm">{t("verificationPleaseWait")}</p>
            </div>
        </div>
    );
}
