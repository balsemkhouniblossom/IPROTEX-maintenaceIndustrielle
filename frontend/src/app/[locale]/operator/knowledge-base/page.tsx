"use client";

import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import KnowledgeBaseBrowser from "@/components/knowledge-base/KnowledgeBaseBrowser";
import { useTranslations } from "next-intl";

export default function OperatorKnowledgeBasePage() {
  const t = useTranslations("knowledgeBase");

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <KnowledgeBaseBrowser />
      </DashboardLayout>
    </ProtectedRoute>
  );
}
