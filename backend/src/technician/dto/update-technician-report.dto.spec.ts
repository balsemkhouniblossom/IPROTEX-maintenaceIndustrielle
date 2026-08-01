import { validate } from 'class-validator';
import { UpdateTechnicianReportDto } from './update-technician-report.dto';

function dto(overrides: Partial<UpdateTechnicianReportDto> = {}) {
  return Object.assign(new UpdateTechnicianReportDto(), overrides);
}

describe('UpdateTechnicianReportDto', () => {
  it('accepts an empty body — every field is optional', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('accepts all three fields populated', async () => {
    await expect(
      validate(
        dto({
          cause_racine: 'Worn bearing',
          description_action: 'Replaced bearing',
          etat_final: 'Operational',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects a value over 2000 characters', async () => {
    const errors = await validate(dto({ cause_racine: 'x'.repeat(2001) }));
    expect(errors.map((e) => e.property)).toContain('cause_racine');
  });

  it('rejects a non-string value', async () => {
    const errors = await validate(
      dto({ description_action: 42 as unknown as string }),
    );
    expect(errors.map((e) => e.property)).toContain('description_action');
  });

  it('rejects an unexpected/protected field under whitelist+forbidNonWhitelisted', async () => {
    const instance = Object.assign(dto(), {
      technician_id: 'someone-elses-id',
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toContain('technician_id');
  });
});
