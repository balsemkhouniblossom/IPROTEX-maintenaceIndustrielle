import {
  MachineTimelineCategory,
  MachineTimelineEvent,
  MachineTimelineEventType,
} from '../machine-timeline.types';
import { toMachineTimelineEventResponse } from './machine-timeline-event.mapper';
import { assertEveryMachineTimelineEventTypeIsCovered } from './machine-timeline-event-response.types';

function baseEvent(
  overrides: Partial<MachineTimelineEvent>,
): MachineTimelineEvent {
  return {
    id: 'evt-1',
    type: MachineTimelineEventType.MACHINE_CREATED,
    category: MachineTimelineCategory.SYSTEM,
    at: new Date('2026-01-01T00:00:00.000Z'),
    title: 'Test event',
    ...overrides,
  };
}

describe('toMachineTimelineEventResponse', () => {
  it('is exhaustive over every MachineTimelineEventType member (compile-time + runtime proof)', () => {
    for (const type of Object.values(MachineTimelineEventType)) {
      expect(() =>
        assertEveryMachineTimelineEventTypeIsCovered(type),
      ).not.toThrow();
    }
  });

  it('serializes `at` to an ISO string, matching the previous implicit JSON.stringify(Date) behavior', () => {
    const event = baseEvent({ metadata: { machineCode: 'MCH-1' } });
    const response = toMachineTimelineEventResponse(event);
    expect(response.at).toBe(event.at.toISOString());
    expect(typeof response.at).toBe('string');
  });

  it('narrows a system event into SystemTimelineEventResponse with typed metadata', () => {
    const event = baseEvent({
      type: MachineTimelineEventType.MACHINE_STATUS_CHANGED,
      category: MachineTimelineCategory.SYSTEM,
      metadata: { fromStatus: 'inactive', toStatus: 'active' },
    });
    const response = toMachineTimelineEventResponse(event);
    expect(response.type).toBe(MachineTimelineEventType.MACHINE_STATUS_CHANGED);
    expect(response.metadata).toEqual({
      machineCode: undefined,
      moduleCode: undefined,
      fromStatus: 'inactive',
      toStatus: 'active',
    });
  });

  it('narrows a work order event and preserves its preventive/corrective category', () => {
    const event = baseEvent({
      type: MachineTimelineEventType.WORK_ORDER_CREATED,
      category: MachineTimelineCategory.CORRECTIVE,
      metadata: { otId: 'WO-1', priority: 'high', faultCode: 'F-1' },
    });
    const response = toMachineTimelineEventResponse(event);
    expect(response.category).toBe(MachineTimelineCategory.CORRECTIVE);
    expect(response.metadata).toEqual({
      otId: 'WO-1',
      priority: 'high',
      faultCode: 'F-1',
      fromStatus: undefined,
      toStatus: undefined,
    });
  });

  it('narrows a fault event and excludes any metadata field not part of its declared shape', () => {
    const event = baseEvent({
      type: MachineTimelineEventType.FAULT_REPORTED,
      category: MachineTimelineCategory.FAULTS,
      metadata: { faultCode: 'F-1', severity: 'critical' },
    });
    const response = toMachineTimelineEventResponse(event);
    expect(Object.keys(response.metadata).sort()).toEqual(
      ['faultCode', 'severity'].sort(),
    );
  });

  it('narrows an AI recommendation event without leaking the underlying prompt/question text as metadata', () => {
    const event = baseEvent({
      type: MachineTimelineEventType.AI_RECOMMENDATION_GENERATED,
      category: MachineTimelineCategory.AI,
      description: 'What caused this fault?',
      metadata: {
        faultCode: 'F-1',
        provider: 'gemini',
        // Simulates a hypothetical future bug where the builder accidentally
        // stuffs extra data into metadata — the typed mapper must not surface it.
        rawPrompt: 'internal prompt the AI provider saw',
      },
    });
    const response = toMachineTimelineEventResponse(event);
    expect(response.metadata).toEqual({ faultCode: 'F-1', provider: 'gemini' });
    expect(response.metadata).not.toHaveProperty('rawPrompt');
  });

  it('degrades unknown/legacy event types to the safe fallback variant instead of throwing', () => {
    const event = baseEvent({
      type: 'some_future_event' as MachineTimelineEventType,
      category: MachineTimelineCategory.SYSTEM,
      metadata: { anything: 'goes' },
    });
    const response = toMachineTimelineEventResponse(event);
    expect(response.type).toBe('unknown');
    expect(response.metadata).toEqual({ anything: 'goes' });
  });

  it('never exposes Mongoose-internal fields on the event envelope', () => {
    const event = baseEvent({ metadata: { machineCode: 'MCH-1' } });
    const response = toMachineTimelineEventResponse(event);
    expect(response).not.toHaveProperty('__v');
    expect(response).not.toHaveProperty('_doc');
  });
});
