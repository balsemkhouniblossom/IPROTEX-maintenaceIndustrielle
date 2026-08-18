import { useTranslations } from 'next-intl';
import { Modal } from '@/components/Modal';
import { User } from '../types';
import { UserIdentity } from './UserIdentity';

type HistoryModalProps = Readonly<{
  isOpen: boolean;
  user: User | null;
  dateFormatter: Intl.DateTimeFormat;
  onClose: () => void;
  tUsers: ReturnType<typeof useTranslations>;
}>;

export function HistoryModal({
  isOpen,
  user,
  dateFormatter,
  onClose,
  tUsers,
}: HistoryModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tUsers('modal.loginHistoryTitle')}
      size="md"
    >
      <div className="space-y-4">
        <UserIdentity user={user ?? {}} tUsers={tUsers} />
        {Array.isArray(user?.login_history) && user.login_history.length > 0 ? (
          <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {user.login_history.map((entry, index) => (
              <li
                key={`${user.email}-history-${index}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                {dateFormatter.format(new Date(entry))}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            {tUsers('empty.loginHistory')}
          </div>
        )}
      </div>
    </Modal>
  );
}
