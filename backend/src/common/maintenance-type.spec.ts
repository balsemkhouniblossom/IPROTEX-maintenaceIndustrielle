import {
  isCorrectiveMaintenanceType,
  isSchedulableMaintenanceType,
  NOT_CORRECTIVE_TYPE_FILTER,
} from './maintenance-type';

describe('isCorrectiveMaintenanceType', () => {
  it.each([
    ['corrective', true],
    ['Corrective', true],
    ['CORRECTIVE ', true],
    ['correctif', true],
    ['preventive', false],
    ['lubrication', false],
    ['inspection', false],
    ['annual-calibration', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('%s -> %s', (type, expected) => {
    expect(isCorrectiveMaintenanceType(type as string | undefined)).toBe(
      expected,
    );
  });
});

describe('isSchedulableMaintenanceType', () => {
  it.each([
    ['preventive', true],
    ['lubrication', true],
    ['inspection', true],
    ['annual-calibration', true],
    ['corrective', false],
    ['Corrective', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('%s -> %s', (type, expected) => {
    expect(isSchedulableMaintenanceType(type as string | undefined)).toBe(
      expected,
    );
  });
});

describe('NOT_CORRECTIVE_TYPE_FILTER', () => {
  it('is a Mongo filter fragment excluding corrective by regex', () => {
    expect(NOT_CORRECTIVE_TYPE_FILTER).toEqual({
      type_maintenance: { $not: /correct/i },
    });
  });
});
