"use client";

import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import KnowledgeBaseBrowser from "@/components/knowledge-base/KnowledgeBaseBrowser";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

export default function OperatorKnowledgeBasePage() {
  const t = useTranslations("knowledgeBase");
  const searchParams = useSearchParams();
  const machineId = searchParams.get("machine") || undefined;

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <KnowledgeBaseBrowser machineId={machineId} />
      </DashboardLayout>
    </ProtectedRoute>
  );
}
