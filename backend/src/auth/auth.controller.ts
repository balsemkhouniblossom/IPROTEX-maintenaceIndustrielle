import {
  BadRequestException,
  Controller,
  Request,
  Post,
  Body,
  Query,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local-auth.guard';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetTokenDto } from './dto/verify-reset-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './google-auth.guard';
import type { Request as ExpressRequest, Response } from 'express';
import type { UserDocument } from '../schemas/user.schema';
import type { GoogleUserProfile } from './auth.service';

type LoginRequest = ExpressRequest & {
  user?: UserDocument;
};

type JwtRequest = ExpressRequest & {
  user?: {
    userId: string;
  };
};

type GoogleAuthRequest = ExpressRequest & {
  user?: GoogleUserProfile;
};

const SUPPORTED_LOCALES = new Set(['ar', 'de', 'en', 'es', 'fr', 'it']);

function getLocaleFromCookie(cookieHeader?: string): string {
  if (!cookieHeader) {
    return 'en';
  }

  const localeCookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('NEXT_LOCALE='));

  if (!localeCookie) {
    return 'en';
  }

  const locale = decodeURIComponent(localeCookie.slice('NEXT_LOCALE='.length));
  return SUPPORTED_LOCALES.has(locale) ? locale : 'en';
}

function getCookieValue(cookieHeader: string | undefined, key: string): string {
  if (!cookieHeader) {
    return '';
  }

  const entry = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`));

  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : '';
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req: LoginRequest) {
    if (!req.user) {
      throw new UnauthorizedException('Authentication failed');
    }

    return this.authService.login(req.user);
  }
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Passport redirects to Google
  }
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleAuthCallback(@Req() req: GoogleAuthRequest, @Res() res: Response) {
    if (!req.user) {
      throw new UnauthorizedException('Google authentication failed');
    }

    const locale = getLocaleFromCookie(req.headers.cookie);
    const frontendOrigin = getCookieValue(
      req.headers.cookie,
      'google_auth_origin',
    );

    return this.authService.googleLogin(req.user, res, locale, frontendOrigin);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body('refresh_token') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Request() req: JwtRequest) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('Authentication failed');
    }

    return this.authService.logout(req.user.userId);
  }

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    const user = await this.authService.register(createUserDto);
    return {
      message:
        'User registered successfully. Please check your email to verify your account.',
      user: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        _id: (user as any)._id,
        user_id: user.user_id,
        nom_complet: user.nom_complet,
        email: user.email,
        role: user.role,
      },
    };
  }
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('forgot-password')
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @Request() req: ExpressRequest,
  ) {
    const requestOrigin =
      req.headers.origin ??
      req.headers.referer ??
      forgotPasswordDto.frontendOrigin;

    return this.authService.forgotPassword(
      forgotPasswordDto.email,
      forgotPasswordDto.locale,
      requestOrigin,
    );
  }

  @Get('verify-reset-token')
  async verifyResetToken(@Query('token') token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('Reset token is required');
    }

    return this.authService.verifyResetToken(token);
  }

  @Post('verify-reset-token')
  async verifyResetTokenFromBody(
    @Body() verifyResetTokenDto: VerifyResetTokenDto,
  ) {
    return this.authService.verifyResetToken(verifyResetTokenDto.token);
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
