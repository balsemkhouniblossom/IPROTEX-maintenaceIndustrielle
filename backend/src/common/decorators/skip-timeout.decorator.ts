import { SetMetadata } from '@nestjs/common';

export const SKIP_TIMEOUT_KEY = 'skipTimeout';

/**
 * Exempts a route from the global request timeout interceptor. Reserved
 * for routes that legitimately take longer than the global default for a
 * reason other than a hung dependency — multipart uploads in particular,
 * where Multer streams/buffers the request body *inside* the intercepted
 * pipeline, so a slow (not stuck) client connection can outlast the
 * default. Those routes already have their own bound on request size via
 * Multer's `limits.fileSize`, which is the actual control for the risk a
 * timeout would otherwise be standing in for.
 */
export const SkipTimeout = () => SetMetadata(SKIP_TIMEOUT_KEY, true);
