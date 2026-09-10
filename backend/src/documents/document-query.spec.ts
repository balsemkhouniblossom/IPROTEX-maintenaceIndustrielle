import { Types } from 'mongoose';
import {
  MANUAL_DOCUMENT_FILTER,
  documentMachineFilter,
} from './document-query';

describe('MANUAL_DOCUMENT_FILTER', () => {
  const clauses = MANUAL_DOCUMENT_FILTER.$or as Array<
    Record<string, { $regex: RegExp }>
  >;

  it.each(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])(
    'recognizes .%s from persisted file metadata',
    (extension) => {
      const fileClause = clauses.find((clause) => 'file_name' in clause);
      expect(
        fileClause?.file_name.$regex.test(`machine-manual.${extension}`),
      ).toBe(true);
    },
  );

  it.each(['manual', 'procedure', 'word', 'excel', 'powerpoint'])(
    'recognizes %s document types',
    (type) => {
      const typeClause = clauses.find((clause) => 'type_document' in clause);
      expect(typeClause?.type_document.$regex.test(type)).toBe(true);
    },
  );
});

describe('documentMachineFilter', () => {
  it('compares normalized identifier strings so ObjectId and legacy string links both match', () => {
    const machineId = new Types.ObjectId();

    expect(documentMachineFilter([machineId])).toEqual({
      $expr: {
        $in: [{ $toString: '$machine_id' }, [machineId.toHexString()]],
      },
    });
  });
});
