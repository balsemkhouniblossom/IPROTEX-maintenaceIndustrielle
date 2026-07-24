import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  user_id: string;
}

function resolveJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();
  if (secret) {
    return secret;
  }

  if ((process.env.NODE_ENV ?? 'development') === 'test') {
    return 'test-jwt-secret';
  }

  throw new Error(
    'Missing required environment variable: JWT_SECRET (required by JwtStrategy)',
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    const secret = resolveJwtSecret(configService);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userModel
      .findById(payload.sub)
      .select(
        'email role user_id is_active is_verified approval_status profile_completed',
      )
      .exec();

    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATED_USER_NOT_FOUND',
        message: 'Authenticated user was not found.',
      });
    }

    return {
      userId: payload.sub,
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      is_active: user.is_active,
      is_verified: user.is_verified,
      approval_status: user.approval_status,
      profile_completed: user.profile_completed ?? true,
    };
  }
}
