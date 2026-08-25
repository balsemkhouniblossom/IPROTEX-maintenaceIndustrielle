import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ApprovalStatus } from '../schemas/user.schema';
import { toManagedUserPhotoPath } from './user-photo-url';
import type { FileUploadService } from '../file-upload.service';

describe('UsersController photo handling', () => {
  let usersService: {
    findOne: jest.Mock;
    update: jest.Mock;
    findAll: jest.Mock;
  };
  let fileUploadService: {
    storeAvatar: jest.Mock;
    deleteAvatar: jest.Mock;
    isManagedAvatar: jest.Mock;
    resolveAvatarUrl: jest.Mock;
  };
  let controller: UsersController;

  const req = {
    protocol: 'https',
    get: jest.fn().mockReturnValue('api.example.test'),
  };

  function expectedRequestUrl(path: string): string {
    return `${req.protocol}://${req.get()}${path}`;
  }

  function userDocument(
    photo: string,
    photoUrl?: string,
    state: Record<string, unknown> = {},
  ) {
    return {
      photo,
      toObject: () => ({
        _id: 'user-1',
        nom_complet: 'Avatar User',
        email: 'avatar@example.test',
        photo,
        photo_url: photoUrl,
        is_active: true,
        approval_status: ApprovalStatus.APPROVED,
        ...state,
        password: 'hidden',
        refresh_token_hash: 'hidden',
      }),
    };
  }

  beforeEach(() => {
    usersService = {
      findOne: jest.fn(),
      update: jest.fn(),
      findAll: jest.fn(),
    };
    fileUploadService = {
      storeAvatar: jest.fn().mockResolvedValue({
        fileName: 'avatar-new.webp',
        relativePath: toManagedUserPhotoPath('avatar-new.webp'),
        size: 100,
      }),
      deleteAvatar: jest.fn().mockResolvedValue(undefined),
      isManagedAvatar: jest.fn().mockReturnValue(false),
      resolveAvatarUrl: jest.fn((path?: string | null, url?: string | null) =>
        Promise.resolve(url || path || ''),
      ),
    };
    controller = new UsersController(
      usersService as unknown as UsersService,
      fileUploadService as unknown as FileUploadService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stores and returns the upload photoPath as a relative managed path', async () => {
    const nextPhoto = toManagedUserPhotoPath('avatar-1.webp');
    usersService.findOne.mockResolvedValue(userDocument(''));
    usersService.update.mockResolvedValue(userDocument(nextPhoto));

    const result = await controller.uploadPhoto(
      {} as Express.Multer.File,
      'user-1',
      req as never,
    );

    expect(usersService.update).toHaveBeenCalledWith('user-1', {
      photo: toManagedUserPhotoPath('avatar-new.webp'),
      photo_storage_path: toManagedUserPhotoPath('avatar-new.webp'),
      photo_url: undefined,
    });
    expect(result.photoPath).toBe(toManagedUserPhotoPath('avatar-new.webp'));
    expect(result.photoUrl).toBe(
      expectedRequestUrl(toManagedUserPhotoPath('avatar-new.webp')),
    );
    expect(result.updatedUser?.photo).toBe(expectedRequestUrl(nextPhoto));
  });

  it('deletes the previous managed avatar after the new avatar update succeeds', async () => {
    const previousPhoto = toManagedUserPhotoPath('avatar-old.webp');
    const nextPhoto = toManagedUserPhotoPath('avatar-new.webp');
    usersService.findOne.mockResolvedValue(userDocument(previousPhoto));
    usersService.update.mockResolvedValue(userDocument(nextPhoto));

    await controller.uploadPhoto(
      {} as Express.Multer.File,
      'user-1',
      req as never,
    );

    expect(fileUploadService.deleteAvatar).toHaveBeenCalledTimes(1);
    expect(fileUploadService.deleteAvatar).toHaveBeenCalledWith(
      toManagedUserPhotoPath('avatar-old.webp'),
    );
  });

  it('does not delete previous external or legacy absolute avatar URLs', async () => {
    for (const previousPhoto of [
      'https://lh3.googleusercontent.com/avatar.webp',
      `https://api.example.test${toManagedUserPhotoPath('avatar-old.webp')}`,
    ]) {
      jest.clearAllMocks();
      fileUploadService.storeAvatar.mockResolvedValue({
        fileName: 'avatar-new.webp',
        relativePath: toManagedUserPhotoPath('avatar-new.webp'),
        size: 100,
      });
      fileUploadService.deleteAvatar.mockResolvedValue(undefined);
      fileUploadService.isManagedAvatar.mockReturnValue(false);
      usersService.findOne.mockResolvedValue(userDocument(previousPhoto));
      usersService.update.mockResolvedValue(
        userDocument(toManagedUserPhotoPath('avatar-new.webp')),
      );

      await controller.uploadPhoto(
        {} as Express.Multer.File,
        'user-1',
        req as never,
      );

      expect(fileUploadService.deleteAvatar).not.toHaveBeenCalled();
    }
  });

  it('deletes previous managed Supabase avatar URLs after the update succeeds', async () => {
    const previousPhoto =
      'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-old.webp';
    usersService.findOne.mockResolvedValue(userDocument(previousPhoto));
    usersService.update.mockResolvedValue(
      userDocument(
        'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-new.webp',
      ),
    );
    fileUploadService.storeAvatar.mockResolvedValue({
      fileName: 'avatar-new.webp',
      relativePath: 'uploads/avatars/avatar-new.webp',
      url: 'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-new.webp',
      storageKey: 'uploads/avatars/avatar-new.webp',
      shouldPersistUrl: true,
      size: 100,
    });
    fileUploadService.isManagedAvatar.mockReturnValue(true);

    const result = await controller.uploadPhoto(
      {} as Express.Multer.File,
      'user-1',
      req as never,
    );

    expect(result.photoPath).toBe('uploads/avatars/avatar-new.webp');
    expect(result.photoUrl).toBe(
      'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-new.webp',
    );
    expect(usersService.update).toHaveBeenCalledWith('user-1', {
      photo: 'uploads/avatars/avatar-new.webp',
      photo_storage_path: 'uploads/avatars/avatar-new.webp',
      photo_url:
        'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-new.webp',
    });
    expect(fileUploadService.deleteAvatar).toHaveBeenCalledWith(previousPhoto);
  });

  it('stores private Supabase avatar path and returns regenerated signed photo URL', async () => {
    fileUploadService.storeAvatar.mockResolvedValue({
      fileName: 'avatar-new.webp',
      relativePath: 'uploads/avatars/avatar-new.webp',
      storageKey: 'uploads/avatars/avatar-new.webp',
      url: 'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/avatars/avatar-new.webp?token=initial',
      shouldPersistUrl: false,
      size: 100,
    });
    fileUploadService.resolveAvatarUrl.mockResolvedValue(
      'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/avatars/avatar-new.webp?token=fresh',
    );
    usersService.findOne.mockResolvedValue(userDocument(''));
    usersService.update.mockResolvedValue(
      userDocument('uploads/avatars/avatar-new.webp'),
    );

    const result = await controller.uploadPhoto(
      {} as Express.Multer.File,
      'user-1',
      req as never,
    );

    expect(usersService.update).toHaveBeenCalledWith('user-1', {
      photo: 'uploads/avatars/avatar-new.webp',
      photo_storage_path: 'uploads/avatars/avatar-new.webp',
      photo_url: undefined,
    });
    expect(result.photoPath).toBe('uploads/avatars/avatar-new.webp');
    expect(result.photoUrl).toContain('token=fresh');
    expect(result.updatedUser?.photo).toContain('token=fresh');
  });

  it('rolls back Supabase avatars by stored path when the update fails', async () => {
    const updateError = new Error('database unavailable');
    fileUploadService.storeAvatar.mockResolvedValue({
      fileName: 'avatar-new.webp',
      relativePath: 'uploads/avatars/avatar-new.webp',
      storageKey: 'uploads/avatars/avatar-new.webp',
      url: 'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/avatars/avatar-new.webp?token=initial',
      shouldPersistUrl: false,
      size: 100,
    });
    usersService.findOne.mockResolvedValue(userDocument(''));
    usersService.update.mockRejectedValue(updateError);

    await expect(
      controller.uploadPhoto({} as Express.Multer.File, 'user-1', req as never),
    ).rejects.toBe(updateError);

    expect(fileUploadService.deleteAvatar).toHaveBeenCalledWith(
      'uploads/avatars/avatar-new.webp',
    );
  });

  it('does not delete previous default avatar files', async () => {
    usersService.findOne.mockResolvedValue(
      userDocument(toManagedUserPhotoPath('default-avatar.webp')),
    );
    usersService.update.mockResolvedValue(
      userDocument(toManagedUserPhotoPath('avatar-new.webp')),
    );

    await controller.uploadPhoto(
      {} as Express.Multer.File,
      'user-1',
      req as never,
    );

    expect(fileUploadService.deleteAvatar).not.toHaveBeenCalled();
  });

  it('rolls back the new avatar file when the user update fails', async () => {
    const updateError = new Error('database unavailable');
    usersService.findOne.mockResolvedValue(
      userDocument(toManagedUserPhotoPath('avatar-old.webp')),
    );
    usersService.update.mockRejectedValue(updateError);

    await expect(
      controller.uploadPhoto({} as Express.Multer.File, 'user-1', req as never),
    ).rejects.toBe(updateError);

    expect(fileUploadService.deleteAvatar).toHaveBeenCalledTimes(1);
    expect(fileUploadService.deleteAvatar).toHaveBeenCalledWith(
      toManagedUserPhotoPath('avatar-new.webp'),
    );
  });

  it('resolves relative managed photos in user-list responses', async () => {
    const photo = toManagedUserPhotoPath('avatar-2.webp');
    usersService.findAll.mockResolvedValue({
      items: [userDocument(photo)],
      totalItems: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    const result = await controller.findAll(req as never, {});

    expect(result.items[0]?.photo).toBe(expectedRequestUrl(photo));
    expect(result.items[0]).not.toHaveProperty('password');
    expect(result.items[0]).not.toHaveProperty('refresh_token_hash');
  });

  it('does not generate avatar URLs for inactive or rejected users', async () => {
    const photo = toManagedUserPhotoPath('avatar-hidden.webp');
    usersService.findAll.mockResolvedValue({
      items: [
        userDocument(photo, undefined, { is_active: false }),
        userDocument(photo, undefined, {
          approval_status: ApprovalStatus.REJECTED,
        }),
      ],
      totalItems: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    const result = await controller.findAll(req as never, {});

    expect(result.items[0]).not.toHaveProperty('photo');
    expect(result.items[0]).not.toHaveProperty('photo_url');
    expect(result.items[1]).not.toHaveProperty('photo');
    expect(result.items[1]).not.toHaveProperty('photo_url');
    expect(fileUploadService.resolveAvatarUrl).not.toHaveBeenCalled();
  });
});

describe('UsersController.remove', () => {
  let usersService: { remove: jest.Mock };
  let fileUploadService: { resolveAvatarUrl: jest.Mock };
  let controller: UsersController;

  beforeEach(() => {
    usersService = { remove: jest.fn() };
    fileUploadService = {
      resolveAvatarUrl: jest.fn((path?: string | null, url?: string | null) =>
        Promise.resolve(url || path || ''),
      ),
    };
    controller = new UsersController(
      usersService as unknown as UsersService,
      fileUploadService as unknown as FileUploadService,
    );
  });

  it('never returns the deleted user password or refresh token hash', async () => {
    usersService.remove.mockResolvedValue({
      toObject: () => ({
        _id: 'user-1',
        nom_complet: 'Deleted User',
        email: 'deleted@example.test',
        role: 'operator',
        password: 'bcrypt-hash-should-not-leak',
        refresh_token_hash: 'refresh-hash-should-not-leak',
      }),
    });

    const result = await controller.remove('user-1');

    expect(usersService.remove).toHaveBeenCalledWith('user-1');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refresh_token_hash');
    expect(result).toMatchObject({
      _id: 'user-1',
      nom_complet: 'Deleted User',
      email: 'deleted@example.test',
    });
  });

  it('returns null without throwing when the user was already gone', async () => {
    usersService.remove.mockResolvedValue(null);

    const result = await controller.remove('missing-user');

    expect(result).toBeNull();
  });
});
