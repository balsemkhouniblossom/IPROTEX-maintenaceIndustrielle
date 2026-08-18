import { useTranslations } from 'next-intl';
import ProfileAvatar from '@/components/ProfileAvatar';
import { User } from '../types';
import { initials } from '../utils';

type UserIdentityProps = Readonly<{
  user: Readonly<Partial<User>>;
  tUsers: ReturnType<typeof useTranslations>;
}>;

export function UserIdentity({
  user,
  tUsers,
}: UserIdentityProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {user.photo ? (
        <ProfileAvatar
          name={user.nom_complet}
          photo={user.photo}
          alt={user.nom_complet ?? tUsers('approvals.userAvatar')}
          size="sm"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
          {initials(user.nom_complet)}
        </div>
      )}
      <div className="min-w-0">
        <div className="user-table-text font-semibold text-slate-800">
          {user.nom_complet ?? '—'}
        </div>
        <div className="user-table-text text-xs text-slate-500">{user.email ?? '—'}</div>
      </div>
    </div>
  );
}
