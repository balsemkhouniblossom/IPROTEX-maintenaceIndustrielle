import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { LocalStrategy } from './local.strategy';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { EmailModule } from '../email/email.module';
import { User, UserSchema } from '../schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppConfigService } from '../config/app.config';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { GoogleLoginExchangeService } from './google-login-exchange.service';
import {
  GoogleLoginExchange,
  GoogleLoginExchangeSchema,
} from './schemas/google-login-exchange.schema';
import { FileStorageModule } from '../storage/file-storage.module';
import { AuthThrottleService } from './auth-throttle.service';
import {
  AUTH_THROTTLE_STORE,
  InMemoryAuthThrottleStore,
} from './auth-throttle-store';

function resolveJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();
  if (secret) {
    return secret;
  }

  if ((process.env.NODE_ENV ?? 'development') === 'test') {
    return 'test-jwt-secret';
  }

  throw new Error(
    'Missing required environment variable: JWT_SECRET (required by JwtModule)',
  );
}

@Module({
  imports: [
    UsersModule,
    FileStorageModule,
    EmailModule,
    NotificationsModule,
    ConfigModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: GoogleLoginExchange.name, schema: GoogleLoginExchangeSchema },
    ]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: resolveJwtSecret(configService),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ??
            configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
            '15m') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    AppConfigService,
    FeatureFlagsConfigService,
    EmailVerificationTokenService,
    GoogleLoginExchangeService,
    { provide: AUTH_THROTTLE_STORE, useClass: InMemoryAuthThrottleStore },
    AuthThrottleService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
