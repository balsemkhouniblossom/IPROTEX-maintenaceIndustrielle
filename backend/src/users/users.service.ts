import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ApprovalStatus,
  GoogleAuthHistoryEntry,
  Role,
  User,
  UserDocument,
} from '../schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { PendingApprovalsQueryDto } from './dto/pending-approvals-query.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import { resolveApprovalStatus } from './approval-status.utils';

export type ApprovalActionCode =
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_ALREADY_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_REJECTION_UPDATED';

export type ApprovalSafeUser = {
  id: string;
  nom_complet: string;
  email: string;
  phone?: string;
  department?: string;
  position?: string;
  language?: string;
  role: Role;
  photo?: string;
  is_verified: boolean;
  is_active: boolean;
  profile_completed: boolean;
  approval_status?: ApprovalStatus;
  created_at: Date;
  approved_at?: Date;
  rejected_at?: Date;
  rejection_reason?: string;
};

export type ApprovalActionResult = {
  code: ApprovalActionCode;
  user: ApprovalSafeUser;
};

export type PendingApprovalsResult = PaginatedResponse<ApprovalSafeUser> & {
  code: 'PENDING_APPROVALS_RETRIEVED';
};

export type PendingApprovalCountResult = {
  code: 'PENDING_APPROVAL_COUNT_RETRIEVED';
  count: number;
  verified: number;
  unverified: number;
};

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(
    createUserDto: CreateUserDto | CreateUserInternalInput,
  ): Promise<UserDocument> {
    const trustedInput = createUserDto as CreateUserInternalInput;
    const lastUser = await this.userModel
      .findOne({}, {}, { sort: { created_at: -1 } })
      .exec();

    let nextId = 1;

    if (lastUser?.user_id) {
      const match = lastUser.user_id.match(/USER-(\d+)/);
      if (match) {
        nextId = parseInt(match[1]) + 1;
      }
    }

    const userId = `USER-${nextId.toString().padStart(3, '0')}`;

    // 🔐 HASH PASSWORD (IMPORTANT FIX)
    let hashedPassword: string | undefined;

    if (createUserDto.password) {
      hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    }
    const googleId = createUserDto.google_id?.trim();
    const googleLinkedAt = googleId ? new Date() : undefined;
    const createdUser = new this.userModel({
      user_id: userId,
      nom_complet: createUserDto.nom_complet,
      email: createUserDto.email,
      role: createUserDto.role,
      is_active: createUserDto.is_active ?? true,
      is_verified:
        createUserDto.is_verified ?? Boolean(createUserDto.google_id),
      approval_status: trustedInput.approval_status,
      department: createUserDto.department,
      position: createUserDto.position,
      language: createUserDto.language,
      profile_completed: createUserDto.profile_completed ?? true,
      phone: createUserDto.phone,
      photo: createUserDto.photo,
      assigned_machine_ids: this.toObjectIds(createUserDto.assigned_machine_ids),

      // ✅ FIX HERE
      password: hashedPassword,
      google_id: googleId,
      ...(googleLinkedAt
        ? {
            google_linked_at: googleLinkedAt,
            google_auth_history: [
              this.buildGoogleAuthHistoryEntry(
                'linked',
                googleId,
                undefined,
                undefined,
                googleLinkedAt,
              ),
            ],
          }
        : {}),
    });

    return createdUser.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    query: UsersQueryDto = {},
  ): Promise<PaginatedResponse<UserDocument>> {
    const filter = this.buildUsersFilter(query);
    const [items, totalItems] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-password -refresh_token_hash')
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.userModel
      .findOne({
        email: {
          $regex: `^${escapeRegExp(normalizedEmail)}$`,
          $options: 'i',
        },
      })
      .exec();
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ google_id: googleId }).exec();
  }

  async linkGoogleIdentity(
    userId: string,
    googleId: string,
  ): Promise<UserDocument | null> {
    this.validateObjectId(userId);
    const normalizedGoogleId = this.normalizeGoogleId(googleId);
    await this.ensureGoogleIdAvailable(normalizedGoogleId, userId);

    const target = await this.userModel.findById(userId).exec();
    if (!target) {
      return null;
    }

    if (target.google_id === normalizedGoogleId) {
      return target;
    }

    if (target.google_id) {
      throw new ConflictException({
        code: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
        message: 'Google account cannot be linked automatically.',
      });
    }

    const linkedAt = new Date();
    return this.userModel
      .findOneAndUpdate(
        {
          _id: target._id,
          $or: [
            { google_id: { $exists: false } },
            { google_id: null },
            { google_id: '' },
          ],
        },
        {
          $set: {
            google_id: normalizedGoogleId,
            is_verified: true,
            google_linked_at: linkedAt,
          },
          $unset: {
            google_unlinked_at: '',
          },
          $push: {
            google_auth_history: this.buildGoogleAuthHistoryEntry(
              'linked',
              normalizedGoogleId,
              undefined,
              undefined,
              linkedAt,
            ),
          },
        },
        { new: true },
      )
      .exec();
  }

  async relinkGoogleAuthentication(
    targetId: string,
    googleId: string,
    administratorId: string,
  ): Promise<UserDocument | null> {
    this.validateObjectId(targetId);
    this.validateObjectId(administratorId);
    const normalizedGoogleId = this.normalizeGoogleId(googleId);
    await this.ensureGoogleIdAvailable(normalizedGoogleId, targetId);

    const target = await this.userModel.findById(targetId).exec();
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (target.google_id === normalizedGoogleId) {
      return target;
    }

    const linkedAt = new Date();
    return this.userModel
      .findOneAndUpdate(
        { _id: target._id },
        {
          $set: {
            google_id: normalizedGoogleId,
            is_verified: true,
            google_linked_at: linkedAt,
          },
          $unset: {
            google_unlinked_at: '',
          },
          $push: {
            google_auth_history: this.buildGoogleAuthHistoryEntry(
              target.google_id ? 'relinked' : 'linked',
              normalizedGoogleId,
              target.google_id,
              administratorId,
              linkedAt,
            ),
          },
        },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async unlinkGoogleAuthentication(
    targetId: string,
    administratorId: string,
  ): Promise<UserDocument | null> {
    this.validateObjectId(targetId);
    this.validateObjectId(administratorId);

    const target = await this.userModel.findById(targetId).exec();
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (!target.google_id) {
      return target;
    }

    const unlinkedAt = new Date();
    return this.userModel
      .findOneAndUpdate(
        { _id: target._id, google_id: target.google_id },
        {
          $set: {
            google_unlinked_at: unlinkedAt,
          },
          $unset: {
            google_id: '',
          },
          $push: {
            google_auth_history: this.buildGoogleAuthHistoryEntry(
              'unlinked',
              undefined,
              target.google_id,
              administratorId,
              unlinkedAt,
            ),
          },
        },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async findByResetToken(token: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        reset_password_token: token,
        reset_password_expires: { $gt: new Date() },
      })
      .exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument | null> {
    const sanitizedUpdate: UpdateUserDto = { ...updateUserDto };

    if (typeof sanitizedUpdate.password === 'string') {
      if (sanitizedUpdate.password.trim()) {
        sanitizedUpdate.password = await bcrypt.hash(
          sanitizedUpdate.password,
          10,
        );
      } else {
        delete sanitizedUpdate.password;
      }
    }

    return this.userModel
      .findByIdAndUpdate(id, sanitizedUpdate, { new: true })
      .select('-password -refresh_token_hash')
      .exec();
  }

  async remove(id: string): Promise<UserDocument | null> {
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async setRefreshTokenHash(
    id: string,
    refreshTokenHash: string | null,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        { refresh_token_hash: refreshTokenHash },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async recordSuccessfulLogin(
    id: string,
    loginAt: Date = new Date(),
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        {
          last_login: loginAt,
          $push: {
            login_history: {
              $each: [loginAt],
              $position: 0,
              $slice: 10,
            },
          },
        },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async setPasswordResetToken(
    id: string,
    resetToken: string,
    resetExpires: Date,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        {
          reset_password_token: resetToken,
          reset_password_expires: resetExpires,
        },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async updatePasswordAndClearReset(
    id: string,
    password: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        {
          password,
          reset_password_token: null,
          reset_password_expires: null,
        },
        { new: true },
      )
      .select('-password -refresh_token_hash')
      .exec();
  }

  async countAll(): Promise<number> {
    return this.userModel.countDocuments().exec();
  }

  async getUsersTotal() {
    try {
      const totalUsers = await this.userModel.countDocuments();

      const activeUsers = await this.userModel.countDocuments({
        is_active: true,
      });

      return {
        totalUsers,
        activeUsers,
      };
    } catch (error) {
      console.error('getUsersTotal error:', error);
      throw new Error('Failed to fetch users statistics');
    }
  }

  async getActiveUsersCount(): Promise<number> {
    return this.userModel.countDocuments({ is_active: true }).exec();
  }

  async findPendingApprovals(
    query: PendingApprovalsQueryDto = {},
  ): Promise<PendingApprovalsResult> {
    const page = normalizePositiveInteger(query.page, 1);
    const limit = Math.min(normalizePositiveInteger(query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const filter = this.buildPendingApprovalsFilter(query);
    const sortDirection = query.sortOrder === 'desc' ? -1 : 1;

    const [items, totalItems] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ created_at: sortDirection, _id: sortDirection })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      code: 'PENDING_APPROVALS_RETRIEVED',
      ...toPaginatedResponse(
        items.map((user) => sanitizeApprovalUser(user)),
        totalItems,
        page,
        limit,
      ),
    };
  }

  async countPendingApprovals(): Promise<PendingApprovalCountResult> {
    const filter = this.buildPendingApprovalsFilter();
    const [count, verified, unverified] = await Promise.all([
      this.userModel.countDocuments(filter).exec(),
      this.userModel.countDocuments({ ...filter, is_verified: true }).exec(),
      this.userModel.countDocuments({ ...filter, is_verified: false }).exec(),
    ]);

    return {
      code: 'PENDING_APPROVAL_COUNT_RETRIEVED',
      count,
      verified,
      unverified,
    };
  }

  async approveUser(
    targetId: string,
    administratorId: string,
    decisionAt: Date = new Date(),
  ): Promise<ApprovalActionResult> {
    this.validateObjectId(targetId);
    this.validateObjectId(administratorId);

    const target = await this.userModel.findById(targetId).exec();
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (target.role === Role.ADMIN) {
      throw new ConflictException({
        code: 'ADMIN_ACCOUNT_REQUIRES_SEPARATE_MANAGEMENT',
        message: 'Administrator accounts require separate management.',
      });
    }

    if (!target.is_verified) {
      throw new ConflictException({
        code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL',
        message:
          'The user must verify their email before the account can be approved.',
      });
    }

    if (target.profile_completed === false) {
      throw new ConflictException({
        code: 'PROFILE_COMPLETION_REQUIRED_BEFORE_APPROVAL',
        message:
          'The user must complete their profile before the account can be approved.',
      });
    }

    const currentStatus = resolveApprovalStatus(target);
    if (currentStatus === ApprovalStatus.APPROVED) {
      return {
        code: 'ACCOUNT_ALREADY_APPROVED',
        user: sanitizeApprovalUser(target),
      };
    }

    const updated = await this.userModel
      .findOneAndUpdate(
        {
          _id: target._id,
          role: { $in: [Role.OPERATOR, Role.TECHNICIAN] },
          is_verified: true,
          ...buildObservedApprovalStatusFilter(target),
        },
        {
          $set: {
            approval_status: ApprovalStatus.APPROVED,
            is_active: true,
            approved_by: new Types.ObjectId(administratorId),
            approved_at: decisionAt,
          },
          $unset: {
            rejected_by: '',
            rejected_at: '',
            rejection_reason: '',
            refresh_token_hash: '',
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException({
        code: 'INVALID_APPROVAL_TRANSITION',
        message: 'The account approval state changed. Please retry.',
      });
    }

    return {
      code: 'ACCOUNT_APPROVED',
      user: sanitizeApprovalUser(updated),
    };
  }

  async rejectUser(
    targetId: string,
    administratorId: string,
    reason: string,
    decisionAt: Date = new Date(),
  ): Promise<ApprovalActionResult> {
    this.validateObjectId(targetId);
    this.validateObjectId(administratorId);
    const trimmedReason = reason.trim();

    if (!trimmedReason || trimmedReason.length > 500) {
      throw new BadRequestException({
        code: 'INVALID_REJECTION_REASON',
        message: 'A rejection reason is required.',
      });
    }

    if (targetId === administratorId) {
      throw new ConflictException({
        code: 'CANNOT_REJECT_SELF',
        message: 'Administrators cannot reject their own account.',
      });
    }

    const target = await this.userModel.findById(targetId).exec();
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (target.role === Role.ADMIN) {
      throw new ConflictException({
        code: 'ADMIN_ACCOUNT_REQUIRES_SEPARATE_MANAGEMENT',
        message: 'Administrator accounts require separate management.',
      });
    }

    const currentStatus = resolveApprovalStatus(target);
    const updated = await this.userModel
      .findOneAndUpdate(
        {
          _id: target._id,
          role: { $in: [Role.OPERATOR, Role.TECHNICIAN] },
          ...buildObservedApprovalStatusFilter(target),
        },
        {
          $set: {
            approval_status: ApprovalStatus.REJECTED,
            is_active: false,
            rejected_by: new Types.ObjectId(administratorId),
            rejected_at: decisionAt,
            rejection_reason: trimmedReason,
          },
          $unset: {
            approved_by: '',
            approved_at: '',
            refresh_token_hash: '',
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException({
        code: 'INVALID_APPROVAL_TRANSITION',
        message: 'The account approval state changed. Please retry.',
      });
    }

    return {
      code:
        currentStatus === ApprovalStatus.REJECTED
          ? 'ACCOUNT_REJECTION_UPDATED'
          : 'ACCOUNT_REJECTED',
      user: sanitizeApprovalUser(updated),
    };
  }

  private buildPendingApprovalsFilter(
    query: PendingApprovalsQueryDto = {},
  ): FilterQuery<UserDocument> {
    const filter: FilterQuery<UserDocument> = {
      approval_status: ApprovalStatus.PENDING,
      role: { $in: [Role.OPERATOR, Role.TECHNICIAN] },
    };

    if (query.role === Role.OPERATOR || query.role === Role.TECHNICIAN) {
      filter.role = query.role;
    } else if (query.role) {
      filter.role = { $in: [] };
    }

    if (query.emailVerified === 'verified') {
      filter.is_verified = true;
    } else if (query.emailVerified === 'unverified') {
      filter.is_verified = false;
    }

    if (query.search) {
      const searchRegex = new RegExp(escapeRegExp(query.search), 'i');
      filter.$or = [
        { nom_complet: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { department: searchRegex },
      ];
    }

    return filter;
  }

  private buildUsersFilter(
    query: UsersQueryDto = {},
  ): FilterQuery<UserDocument> {
    const filter: FilterQuery<UserDocument> = {};

    if (
      query.approvalStatus &&
      !Object.values(ApprovalStatus).includes(query.approvalStatus)
    ) {
      throw new BadRequestException({
        code: 'INVALID_APPROVAL_STATUS_FILTER',
        message: 'Invalid approval status filter.',
      });
    }

    if (query.approvalStatus) {
      filter.approval_status = query.approvalStatus;
    }

    if (query.search) {
      const searchRegex = new RegExp(escapeRegExp(query.search), 'i');
      filter.$or = [
        { nom_complet: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { department: searchRegex },
      ];
    }

    return filter;
  }

  private validateObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        code: 'INVALID_USER_IDENTIFIER',
        message: 'Invalid user identifier.',
      });
    }
  }

  private toObjectIds(ids?: string[]): Types.ObjectId[] {
    return (ids ?? [])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  private normalizeGoogleId(googleId: string): string {
    const normalizedGoogleId = googleId.trim();
    if (!normalizedGoogleId) {
      throw new BadRequestException({
        code: 'GOOGLE_ID_REQUIRED',
        message: 'Google account identifier is required.',
      });
    }

    return normalizedGoogleId;
  }

  private async ensureGoogleIdAvailable(
    googleId: string,
    targetId: string,
  ): Promise<void> {
    const owner = await this.userModel
      .findOne({
        google_id: googleId,
        _id: { $ne: new Types.ObjectId(targetId) },
      })
      .exec();

    if (owner) {
      throw new ConflictException({
        code: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
        message: 'Google account is already linked to another user.',
      });
    }
  }

  private buildGoogleAuthHistoryEntry(
    action: GoogleAuthHistoryEntry['action'],
    googleId?: string,
    previousGoogleId?: string,
    actorUserId?: string,
    at: Date = new Date(),
  ): GoogleAuthHistoryEntry {
    return {
      action,
      ...(googleId ? { google_id: googleId } : {}),
      ...(previousGoogleId ? { previous_google_id: previousGoogleId } : {}),
      ...(actorUserId
        ? { actor_user_id: new Types.ObjectId(actorUserId) }
        : {}),
      at,
    };
  }
}

export type CreateUserInternalInput = {
  nom_complet: string;
  email: string;
  password?: string;
  role: Role;
  phone?: string;
  department?: string;
  position?: string;
  language?: string;
  profile_completed?: boolean;
  photo?: string;
  google_id?: string;
  is_verified?: boolean;
  is_active?: boolean;
  approval_status?: ApprovalStatus;
  assigned_machine_ids?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function sanitizeApprovalUser(user: UserDocument): ApprovalSafeUser {
  return {
    id: user._id.toString(),
    nom_complet: user.nom_complet,
    email: user.email,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.department ? { department: user.department } : {}),
    ...(user.position ? { position: user.position } : {}),
    ...(user.language ? { language: user.language } : {}),
    role: user.role,
    ...(user.photo ? { photo: user.photo } : {}),
    is_verified: user.is_verified,
    is_active: user.is_active,
    profile_completed: user.profile_completed ?? true,
    ...(user.approval_status ? { approval_status: user.approval_status } : {}),
    created_at: user.created_at,
    ...(user.approved_at ? { approved_at: user.approved_at } : {}),
    ...(user.rejected_at ? { rejected_at: user.rejected_at } : {}),
    ...(user.rejection_reason
      ? { rejection_reason: user.rejection_reason }
      : {}),
  };
}

function buildObservedApprovalStatusFilter(
  user: UserDocument,
): FilterQuery<UserDocument> {
  return user.approval_status
    ? { approval_status: user.approval_status }
    : { approval_status: { $exists: false } };
}
