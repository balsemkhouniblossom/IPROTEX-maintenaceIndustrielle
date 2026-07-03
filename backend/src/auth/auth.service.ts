import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Role, User, UserDocument } from '../schemas/user.schema';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { NotificationsFacade } from '../notifications/notifications.facade';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { AppConfigService } from '../config/app.config';

interface JwtPayload {
  email: string;
  sub: string;
  role: string;
  user_id: string;
}

export interface LoginResult {
  access_token: string;
  token: string;
  refresh_token: string;
  user: UserWithoutSensitiveData;
}

export interface UserWithoutSensitiveData {
  _id: Types.ObjectId;
  user_id: string;
  nom_complet: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login?: Date;
  login_history?: Date[];
  created_at: Date;
  phone?: string;
  department?: string;
  photo?: string;
}

export interface GoogleUserProfile {
  google_id?: string;
  email: string;
  name: string;
  picture?: string;
}

const toJwtExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private readonly notificationsFacade: NotificationsFacade,
    private readonly configService: ConfigService,
    private readonly appConfigService: AppConfigService,
    private readonly emailVerificationTokenService: EmailVerificationTokenService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserWithoutSensitiveData> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_verified) {
      throw new UnauthorizedException('Please verify your email first');
    }
    const updatedUser = await this.usersService.recordSuccessfulLogin(
      user._id.toString(),
    );

    const userObj = (updatedUser ?? user).toObject() as Record<string, unknown>;
    // Remove sensitive fields
    delete userObj.password;
    delete userObj.reset_password_token;
    delete userObj.reset_password_expires;
    delete userObj.refresh_token_hash;
    return userObj as unknown as UserWithoutSensitiveData;
  }
  async verifyEmail(token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('Verification token is required');
    }

    try {
      const payload = this.emailVerificationTokenService.verifyToken(token);

      if (!payload.userId) {
        throw new BadRequestException('Invalid or expired verification token');
      }

      const user = await this.userModel.findById(payload.userId);

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.is_verified) {
        return { message: 'Email already verified' };
      }

      await this.userModel.findByIdAndUpdate(payload.userId, {
        is_verified: true,
        is_active: true,
      });

      return { message: 'Email verified successfully' };
    } catch {
      throw new BadRequestException('Invalid or expired verification token');
    }
  }
  async login(user: UserDocument): Promise<LoginResult> {
    const accessExpiresIn =
      process.env.JWT_EXPIRES_IN ?? process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

    const payload = {
      email: user.email,
      sub: user._id.toString(),
      role: user.role,
      user_id: user.user_id,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: toJwtExpiresIn(accessExpiresIn),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: toJwtExpiresIn(refreshExpiresIn),
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.setRefreshTokenHash(user._id.toString(), refreshTokenHash);

    return {
      access_token: accessToken,
      token: accessToken,
      refresh_token: refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  async refreshToken(token: string): Promise<LoginResult> {
    if (!token?.trim()) {
      throw new UnauthorizedException('Missing refresh token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findOne(payload.sub);
    if (!user?.refresh_token_hash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isTokenValid = await bcrypt.compare(token, user.refresh_token_hash);
    if (!isTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.login(user);
  }

  async register(userData: CreateUserDto): Promise<UserDocument> {
    const existingUser = await this.usersService.findByEmail(userData.email);

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const newUser = await this.usersService.create({
      ...userData,
    });

    const verificationToken = this.emailVerificationTokenService.issueToken(
      newUser._id.toString(),
    );

    try {
      await this.notificationsFacade.sendVerificationEmail({
        to: newUser.email,
        token: verificationToken,
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(
        `Verification email failed: ${error?.message || error}`,
      );

      // Best effort rollback to avoid leaving an account that cannot be verified.
      await this.userModel.findByIdAndDelete(newUser._id).exec();

      throw new ServiceUnavailableException(
        'Email service failed. Please try again later.',
      );
    }
    return newUser;
  }

  async forgotPassword(
    email: string,
    locale?: string,
    frontendOrigin?: string,
  ) {
    const user = await this.usersService.findByEmail(email);
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = this.hashResetToken(resetToken);
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    let previewUrl: string | undefined;

    if (user) {
      await this.setPasswordResetToken(
        user._id.toString(),
        resetTokenHash,
        resetExpires,
      );

      previewUrl = await this.notificationsFacade.sendResetPasswordEmail({
        to: user.email,
        resetToken,
        locale:
          locale ?? this.configService.get<string>('DEFAULT_LOCALE') ?? 'en',
        frontendOrigin,
      });
    }

    const response: {
      message: string;
      previewUrl?: string;
    } = {
      message:
        'If an account exists with that email, a password reset link has been sent.',
    };

    if (previewUrl) {
      response.previewUrl = previewUrl;
    }

    return response;
  }

  async verifyResetToken(token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('Reset token is required');
    }

    const user = await this.findUserByResetToken(token);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    return { message: 'Reset token is valid' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.findUserByResetToken(dto.token);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    await this.updatePasswordAndClearReset(user._id.toString(), hashedPassword);

    return {
      message: 'Password has been reset successfully',
    };
  }

  async logout(userId: string): Promise<{ message: string }> {
    await this.setRefreshTokenHash(userId, null);

    return { message: 'Logged out successfully' };
  }

  async googleLogin(
    googleUser: GoogleUserProfile,
    res: Response,
    locale = 'en',
    frontendOrigin?: string,
  ) {
    if (!googleUser.email) {
      throw new UnauthorizedException('Google authentication failed');
    }

    let user = await this.usersService.findByEmail(googleUser.email);
    if (user && !user.google_id) {
      user.google_id = googleUser.google_id;
      await user.save();
    }
    if (!user) {
      user = await this.usersService.create({
        nom_complet: googleUser.name,
        email: googleUser.email,
        role: Role.OPERATOR,
        is_verified: true,
        is_active: true,
        google_id: googleUser.google_id,
        photo: googleUser.picture,
      });
    }

    const loginResult = await this.login(user);
    const frontendBaseUrl = this.appConfigService
      .resolveFrontendBaseUrl(frontendOrigin)
      .replace(/\/$/, '');

    const encodedUser = encodeURIComponent(JSON.stringify(loginResult.user));

    res.clearCookie('google_auth_origin', {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      path: '/',
    });

    return res.redirect(
      `${frontendBaseUrl}/${locale}/auth/success?token=${encodeURIComponent(loginResult.access_token)}&user=${encodedUser}`,
    );
  }

  private sanitizeUser(user: UserDocument): UserWithoutSensitiveData {
    const userObj = user.toObject() as Record<string, unknown>;

    delete userObj.password;
    delete userObj.reset_password_token;
    delete userObj.reset_password_expires;
    delete userObj.refresh_token_hash;

    return userObj as unknown as UserWithoutSensitiveData;
  }

  private async setRefreshTokenHash(
    userId: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(
        userId,
        { refresh_token_hash: refreshTokenHash },
        { new: true },
      )
      .exec();
  }

  private async setPasswordResetToken(
    userId: string,
    resetToken: string,
    resetExpires: Date,
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          reset_password_token: resetToken,
          reset_password_expires: resetExpires,
        },
        { new: true },
      )
      .exec();
  }

  private async updatePasswordAndClearReset(
    userId: string,
    password: string,
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          password,
          reset_password_token: null,
          reset_password_expires: null,
          refresh_token_hash: null,
        },
        { new: true },
      )
      .exec();
  }

  private hashResetToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async findUserByResetToken(
    token: string,
  ): Promise<UserDocument | null> {
    const tokenHash = this.hashResetToken(token);

    const user = await this.userModel
      .findOne({
        reset_password_token: tokenHash,
        reset_password_expires: { $gt: new Date() },
      })
      .exec();

    if (user) {
      return user;
    }

    // Legacy compatibility: support plaintext reset tokens issued before hashing rollout.
    const legacyUser = await this.userModel
      .findOne({
        reset_password_token: token,
        reset_password_expires: { $gt: new Date() },
      })
      .exec();

    if (legacyUser) {
      this.logger.warn(
        `Found legacy plaintext reset token for user ${legacyUser._id.toString()}`,
      );
    }

    return legacyUser;
  }
}
