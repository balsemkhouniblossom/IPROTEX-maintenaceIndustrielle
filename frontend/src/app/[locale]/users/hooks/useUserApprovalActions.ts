import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import {
  approveUserAccount,
  deactivateUserAccount,
  getApprovalErrorCode,
  rejectUserAccount,
  reactivateUserAccount,
} from "@/services/userApprovals";
import { ActionTarget, MAX_REJECTION_REASON_LENGTH, User } from "../types";
import { errorMessageForCode, getActionId } from "../utils";

export function useUserApprovalActions({
  items,
  setItems,
  page,
  setPage,
  refreshAfterDecision,
  showNotification,
  tUsers,
}: {
  items: User[];
  setItems: Dispatch<SetStateAction<User[]>>;
  page: number;
  setPage: (updater: (prev: number) => number) => void;
  refreshAfterDecision: () => Promise<void>;
  showNotification: (type: "success" | "error", message: string) => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const [actionTarget, setActionTarget] = useState<ActionTarget>(null);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  async function handleDecisionError(error: unknown) {
    const code = getApprovalErrorCode(error);
    const status = (error as { response?: { status?: number } })?.response
      ?.status;

    if (status === 404 || status === 409) {
      await refreshAfterDecision();
    }

    showNotification("error", errorMessageForCode(code, tUsers));
  }

  function openApprove(user: User) {
    setActionTarget({ type: "approve", user });
  }

  function openReject(user: User) {
    setReason("");
    setReasonError("");
    setActionTarget({ type: "reject", user });
  }

  function closeActionDialog() {
    if (rowActionId) return;
    setActionTarget(null);
    setReason("");
    setReasonError("");
  }

  async function confirmApprove() {
    if (actionTarget?.type !== "approve") return;
    const actionId = getActionId(actionTarget.user);
    if (!actionId || rowActionId) return;

    setRowActionId(actionId);
    try {
      const response = await approveUserAccount(actionId);
      const code = response.data?.code;
      setActionTarget(null);
      showNotification(
        "success",
        code === "ACCOUNT_ALREADY_APPROVED"
          ? tUsers("approvals.messages.alreadyApproved")
          : tUsers("approvals.messages.approved"),
      );
      await refreshAfterDecision();
      if (items.length === 1 && page > 1) setPage((prev) => prev - 1);
    } catch (error) {
      await handleDecisionError(error);
    } finally {
      setRowActionId(null);
    }
  }

  async function confirmReject() {
    if (actionTarget?.type !== "reject") return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError(tUsers("approvals.validation.reasonRequired"));
      return;
    }
    if (trimmedReason.length > MAX_REJECTION_REASON_LENGTH) {
      setReasonError(tUsers("approvals.validation.reasonMax"));
      return;
    }

    const actionId = getActionId(actionTarget.user);
    if (!actionId || rowActionId) return;

    setRowActionId(actionId);
    try {
      const response = await rejectUserAccount(actionId, trimmedReason);
      const code = response.data?.code;
      setActionTarget(null);
      setReason("");
      setReasonError("");
      showNotification(
        "success",
        code === "ACCOUNT_REJECTION_UPDATED"
          ? tUsers("approvals.messages.rejectionUpdated")
          : tUsers("approvals.messages.rejected"),
      );
      await refreshAfterDecision();
      if (items.length === 1 && page > 1) setPage((prev) => prev - 1);
    } catch (error) {
      await handleDecisionError(error);
    } finally {
      setRowActionId(null);
    }
  }

  async function toggleAccountActive(user: User) {
    const actionId = getActionId(user);
    if (!actionId || rowActionId) return;

    const action = user.is_active ? "deactivate" : "reactivate";
    if (
      !window.confirm(
        tUsers(`activation.confirm.${action}`, {
          name: user.nom_complet || user.email,
        }),
      )
    ) {
      return;
    }

    setRowActionId(actionId);
    try {
      const response = user.is_active
        ? await deactivateUserAccount(actionId)
        : await reactivateUserAccount(actionId);
      const code = response.data?.code;
      const updatedUser = response.data?.user as User | undefined;

      setItems((currentItems) =>
        currentItems.map((currentUser) =>
          getActionId(currentUser) === actionId
            ? {
                ...currentUser,
                ...(updatedUser ?? {}),
                is_active: updatedUser?.is_active ?? !user.is_active,
              }
            : currentUser,
        ),
      );
      showNotification(
        "success",
        code === "ACCOUNT_ALREADY_INACTIVE" || code === "ACCOUNT_ALREADY_ACTIVE"
          ? tUsers("activation.messages.alreadyUpdated")
          : tUsers(`activation.messages.${action}d`),
      );
      await refreshAfterDecision();
    } catch (error) {
      await handleDecisionError(error);
    } finally {
      setRowActionId(null);
    }
  }

  return {
    actionTarget,
    rowActionId,
    reason,
    setReason,
    reasonError,
    setReasonError,
    openApprove,
    openReject,
    closeActionDialog,
    confirmApprove,
    confirmReject,
    toggleAccountActive,
  };
}
