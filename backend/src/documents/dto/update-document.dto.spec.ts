import { validate } from 'class-validator';
import { UpdateDocumentDto } from './update-document.dto';

describe('UpdateDocumentDto', () => {
  it('rejects uploaded_by — it must never be retroactively editable via PUT /documents/:id', async () => {
    const instance = Object.assign(new UpdateDocumentDto(), {
      description: 'Updated description',
      uploaded_by: 'someone-else-entirely',
    }) as UpdateDocumentDto & { uploaded_by: string };

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((e) => e.property)).toContain('uploaded_by');
  });

  it('still accepts a legitimate partial update with expected_version', async () => {
    const instance = Object.assign(new UpdateDocumentDto(), {
      description: 'Updated description',
      expected_version: 3,
    });

    await expect(
      validate(instance, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });
});
