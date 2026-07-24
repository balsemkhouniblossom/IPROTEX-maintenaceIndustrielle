import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import type { UserWithoutSensitiveData } from './auth.service';
import type { Request } from 'express';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private readonly authThrottleService: AuthThrottleService,
  ) {
    super({
      usernameField: 'email',
      passReqToCallback: true,
    });
  }

  async validate(
    request: Request,
    email: string,
    password: string,
  ): Promise<UserWithoutSensitiveData> {
    await this.authThrottleService.consume('login', request, { email });

    try {
      const user = await this.authService.validateUser(email, password);

      if (!user) {
        throw new UnauthorizedException();
      }

      this.authThrottleService.recordSuccess('login', request, { email });
      return user;
    } catch (error) {
      this.authThrottleService.recordFailure('login', request, { email });
      throw error;
    }
  }
}
