import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  ApprovalStatus,
  Role,
  User,
  UserDocument,
} from '../schemas/user.schema';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { NotificationsFacade } from '../notifications/notifications.facade';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { AppConfigService } from '../config/app.config';
import { PublicRegistrationRole, RegisterDto } from './dto/register.dto';
import { resolveApprovalStatus } from '../users/approval-status.utils';
import {
  throwInvalidCredentials,
  validateAccountAccess,
  validateSessionRestoreAccess,
} from './account-access.validator';
import { AccountAccessErrorCode } from './account-access-error-code';
import { GoogleLoginExchangeService } from './google-login-exchange.service';
import { RefreshTokenErrorCode } from './refresh-token-error-code';
import {
  resolveUserPhotoUrl,
  shouldExposeUserAvatar,
} from '../users/user-photo-url';
import { FileStorageService } from '../storage/file-storage.service';
import {
  CompleteGoogleProfileDto,
  SUPPORTED_PROFILE_LANGUAGES,
} from './dto/complete-google-profile.dto';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';

interface JwtPayload {
  email?: string;
  sub: string;
  role: string;
  user_id?: string;
  type?: 'access' | 'refresh';
  jti?: string;
  iat?: number;
  persistent?: boolean;
}

export interface LoginResult {
  access_token: string;
  token: string;
  refresh_token: string;
  refresh_persistent: boolean;
  user: UserWithoutSensitiveData;
}

export interface UserWithoutSensitiveData {
  _id: Types.ObjectId;
  user_id?: string;
  nom_complet: string;
  email: string;
  role: string;
  is_active: boolean;
  is_verified?: boolean;
  approval_status?: ApprovalStatus;
  last_login?: Date;
  login_history?: Date[];
  created_at: Date;
  phone?: string;
  department?: string;
  position?: string;
  language?: string;
  photo?: string;
  photo_url?: string;
  photo_storage_path?: string;
  profile_completed?: boolean;
}

export interface GoogleUserProfile {
  google_id?: string;
  email: string;
  name: string;
  picture?: string;
  provider?: string;
  email_verified?: boolean;
}

export interface RegisterResult {
  success: true;
  code: 'ACCOUNT_CREATED_PENDING_APPROVAL';
  requiresEmailVerification: true;
  requiresAdminApproval: true;
  user: {
    email: string;
    role: Role.OPERATOR | Role.TECHNICIAN;
    is_verified: false;
    is_active: false;
    approval_status: ApprovalStatus.PENDING;
  };
  message: string;
}

export type VerifyEmailResult = {
  success: true;
  code:
    | 'EMAIL_VERIFIED_PENDING_APPROVAL'
    | 'EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL'
    | 'EMAIL_VERIFIED'
    | 'EMAIL_ALREADY_VERIFIED'
    | 'EMAIL_VERIFIED_ACCOUNT_REJECTED';
  emailVerified: true;
  requiresAdminApproval: boolean;
  message: string;
};

type SanitizableUser = UserDocument | UserWithoutSensitiveData;

type GoogleLoginStatus =
  | 'created-pending'
  | 'pending'
  | 'rejected'
  | 'inactive'
  | 'failed';

type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
};

const toJwtExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly notificationsFacade: NotificationsFacade,
    private readonly configService: ConfigService,
    private readonly appConfigService: AppConfigService,
    private readonly emailVerificationTokenService: EmailVerificationTokenService,
    private readonly googleLoginExchangeService: GoogleLoginExchangeService,
    private readonly fileStorageService: FileStorageService,
    private readonly featureFlags: FeatureFlagsConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserWithoutSensitiveData> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user?.password) {
      throwInvalidCredentials();
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throwInvalidCredentials();
    }

    validateAccountAccess(user);

    const updatedUser = await this.usersService.recordSuccessfulLogin(
      user._id.toString(),
    );

    const userObj = (updatedUser ?? user).toObject() as Record<string, unknown>;
    // Remove sensitive fields
    delete userObj.password;
    delete userObj.reset_password_token;
    delete userObj.reset_password_expires;
    delete userObj.refresh_token_hash;
    delete userObj.approved_by;
    delete userObj.rejected_by;
    return userObj as unknown as UserWithoutSensitiveData;
  }
  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    if (!token?.trim()) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        message: 'Invalid or expired verification token',
      });
    }

    const payload = this.emailVerificationTokenService.verifyToken(token);

    if (!payload.userId) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_TOKEN_INVALID_OR_EXPIRED',
        message: 'Invalid or expired verification token',
      });
    }

    const user = await this.userModel.findById(payload.userId).exec();

    if (!user) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.is_verified) {
      return this.buildVerificationResponse(user, true);
    }

    await this.userModel.findByIdAndUpdate(payload.userId, {
      is_verified: true,
    });

    const verifiedUser = {
      approval_status: user.approval_status,
      is_active: user.is_active,
      is_verified: true,
    };

    return this.buildVerificationResponse(verifiedUser, false);
  }
  async login(
    user: SanitizableUser,
    keepLoggedIn = true,
  ): Promise<LoginResult> {
    const { accessToken, refreshToken, refreshTokenHash } =
      await this.issueTokenPair(user, keepLoggedIn);
    await this.setRefreshTokenHash(user._id.toString(), refreshTokenHash);

    return {
      access_token: accessToken,
      token: accessToken,
      refresh_token: refreshToken,
      refresh_persistent: keepLoggedIn,
      user: await this.sanitizeUser(user),
    };
  }

  async refreshToken(token: string): Promise<LoginResult> {
    if (!token?.trim()) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_MISSING,
        'Refresh token is required.',
      );
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : '';
      throwRefreshTokenError(
        errorName === 'TokenExpiredError'
          ? RefreshTokenErrorCode.REFRESH_TOKEN_EXPIRED
          : RefreshTokenErrorCode.REFRESH_TOKEN_INVALID_OR_EXPIRED,
        'The refresh token is invalid or expired.',
      );
    }

    if (payload.type !== 'refresh') {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_WRONG_TYPE,
        'The submitted token cannot be used for refresh.',
      );
    }

    if (!payload.sub || !Types.ObjectId.isValid(payload.sub)) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_SUBJECT_INVALID,
        'The refresh token subject is invalid.',
      );
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_USER_NOT_FOUND,
        'The refresh token user no longer exists.',
      );
    }

    validateSessionRestoreAccess(user);

    if (
      user.credentials_invalidated_at &&
      typeof payload.iat === 'number' &&
      payload.iat * 1000 < user.credentials_invalidated_at.getTime()
    ) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_REVOKED,
        'The refresh token is no longer valid.',
      );
    }

    const storedRefreshHash = user.refresh_token_hash;
    if (!storedRefreshHash) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_REVOKED,
        'The refresh token is no longer valid.',
      );
    }

    const isTokenValid = await bcrypt.compare(
      this.hashRefreshToken(token),
      storedRefreshHash,
    );
    if (!isTokenValid) {
      throwRefreshTokenError(
        RefreshTokenErrorCode.REFRESH_TOKEN_REVOKED,
        'The refresh token is no longer valid.',
      );
    }

    const accessToken = this.issueAccessToken(user);

    return {
      access_token: accessToken,
      token: accessToken,
      refresh_token: token,
      refresh_persistent: payload.persistent !== false,
      user: await this.sanitizeRefreshUser(user),
    };
  }

  async register(
    userData: RegisterDto,
    locale?: string,
    frontendOrigin?: string,
  ): Promise<RegisterResult> {
    const normalizedEmail = userData.email.trim().toLowerCase();
    const publicRole = this.toPublicRole(userData.role);

    if (!publicRole) {
      throw new ForbiddenException({
        code: 'PUBLIC_ROLE_NOT_ALLOWED',
        message:
          'Public registration is limited to operator and technician accounts.',
      });
    }

    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email already registered',
      });
    }

    let newUser: UserDocument;
    try {
      newUser = await this.usersService.create({
        nom_complet: userData.nom_complet.trim(),
        email: normalizedEmail,
        password: userData.password,
        role: publicRole,
        phone: userData.phone,
        department: userData.department?.trim() || undefined,
        is_verified: false,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
      });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email already registered',
        });
      }

      throw new ServiceUnavailableException({
        code: 'REGISTRATION_FAILED',
        message: 'Registration failed. Please try again later.',
      });
    }

    const verificationToken = this.emailVerificationTokenService.issueToken(
      newUser._id.toString(),
    );

    try {
      await this.notificationsFacade.sendVerificationEmail({
        to: newUser.email,
        token: verificationToken,
        ...(locale ? { locale } : {}),
        ...(frontendOrigin ? { frontendOrigin } : {}),
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(
        `Verification email failed: ${error?.message || error}`,
      );

      // Best effort rollback to avoid leaving an account that cannot be verified.
      await this.userModel.findByIdAndDelete(newUser._id).exec();

      throw new ServiceUnavailableException({
        code: 'REGISTRATION_EMAIL_DELIVERY_FAILED',
        message: 'Email service failed. Please try again later.',
      });
    }
    return {
      success: true,
      code: 'ACCOUNT_CREATED_PENDING_APPROVAL',
      requiresEmailVerification: true,
      requiresAdminApproval: true,
      user: {
        email: newUser.email,
        role: publicRole,
        is_verified: false,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
      },
      message:
        'Your account was created successfully. Verify your email and wait for administrator approval before signing in.',
    };
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

      const preferredLocale =
        locale ?? this.configService.get<string>('DEFAULT_LOCALE') ?? 'en';

      if (this.shouldSendForgotPasswordEmailAsync()) {
        void this.sendResetPasswordEmailSafe(
          user.email,
          resetToken,
          preferredLocale,
          frontendOrigin,
        );
      } else {
        previewUrl = await this.sendResetPasswordEmailSafe(
          user.email,
          resetToken,
          preferredLocale,
          frontendOrigin,
        );
      }
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

  private shouldSendForgotPasswordEmailAsync(): boolean {
    const configured = process.env.FORGOT_PASSWORD_ASYNC_EMAIL?.trim();
    if (!configured) {
      return process.env.NODE_ENV === 'production';
    }

    return ['1', 'true', 'yes', 'on'].includes(configured.toLowerCase());
  }

  private async sendResetPasswordEmailSafe(
    to: string,
    resetToken: string,
    locale: string,
    frontendOrigin?: string,
  ): Promise<string | undefined> {
    try {
      return await this.notificationsFacade.sendResetPasswordEmail({
        to,
        resetToken,
        locale,
        frontendOrigin,
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(
        `Forgot-password email delivery failed: ${error?.message || error}`,
      );
      return undefined;
    }
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

  async logoutByRefreshToken(token: string): Promise<{ message: string }> {
    if (!token?.trim()) {
      return { message: 'Logged out successfully' };
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      return { message: 'Logged out successfully' };
    }

    if (
      payload.type !== 'refresh' ||
      !payload.sub ||
      !Types.ObjectId.isValid(payload.sub)
    ) {
      return { message: 'Logged out successfully' };
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user?.refresh_token_hash) {
      return { message: 'Logged out successfully' };
    }

    const isCurrentRefreshToken = await bcrypt.compare(
      this.hashRefreshToken(token),
      user.refresh_token_hash,
    );

    if (isCurrentRefreshToken) {
      await this.setRefreshTokenHash(user._id.toString(), null);
    }

    return { message: 'Logged out successfully' };
  }

  async googleLogin(
    googleUser: GoogleUserProfile,
    res: Response,
    locale = 'en',
    frontendOrigin?: string,
  ) {
    try {
      const profile = this.validateGoogleProfile(googleUser);
      const resolved = await this.resolveGoogleAccount(profile);
      const approvalStatus = resolveApprovalStatus(resolved.user);

      if (approvalStatus === ApprovalStatus.REJECTED) {
        return this.redirectGoogleResult(
          res,
          frontendOrigin,
          locale,
          'rejected',
        );
      }

      if (
        approvalStatus === ApprovalStatus.APPROVED &&
        !resolved.user.is_active
      ) {
        return this.redirectGoogleResult(
          res,
          frontendOrigin,
          locale,
          'inactive',
        );
      }

      if (!this.isGoogleProfileComplete(resolved.user)) {
        const profileUser = await this.markGoogleProfileIncomplete(
          resolved.user,
        );
        const updatedUser = await this.usersService.recordSuccessfulLogin(
          profileUser._id.toString(),
        );
        const loginResult = await this.login(updatedUser ?? profileUser);
        loginResult.user.profile_completed = false;
        const exchangeCode =
          await this.googleLoginExchangeService.createExchange(loginResult);

        return this.redirectGoogleExchange(
          res,
          frontendOrigin,
          locale,
          exchangeCode,
        );
      }

      try {
        validateAccountAccess(resolved.user);
      } catch (error) {
        const accessCode = this.extractAccountAccessCode(error);
        return this.redirectGoogleResult(
          res,
          frontendOrigin,
          locale,
          this.mapAccountAccessCodeToGoogleStatus(accessCode),
        );
      }

      const updatedUser = await this.usersService.recordSuccessfulLogin(
        resolved.user._id.toString(),
      );
      const loginResult = await this.login(updatedUser ?? resolved.user);
      const exchangeCode =
        await this.googleLoginExchangeService.createExchange(loginResult);

      return this.redirectGoogleExchange(
        res,
        frontendOrigin,
        locale,
        exchangeCode,
      );
    } catch (error) {
      this.logger.warn(
        `Google OAuth callback failed: ${this.extractSafeGoogleErrorCode(error)}`,
      );
      return this.redirectGoogleResult(res, frontendOrigin, locale, 'failed');
    }
  }

  async exchangeGoogleLogin(code: string) {
    return this.googleLoginExchangeService.consumeExchange(code);
  }

  redirectFailedGoogleLogin(
    res: Response,
    locale = 'en',
    frontendOrigin?: string,
  ) {
    return this.redirectGoogleResult(res, frontendOrigin, locale, 'failed');
  }

  private validateGoogleProfile(googleUser: GoogleUserProfile): GoogleProfile {
    if (googleUser.provider && googleUser.provider !== 'google') {
      throw new UnauthorizedException({
        code: 'GOOGLE_PROFILE_INVALID',
        message: 'Google profile is invalid.',
      });
    }

    if (!googleUser.google_id?.trim()) {
      throw new UnauthorizedException({
        code: 'GOOGLE_PROFILE_INVALID',
        message: 'Google profile is invalid.',
      });
    }

    if (!googleUser.email?.trim()) {
      throw new UnauthorizedException({
        code: 'GOOGLE_EMAIL_MISSING',
        message: 'Google account email is missing.',
      });
    }

    if (googleUser.email_verified === false) {
      throw new UnauthorizedException({
        code: 'GOOGLE_EMAIL_NOT_VERIFIED',
        message: 'Google account email is not verified.',
      });
    }

    const email = googleUser.email.trim().toLowerCase();

    return {
      googleId: googleUser.google_id.trim(),
      email,
      name: this.sanitizeGoogleDisplayName(googleUser.name, email),
      picture: this.sanitizeGooglePhotoUrl(googleUser.picture),
    };
  }

  private async resolveGoogleAccount(
    profile: GoogleProfile,
  ): Promise<{ user: UserDocument; created: boolean }> {
    const userByGoogleId = await this.usersService.findByGoogleId(
      profile.googleId,
    );
    const userByEmail = await this.usersService.findByEmail(profile.email);

    if (
      userByGoogleId &&
      userByEmail &&
      !userByGoogleId._id.equals(userByEmail._id)
    ) {
      throw new ConflictException({
        code: 'GOOGLE_ACCOUNT_CONFLICT',
        message: 'Google account cannot be linked automatically.',
      });
    }

    if (userByGoogleId) {
      if (userByGoogleId.email.trim().toLowerCase() !== profile.email) {
        throw new UnauthorizedException({
          code: 'GOOGLE_IDENTITY_MISMATCH',
          message: 'Google identity does not match this account.',
        });
      }

      return { user: userByGoogleId, created: false };
    }

    if (userByEmail) {
      const linkedUser = await this.usersService.linkGoogleIdentity(
        userByEmail._id.toString(),
        profile.googleId,
      );

      if (!linkedUser) {
        const conflictingUser = await this.usersService.findByGoogleId(
          profile.googleId,
        );
        if (conflictingUser && !conflictingUser._id.equals(userByEmail._id)) {
          throw new ConflictException({
            code: 'GOOGLE_ACCOUNT_CONFLICT',
            message: 'Google account cannot be linked automatically.',
          });
        }

        const refreshedUser = await this.usersService.findOne(
          userByEmail._id.toString(),
        );
        return { user: refreshedUser ?? userByEmail, created: false };
      }

      return { user: linkedUser, created: false };
    }

    const user = await this.usersService.create({
      nom_complet: profile.name,
      email: profile.email,
      role: Role.OPERATOR,
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
      profile_completed: false,
      google_id: profile.googleId,
      ...(profile.picture ? { photo: profile.picture } : {}),
    });

    return { user, created: true };
  }

  async completeGoogleProfile(
    userId: string,
    dto: CompleteGoogleProfileDto,
  ): Promise<{
    code:
      | 'GOOGLE_PROFILE_COMPLETED_PENDING_APPROVAL'
      | 'GOOGLE_PROFILE_COMPLETED';
    mandatoryFields: string[];
    user: UserWithoutSensitiveData;
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('Authentication failed');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user?.google_id) {
      throw new ForbiddenException({
        code: 'GOOGLE_PROFILE_COMPLETION_REQUIRED',
        message: 'Only Google accounts can complete a Google profile.',
      });
    }

    if (resolveApprovalStatus(user) === ApprovalStatus.REJECTED) {
      throw new ForbiddenException({
        code: AccountAccessErrorCode.ACCOUNT_REJECTED,
        message: 'Your account request was rejected.',
      });
    }

    // Once an administrator has approved this account, approval is
    // permanent and must survive profile edits: submitting/resubmitting the
    // Google profile form must never silently move an APPROVED account back
    // to PENDING, deactivate it, or erase its approved_by/approved_at audit
    // trail. Approval changes are only ever made through
    // UsersService.approveUser/rejectUser. That guarantee only applies once
    // an admin has actually made a decision — a brand-new Google signup that
    // has never been approved still needs to land in PENDING here so it
    // enters the admin approval queue.
    const alreadyApproved =
      resolveApprovalStatus(user) === ApprovalStatus.APPROVED;

    if (this.isGoogleProfileComplete(user)) {
      return {
        code: alreadyApproved
          ? 'GOOGLE_PROFILE_COMPLETED'
          : 'GOOGLE_PROFILE_COMPLETED_PENDING_APPROVAL',
        mandatoryFields: this.getMandatoryGoogleProfileFields(),
        user: await this.sanitizeRefreshUser(user),
      };
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            phone: dto.phone.trim(),
            role: dto.role,
            department: dto.department.trim(),
            language: dto.language,
            profile_completed: true,
            is_verified: true,
            ...(alreadyApproved
              ? {}
              : { approval_status: ApprovalStatus.PENDING, is_active: false }),
          },
          ...(alreadyApproved
            ? {}
            : {
                $unset: {
                  refresh_token_hash: '',
                  approved_by: '',
                  approved_at: '',
                  rejected_by: '',
                  rejected_at: '',
                  rejection_reason: '',
                },
              }),
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new UnauthorizedException('Authentication failed');
    }

    return {
      code: alreadyApproved
        ? 'GOOGLE_PROFILE_COMPLETED'
        : 'GOOGLE_PROFILE_COMPLETED_PENDING_APPROVAL',
      mandatoryFields: this.getMandatoryGoogleProfileFields(),
      user: await this.sanitizeRefreshUser(updated),
    };
  }

  getMandatoryGoogleProfileFields(): string[] {
    return ['nom_complet', 'email', 'phone', 'role', 'department', 'language'];
  }

  private isGoogleProfileComplete(user: UserDocument): boolean {
    if (user.profile_completed === false) return false;

    return Boolean(
      user.nom_complet?.trim() &&
      user.email?.trim() &&
      user.phone?.trim() &&
      (user.role === Role.OPERATOR || user.role === Role.TECHNICIAN) &&
      user.department?.trim() &&
      user.language?.trim() &&
      SUPPORTED_PROFILE_LANGUAGES.includes(
        user.language as (typeof SUPPORTED_PROFILE_LANGUAGES)[number],
      ),
    );
  }

  private async markGoogleProfileIncomplete(
    user: UserDocument,
  ): Promise<UserDocument> {
    if (user.profile_completed === false) return user;

    // Same rule as completeGoogleProfile: an account an administrator has
    // already approved must stay approved. Re-detecting an incomplete
    // profile (e.g. a required field no longer validates) is purely a
    // "needs profile info" signal, not an approval decision — it must not
    // silently move an APPROVED account back to PENDING, deactivate it, or
    // erase its approved_by/approved_at audit trail.
    const alreadyApproved =
      resolveApprovalStatus(user) === ApprovalStatus.APPROVED;

    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            profile_completed: false,
            is_verified: true,
            ...(alreadyApproved
              ? {}
              : { approval_status: ApprovalStatus.PENDING, is_active: false }),
          },
          ...(alreadyApproved
            ? {}
            : {
                $unset: {
                  refresh_token_hash: '',
                  approved_by: '',
                  approved_at: '',
                  rejected_by: '',
                  rejected_at: '',
                  rejection_reason: '',
                },
              }),
        },
        { new: true },
      )
      .exec();

    return updated ?? user;
  }

  private sanitizeGoogleDisplayName(
    name: string | undefined,
    email: string,
  ): string {
    const trimmedName = name?.trim();
    if (trimmedName) {
      return trimmedName;
    }

    const localPart = email
      .split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .trim();
    return localPart || 'Google User';
  }

  private sanitizeGooglePhotoUrl(photo?: string): string | undefined {
    if (!photo?.trim()) {
      return undefined;
    }

    try {
      const url = new URL(photo.trim());
      return url.protocol === 'https:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  private mapAccountAccessCodeToGoogleStatus(
    code?: AccountAccessErrorCode,
  ): GoogleLoginStatus {
    if (code === AccountAccessErrorCode.ACCOUNT_REJECTED) {
      return 'rejected';
    }

    if (code === AccountAccessErrorCode.ACCOUNT_INACTIVE) {
      return 'inactive';
    }

    if (code === AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL) {
      return 'pending';
    }

    return 'failed';
  }

  private extractAccountAccessCode(
    error: unknown,
  ): AccountAccessErrorCode | undefined {
    if (!(error instanceof HttpException)) {
      return undefined;
    }

    const response = error.getResponse();
    const code =
      typeof response === 'object' && response && 'code' in response
        ? (response as { code?: unknown }).code
        : undefined;

    return Object.values(AccountAccessErrorCode).includes(
      code as AccountAccessErrorCode,
    )
      ? (code as AccountAccessErrorCode)
      : undefined;
  }

  private extractSafeGoogleErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const code =
        typeof response === 'object' && response && 'code' in response
          ? (response as { code?: unknown }).code
          : undefined;
      return typeof code === 'string' ? code : error.constructor.name;
    }

    return error instanceof Error ? error.constructor.name : 'UnknownError';
  }

  private redirectGoogleExchange(
    res: Response,
    frontendOrigin: string | undefined,
    locale: string,
    exchangeCode: string,
  ) {
    const frontendBaseUrl = this.clearGoogleCookies(res, frontendOrigin);

    return res.redirect(
      `${frontendBaseUrl}/${locale}/auth/google-result?exchange=${encodeURIComponent(exchangeCode)}`,
    );
  }

  private redirectGoogleResult(
    res: Response,
    frontendOrigin: string | undefined,
    locale: string,
    status: GoogleLoginStatus,
  ) {
    const frontendBaseUrl = this.appConfigService
      .resolveFrontendBaseUrl(frontendOrigin)
      .replace(/\/$/, '');

    this.clearGoogleCookies(res, frontendOrigin);

    return res.redirect(
      `${frontendBaseUrl}/${locale}/auth/google-result?status=${status}`,
    );
  }

  private clearGoogleCookies(res: Response, frontendOrigin?: string): string {
    const frontendBaseUrl = this.appConfigService
      .resolveFrontendBaseUrl(frontendOrigin)
      .replace(/\/$/, '');
    res.clearCookie('google_auth_origin', {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      path: '/',
    });
    res.clearCookie('google_auth_state', {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      path: '/',
    });
    res.clearCookie('google_auth_locale', {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      path: '/',
    });

    return frontendBaseUrl;
  }

  private async sanitizeUser(
    user: SanitizableUser,
  ): Promise<UserWithoutSensitiveData> {
    const userObj =
      typeof (user as UserDocument).toObject === 'function'
        ? ((user as UserDocument).toObject() as Record<string, unknown>)
        : ({ ...user } as Record<string, unknown>);

    delete userObj.password;
    delete userObj.__v;
    delete userObj.reset_password_token;
    delete userObj.reset_password_expires;
    delete userObj.refresh_token_hash;
    delete userObj.approved_by;
    delete userObj.rejected_by;
    const photo = userObj.photo as string | null | undefined;
    const photoUrl = userObj.photo_url as string | null | undefined;
    const canExposeAvatar = shouldExposeUserAvatar(userObj);
    const resolvedPhoto = canExposeAvatar
      ? await this.fileStorageService.resolveUrl(photo, photoUrl)
      : null;
    if (canExposeAvatar && resolvedPhoto) {
      userObj.photo = resolveUserPhotoUrl(resolvedPhoto);
    } else {
      delete userObj.photo;
      delete userObj.photo_url;
    }

    return userObj as unknown as UserWithoutSensitiveData;
  }

  private async sanitizeRefreshUser(
    user: SanitizableUser,
  ): Promise<UserWithoutSensitiveData> {
    const userObj = (await this.sanitizeUser(user)) as unknown as Record<
      string,
      unknown
    >;

    delete userObj.user_id;
    delete userObj.google_id;
    delete userObj.login_history;
    delete userObj.approved_at;
    delete userObj.rejected_at;
    delete userObj.rejection_reason;

    return userObj as unknown as UserWithoutSensitiveData;
  }

  private async issueTokenPair(
    user: SanitizableUser,
    persistent: boolean,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
  }> {
    const refreshExpiresIn = persistent
      ? (process.env.JWT_PERSISTENT_REFRESH_EXPIRES_IN ??
        process.env.JWT_REFRESH_EXPIRES_IN ??
        '30d')
      : (process.env.JWT_SESSION_REFRESH_EXPIRES_IN ??
        process.env.JWT_REFRESH_EXPIRES_IN ??
        '1d');
    const accessToken = this.issueAccessToken(user);

    const refreshToken = this.jwtService.sign(
      {
        sub: user._id.toString(),
        type: 'refresh',
        jti: crypto.randomUUID(),
        persistent,
      },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: toJwtExpiresIn(refreshExpiresIn),
      },
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenHash: await bcrypt.hash(
        this.hashRefreshToken(refreshToken),
        10,
      ),
    };
  }

  private issueAccessToken(user: SanitizableUser): string {
    const accessExpiresIn =
      process.env.JWT_EXPIRES_IN ?? process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';

    return this.jwtService.sign(
      {
        email: user.email,
        sub: user._id.toString(),
        role: user.role,
        user_id: user.user_id,
        type: 'access',
        jti: crypto.randomUUID(),
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: toJwtExpiresIn(accessExpiresIn),
      },
    );
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
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
          must_reset_password: false,
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Admin-triggered equivalent of the self-service forgot-password flow,
   * for an account whose credentials must be treated as compromised (e.g.
   * it appeared in an exposed backup). Flags the account so
   * `validateAccountAccess` rejects it everywhere (login and every
   * subsequent authenticated request) until a new password is set, revokes
   * its stored refresh-token hash, and stamps `credentials_invalidated_at`
   * so any access/refresh token already issued to it — even one still
   * inside its normal expiry window — stops working on its very next use.
   * Then reuses `forgotPassword`'s own token generation + email delivery so
   * the account gets the exact same reset link a self-service request
   * would produce.
   */
  async forcePasswordReset(userId: string, frontendOrigin?: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id.',
      });
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    await this.userModel
      .findByIdAndUpdate(userId, {
        must_reset_password: true,
        credentials_invalidated_at: new Date(),
        refresh_token_hash: null,
      })
      .exec();

    await this.forgotPassword(user.email, user.language, frontendOrigin);

    return {
      code: 'PASSWORD_RESET_FORCED',
      message:
        'The account now requires a password reset; all of its active sessions were revoked.',
    };
  }

  private hashResetToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private toPublicRole(
    role: PublicRegistrationRole | string,
  ): Role.OPERATOR | Role.TECHNICIAN | null {
    const roleMap: Record<string, Role.OPERATOR | Role.TECHNICIAN> = {
      [PublicRegistrationRole.OPERATOR]: Role.OPERATOR,
      [PublicRegistrationRole.TECHNICIAN]: Role.TECHNICIAN,
    };

    return roleMap[String(role)] ?? null;
  }

  private buildVerificationResponse(
    user: Pick<UserDocument, 'approval_status' | 'is_active' | 'is_verified'>,
    alreadyVerified: boolean,
  ): VerifyEmailResult {
    const approvalStatus = resolveApprovalStatus(user);

    if (approvalStatus === ApprovalStatus.REJECTED) {
      return {
        success: true,
        code: 'EMAIL_VERIFIED_ACCOUNT_REJECTED',
        emailVerified: true,
        requiresAdminApproval: false,
        message:
          'Your email was verified, but the account request has been rejected.',
      };
    }

    if (approvalStatus === ApprovalStatus.APPROVED) {
      return {
        success: true,
        code: alreadyVerified ? 'EMAIL_ALREADY_VERIFIED' : 'EMAIL_VERIFIED',
        emailVerified: true,
        requiresAdminApproval: false,
        message: alreadyVerified
          ? 'Your email is already verified.'
          : 'Your email was verified successfully.',
      };
    }

    return {
      success: true,
      code: alreadyVerified
        ? 'EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL'
        : 'EMAIL_VERIFIED_PENDING_APPROVAL',
      emailVerified: true,
      requiresAdminApproval: true,
      message: alreadyVerified
        ? 'Your email is already verified. Your account is waiting for administrator approval.'
        : 'Your email was verified successfully. Your account is waiting for administrator approval.',
    };
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

    if (!this.featureFlags.isLegacyResetTokensEnabled()) {
      return null;
    }

    // Temporary migration compatibility: support plaintext reset tokens issued before hashing rollout.
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

function throwRefreshTokenError(
  code: RefreshTokenErrorCode,
  message: string,
): never {
  throw new UnauthorizedException({
    code,
    message,
  });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
