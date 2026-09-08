"use client";

import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";

function accountDestination(locale: string, role?: string): string {
  if (role === "operator") return `/${locale}/operator`;
  if (role === "technician") return `/${locale}/technician`;
  if (role === "admin") return `/${locale}`;
  return `/${locale}/auth/login`;
}

export default function LocaleNotFound() {
  const t = useTranslations("errors.notFound");
  const locale = useLocale();
  const { user, isLoading } = useAuth();
  const destination = accountDestination(locale, user?.role);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--color-background)", color: "var(--color-text-primary)" }}
    >
      <MagnifyingGlassIcon
        className="mb-4 h-12 w-12"
        style={{ color: "var(--color-text-muted)" }}
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: "var(--color-text-secondary)" }}>
        {t("description")}
      </p>
      {!isLoading && (
        <a href={destination} className="btn-primary mt-6">
          {t("home")}
        </a>
      )}
    </div>
  );
}
