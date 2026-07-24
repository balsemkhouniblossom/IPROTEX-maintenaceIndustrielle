import {
  resolveUserPhotoUrl,
  shouldExposeUserAvatar,
  toManagedUserPhotoPath,
} from './user-photo-url';
import { ApprovalStatus } from '../schemas/user.schema';
import {
  MANAGED_AVATAR_ROUTE,
  resolveManagedFileUrl,
} from '../common/managed-file-url';

describe('user photo URL helpers', () => {
  const originalApiUrl = process.env.API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  });

  it('creates managed relative avatar paths for stored user photos', () => {
    expect(toManagedUserPhotoPath('avatar-1.webp')).toBe(
      `${MANAGED_AVATAR_ROUTE}/avatar-1.webp`,
    );
  });

  it('resolves managed relative paths to the configured API URL', () => {
    process.env.API_URL = 'https://api.example.test/';

    expect(resolveUserPhotoUrl(toManagedUserPhotoPath('avatar-1.webp'))).toBe(
      resolveManagedFileUrl(toManagedUserPhotoPath('avatar-1.webp')),
    );
  });

  it('preserves existing absolute and external photo URLs', () => {
    expect(resolveUserPhotoUrl('https://lh3.googleusercontent.com/a.png')).toBe(
      'https://lh3.googleusercontent.com/a.png',
    );
    expect(
      resolveUserPhotoUrl(
        `https://pfe-maintenaceindustrielle.onrender.com${toManagedUserPhotoPath('a.png')}`,
      ),
    ).toBe(
      `https://pfe-maintenaceindustrielle.onrender.com${toManagedUserPhotoPath('a.png')}`,
    );
  });

  it('exposes public avatar URLs only for active approved or legacy-active accounts', () => {
    expect(
      shouldExposeUserAvatar({
        is_active: true,
        approval_status: ApprovalStatus.APPROVED,
      }),
    ).toBe(true);
    expect(shouldExposeUserAvatar({ is_active: true })).toBe(true);
    expect(
      shouldExposeUserAvatar({
        is_active: false,
        approval_status: ApprovalStatus.APPROVED,
      }),
    ).toBe(false);
    expect(
      shouldExposeUserAvatar({
        is_active: true,
        approval_status: ApprovalStatus.REJECTED,
      }),
    ).toBe(false);
    expect(
      shouldExposeUserAvatar({
        is_active: true,
        approval_status: ApprovalStatus.PENDING,
      }),
    ).toBe(false);
  });
});
