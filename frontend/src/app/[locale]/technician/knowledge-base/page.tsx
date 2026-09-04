"use client";

import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import KnowledgeBaseBrowser from "@/components/knowledge-base/KnowledgeBaseBrowser";
import { useTranslations } from "next-intl";

export default function TechnicianKnowledgeBasePage() {
  const t = useTranslations("knowledgeBase");
  const tTech = useTranslations("technician");

  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("title")}>
        <div className="space-y-4">
          <section className="panel space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              {tTech("knowledgeBase.heading")}
            </h2>
            <p className="text-sm text-slate-600">
              {tTech("knowledgeBase.subtitle")}
            </p>
            <p className="text-xs text-slate-500">
              {tTech("manuals.readOnlyHint")}
            </p>
          </section>
          <KnowledgeBaseBrowser />
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
