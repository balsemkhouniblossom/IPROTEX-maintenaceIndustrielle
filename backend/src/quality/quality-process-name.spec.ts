import { normalizeQualityProcessName } from './quality-process-name';

describe('Quality process name normalization', () => {
  it.each([
    ['Bobinage', 'Winding'],
    ['Tressage', 'Braiding'],
    ['Coupage', 'Cutting'],
    ['Enroulement', 'Rolling'],
    ['Extrusion', 'Extrusion'],
  ])('maps %s to %s', (source, expected) => {
    expect(normalizeQualityProcessName(source)).toBe(expected);
  });
});
