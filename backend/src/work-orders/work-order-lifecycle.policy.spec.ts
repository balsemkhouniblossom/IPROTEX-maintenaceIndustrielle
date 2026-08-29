import { ConflictException } from '@nestjs/common';
import {
  EXTRACTED_LIFECYCLE_ACTIONS,
  WORK_ORDER_TRANSITIONS,
  assertTransitionAllowed,
  transitionPlan,
  validationTransitionPlan,
} from './work-order-lifecycle.policy';

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

describe('work-order lifecycle policy', () => {
  const expectedActions = [
    'operator_start',
    'operator_complete',
    'technician_start',
    'technician_waiting_parts',
    'technician_resume',
    'technician_close',
    'validation_approve',
    'validation_reject',
    'validation_request_correction',
  ] as const;

  it('has a transition definition for every extracted lifecycle action', () => {
    expect(EXTRACTED_LIFECYCLE_ACTIONS.sort(compareStrings)).toEqual(
      [...expectedActions].sort(compareStrings),
    );

    for (const action of expectedActions) {
      expect(WORK_ORDER_TRANSITIONS[action]).toEqual(
        expect.objectContaining({
          from: expect.any(Array),
          to: expect.any(String),
          allowedRoles: expect.any(Array),
        }),
      );
    }
  });

  it.each([
    {
      action: 'operator_start',
      allowed: ['scheduled', 'overdue', 'pending'],
      rejected: ['in_progress', 'waiting_validation', 'validated'],
      to: 'in_progress',
      role: 'operator',
      relationship: 'operator_owner',
      timestamps: ['date_start'],
      historyAction: undefined,
    },
    {
      action: 'operator_complete',
      allowed: ['in_progress'],
      rejected: ['scheduled', 'waiting_validation', 'validated'],
      to: 'waiting_validation',
      role: 'operator',
      relationship: 'operator_owner',
      timestamps: ['date_end'],
      historyAction: undefined,
    },
    {
      action: 'technician_start',
      allowed: [
        'waiting_validation',
        'technician_required',
        'assigned',
        'returned',
      ],
      rejected: ['scheduled', 'waiting_parts', 'validated'],
      to: 'in_progress',
      role: 'technician',
      relationship: 'assigned_technician',
      timestamps: ['date_start'],
      historyAction: undefined,
    },
    {
      action: 'technician_waiting_parts',
      allowed: ['in_progress'],
      rejected: ['assigned', 'waiting_parts', 'validated'],
      to: 'waiting_parts',
      role: 'technician',
      relationship: 'assigned_technician',
      timestamps: undefined,
      historyAction: undefined,
    },
    {
      action: 'technician_resume',
      allowed: ['waiting_parts'],
      rejected: ['assigned', 'in_progress', 'validated'],
      to: 'in_progress',
      role: 'technician',
      relationship: 'assigned_technician',
      timestamps: undefined,
      historyAction: undefined,
    },
    {
      action: 'technician_close',
      allowed: ['in_progress'],
      rejected: ['assigned', 'waiting_parts', 'validated'],
      to: 'waiting_validation',
      role: 'technician',
      relationship: 'assigned_technician',
      timestamps: ['date_end', 'date_closed'],
      historyAction: 'closed_for_validation',
    },
  ] as const)(
    'describes and validates $action transitions',
    ({
      action,
      allowed,
      rejected,
      to,
      role,
      relationship,
      timestamps,
      historyAction,
    }) => {
      const plan = transitionPlan(action);

      expect(plan.to).toBe(to);
      expect(plan.allowedRoles).toContain(role);
      expect(plan.requiredRelationship).toBe(relationship);
      expect(plan.timestampFields).toEqual(timestamps);
      expect(plan.historyAction).toBe(historyAction);

      for (const status of allowed) {
        expect(() => assertTransitionAllowed(status, plan)).not.toThrow();
      }
      for (const status of rejected) {
        expect(() => assertTransitionAllowed(status, plan)).toThrow(
          ConflictException,
        );
      }
    },
  );

  it.each([
    ['approve', 'validation_approve', 'validated', 'validated'],
    ['reject', 'validation_reject', 'rejected', 'rejected'],
    [
      'request_correction',
      'validation_request_correction',
      'returned',
      'returned',
    ],
  ] as const)(
    'maps validation action %s to the canonical policy definition',
    (action, policyAction, to, historyAction) => {
      expect(validationTransitionPlan(action)).toBe(
        WORK_ORDER_TRANSITIONS[policyAction],
      );
      expect(validationTransitionPlan(action)).toEqual(
        expect.objectContaining({
          to,
          historyAction,
          allowedRoles: expect.arrayContaining(['admin', 'technician']),
          requiredRelationship: 'validator',
        }),
      );
    },
  );
});
