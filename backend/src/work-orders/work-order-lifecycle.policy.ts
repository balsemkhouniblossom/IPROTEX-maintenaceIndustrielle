import { BadRequestException, ConflictException } from '@nestjs/common';

export type LifecycleActorRole = 'admin' | 'technician' | 'operator';
export type TransitionRelationship =
  | 'assigned_technician'
  | 'operator_owner'
  | 'validator';
export type TransitionName =
  | 'operator_start'
  | 'operator_complete'
  | 'technician_start'
  | 'technician_waiting_parts'
  | 'technician_resume'
  | 'technician_close'
  | 'validation_approve'
  | 'validation_reject'
  | 'validation_request_correction';

export interface TransitionPlan {
  from: string[];
  to: string;
  allowedRoles?: LifecycleActorRole[];
  requiredRelationship?: TransitionRelationship;
  requiredFields?: string[];
  timestampFields?: Array<'date_start' | 'date_end' | 'date_closed'>;
  historyAction?:
    | 'closed_for_validation'
    | 'validated'
    | 'rejected'
    | 'returned';
  requiresExternalOrchestration?: boolean;
}

export const WORK_ORDER_TRANSITIONS: Record<TransitionName, TransitionPlan> = {
  operator_start: {
    from: ['scheduled', 'overdue', 'pending'],
    to: 'in_progress',
    allowedRoles: ['operator'],
    requiredRelationship: 'operator_owner',
    timestampFields: ['date_start'],
  },
  operator_complete: {
    from: ['in_progress'],
    to: 'waiting_validation',
    allowedRoles: ['operator'],
    requiredRelationship: 'operator_owner',
    timestampFields: ['date_end'],
    requiresExternalOrchestration: true,
  },
  technician_start: {
    from: ['waiting_validation', 'technician_required', 'assigned', 'returned'],
    to: 'in_progress',
    allowedRoles: ['technician'],
    requiredRelationship: 'assigned_technician',
    timestampFields: ['date_start'],
    requiresExternalOrchestration: true,
  },
  technician_waiting_parts: {
    from: ['in_progress'],
    to: 'waiting_parts',
    allowedRoles: ['technician'],
    requiredRelationship: 'assigned_technician',
  },
  technician_resume: {
    from: ['waiting_parts'],
    to: 'in_progress',
    allowedRoles: ['technician'],
    requiredRelationship: 'assigned_technician',
  },
  technician_close: {
    from: ['in_progress'],
    to: 'waiting_validation',
    allowedRoles: ['technician'],
    requiredRelationship: 'assigned_technician',
    requiredFields: ['description_action', 'etat_final'],
    timestampFields: ['date_end', 'date_closed'],
    historyAction: 'closed_for_validation',
    requiresExternalOrchestration: true,
  },
  validation_approve: {
    from: ['waiting_validation'],
    to: 'validated',
    allowedRoles: ['admin', 'technician'],
    requiredRelationship: 'validator',
    historyAction: 'validated',
    requiresExternalOrchestration: true,
  },
  validation_reject: {
    from: ['waiting_validation'],
    to: 'rejected',
    allowedRoles: ['admin', 'technician'],
    requiredRelationship: 'validator',
    historyAction: 'rejected',
    requiresExternalOrchestration: true,
  },
  validation_request_correction: {
    from: ['waiting_validation'],
    to: 'returned',
    allowedRoles: ['admin', 'technician'],
    requiredRelationship: 'validator',
    historyAction: 'returned',
    requiresExternalOrchestration: true,
  },
};

export const EXTRACTED_LIFECYCLE_ACTIONS = Object.keys(
  WORK_ORDER_TRANSITIONS,
) as TransitionName[];

export function transitionPlan(name: TransitionName): TransitionPlan {
  return WORK_ORDER_TRANSITIONS[name];
}

export function validationTransitionPlan(
  action: 'approve' | 'reject' | 'request_correction',
): TransitionPlan {
  if (action === 'approve') {
    return transitionPlan('validation_approve');
  }
  if (action === 'reject') {
    return transitionPlan('validation_reject');
  }
  if (action === 'request_correction') {
    return transitionPlan('validation_request_correction');
  }
  throw new BadRequestException('Invalid validation action');
}

export function assertTransitionAllowed(
  currentStatus: string | undefined,
  plan: TransitionPlan,
): void {
  if (!plan.from.length) return;
  if (!currentStatus || !plan.from.includes(currentStatus)) {
    throw new ConflictException('Invalid work-order status transition');
  }
}
