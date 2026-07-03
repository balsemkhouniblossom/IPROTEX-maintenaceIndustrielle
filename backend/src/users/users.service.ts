import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
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
    const createdUser = new this.userModel({
      user_id: userId,
      nom_complet: createUserDto.nom_complet,
      email: createUserDto.email,
      role: createUserDto.role,
      is_active: createUserDto.is_active ?? true,
      is_verified: Boolean(createUserDto.google_id),
      department: createUserDto.department,
      phone: createUserDto.phone,
      photo: createUserDto.photo,

      // ✅ FIX HERE
      password: hashedPassword,
      google_id: createUserDto.google_id,
    });

    return createdUser.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<UserDocument>> {
    const [items, totalItems] = await Promise.all([
      this.userModel
        .find()
        .select('-password -refresh_token_hash')
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
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
      console.log(await this.userModel.findOne().lean()); // 👈 PUT IT HERE

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
}
