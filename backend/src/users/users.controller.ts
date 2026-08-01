import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FileUploadService } from '../file-upload.service';
import type { Request } from 'express';
import { UserDocument } from '../schemas/user.schema';
import { normalizePagination } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAccountGuard } from '../auth/guards/admin-account.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { PendingApprovalsQueryDto } from './dto/pending-approvals-query.dto';
import { RejectUserDto } from './dto/reject-user.dto';
import { BulkApproveUsersDto } from './dto/bulk-approve-users.dto';
import { BulkRejectUsersDto } from './dto/bulk-reject-users.dto';
import { UpdateGoogleAuthDto } from './dto/update-google-auth.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import {
  getManagedAvatarFileName,
  resolveUserPhotoUrl,
  shouldExposeUserAvatar,
  toManagedUserPhotoPath,
} from './user-photo-url';
import { AdminOnly } from '../auth/decorators/roles.decorator';

@Controller('users')
@AdminOnly()
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  private async sanitizeUser(
    user: UserDocument | null,
    req?: Request,
  ): Promise<Record<string, unknown> | null> {
    if (!user) return user;
    const plain = user.toObject() as Record<string, unknown>;
    delete plain.password;
    delete plain.refresh_token_hash;
    const photo = plain.photo as string | null | undefined;
    const photoUrl = plain.photo_url as string | null | undefined;
    if (shouldExposeUserAvatar(plain)) {
      const resolvedPhoto = await this.fileUploadService.resolveAvatarUrl(
        photo,
        photoUrl,
      );
      plain.photo = resolveUserPhotoUrl(resolvedPhoto || photo, req);
    } else {
      delete plain.photo;
      delete plain.photo_url;
    }
    return plain;
  }

  private async deleteAvatarFile(relativePath: string): Promise<void> {
    try {
      await this.fileUploadService.deleteAvatar(relativePath);
    } catch {
      this.logger.warn('Failed to delete an avatar file');
    }
  }

  private async deleteManagedAvatarIfPresent(
    photo?: string | null,
  ): Promise<void> {
    const fileName = getManagedAvatarFileName(photo);
    if (fileName) {
      await this.deleteAvatarFile(toManagedUserPhotoPath(fileName));
      return;
    }

    if (photo && this.fileUploadService.isManagedAvatar(photo)) {
      await this.deleteAvatarFile(photo);
    }
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async create(@Body() createUserDto: CreateUserDto, @Req() req: Request) {
    const created = await this.usersService.create(createUserDto);
    return this.sanitizeUser(created, req);
  }

  @Post('upload-photo')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  @UseInterceptors(
    FileInterceptor('photo', FileUploadService.createMulterOptions()),
  )
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId?: string,
    @Req() req?: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const storedAvatar = await this.fileUploadService.storeAvatar(file);
    const photoPath = storedAvatar.relativePath;
    const photoUrl = storedAvatar.shouldPersistUrl
      ? storedAvatar.url
      : undefined;
    const rollbackPhotoRef =
      storedAvatar.storageKey ?? storedAvatar.relativePath;

    let updatedUser: UserDocument | null = null;
    let previousPhoto: string | null | undefined;
    if (userId) {
      try {
        const previousUser = await this.usersService.findOne(userId);
        previousPhoto = previousUser?.photo;
        updatedUser = await this.usersService.update(userId, {
          photo: photoPath,
          photo_storage_path: storedAvatar.storageKey ?? photoPath,
          photo_url: photoUrl,
        });

        if (!updatedUser) {
          throw new BadRequestException('User not found');
        }
      } catch (error) {
        await this.deleteAvatarFile(rollbackPhotoRef);
        throw error;
      }

      await this.deleteManagedAvatarIfPresent(previousPhoto);
    }

    return {
      success: true,
      photoPath,
      updatedUser: updatedUser
        ? await this.sanitizeUser(updatedUser, req)
        : undefined,
      message: 'Photo uploaded successfully',
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async findAll(@Req() req: Request, @Query() query: UsersQueryDto) {
    const pagination = normalizePagination(query.page, query.limit, 10, 100);
    const users = await this.usersService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
      query,
    );

    return {
      ...users,
      items: await Promise.all(
        users.items.map((user) => this.sanitizeUser(user, req)),
      ),
    };
  }

  @Get('total')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async getUsersTotal() {
    return this.usersService.getUsersTotal();
  }

  @Get('pending-approvals')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async findPendingApprovals(@Query() query: PendingApprovalsQueryDto) {
    return this.usersService.findPendingApprovals(query);
  }

  @Get('pending-approvals/count')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async countPendingApprovals() {
    return this.usersService.countPendingApprovals();
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async approveUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.approveUser(
      id,
      req.currentUser?._id.toString() ?? '',
    );
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async rejectUser(
    @Param('id') id: string,
    @Body() rejectUserDto: RejectUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.rejectUser(
      id,
      req.currentUser?._id.toString() ?? '',
      rejectUserDto.reason,
    );
  }

  @Post('bulk-approve')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async bulkApproveUsers(
    @Body() dto: BulkApproveUsersDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.bulkApproveUsers(
      dto.userIds,
      req.currentUser?._id.toString() ?? '',
    );
  }

  @Post('bulk-reject')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async bulkRejectUsers(
    @Body() dto: BulkRejectUsersDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.bulkRejectUsers(
      dto.userIds,
      req.currentUser?._id.toString() ?? '',
      dto.reason,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const user = await this.usersService.findOne(id);
    return this.sanitizeUser(user, req);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const updated = await this.usersService.update(id, updateUserDto);
    return this.sanitizeUser(updated, req);
  }

  @Patch(':id/google-auth')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async relinkGoogleAuthentication(
    @Param('id') id: string,
    @Body() updateGoogleAuthDto: UpdateGoogleAuthDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const updated = await this.usersService.relinkGoogleAuthentication(
      id,
      updateGoogleAuthDto.google_id,
      req.currentUser?._id.toString() ?? req.user?.userId ?? '',
    );
    return this.sanitizeUser(updated, req);
  }

  @Delete(':id/google-auth')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async unlinkGoogleAuthentication(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const updated = await this.usersService.unlinkGoogleAuthentication(
      id,
      req.currentUser?._id.toString() ?? req.user?.userId ?? '',
    );
    return this.sanitizeUser(updated, req);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminAccountGuard)
  async remove(@Param('id') id: string) {
    const removed = await this.usersService.remove(id);
    return this.sanitizeUser(removed);
  }
}
