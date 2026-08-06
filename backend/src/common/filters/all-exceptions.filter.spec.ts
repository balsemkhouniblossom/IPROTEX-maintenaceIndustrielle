import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = {
    method: 'POST',
    path: '/documents/upload',
    headers: {},
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('maps a Multer file-size MulterError to 413 instead of the generic 500', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = mockHost();
    const error = new MulterError('LIMIT_FILE_SIZE', 'file');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: 'Uploaded file exceeds the maximum allowed size',
      }),
    );
  });

  it('leaves other MulterError codes on the generic 500 path', () => {
    const filter = new AllExceptionsFilter();
    const { host, status } = mockHost();
    const error = new MulterError('LIMIT_UNEXPECTED_FILE', 'file');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('still maps ordinary HttpExceptions to their own status', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = mockHost();

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad input' }),
    );
  });

  it('falls back to a generic 500 for an unrecognized thrown value', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = mockHost();

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' }),
    );
  });
});
