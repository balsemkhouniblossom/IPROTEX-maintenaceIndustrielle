import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import {
  buildCorsOriginDelegate,
  CorsOrigin,
  RuntimeMode,
  isAllowedCorsOrigin,
} from './cors-origin-policy';

export class SecureSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly options: {
      allowedOrigins: CorsOrigin[];
      nodeEnv: RuntimeMode;
    },
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>) {
    const serverOptions: Partial<ServerOptions> = {
      ...options,
      cors: {
        ...(typeof options?.cors === 'object' ? options.cors : {}),
        credentials: true,
        origin: buildCorsOriginDelegate(this.options.allowedOrigins, {
          allowOriginless: this.options.nodeEnv !== 'production',
        }),
      },
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        const allowed =
          (!origin && this.options.nodeEnv !== 'production') ||
          isAllowedCorsOrigin(origin, this.options.allowedOrigins);
        callback(null, allowed);
      },
      maxHttpBufferSize: Math.min(
        typeof options?.maxHttpBufferSize === 'number'
          ? options.maxHttpBufferSize
          : 100_000,
        100_000,
      ),
    };

    return super.createIOServer(port, serverOptions);
  }
}
