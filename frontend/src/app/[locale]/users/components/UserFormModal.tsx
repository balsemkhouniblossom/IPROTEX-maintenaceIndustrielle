import React from 'react';
import { useTranslations } from 'next-intl';
import { CameraIcon } from '@heroicons/react/24/outline';
import InternationalPhoneInput from '@/components/InternationalPhoneInput';
import { Modal } from '@/components/Modal';
import ProfileAvatar from '@/components/ProfileAvatar';
import { User, UserFormData } from '../types';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WidgetErrorFallback } from '@/components/WidgetErrorFallback';

type UserFormModalProps = {
  isOpen: boolean;
  editingUser: User | null;
  formData: UserFormData;
  useCustomDepartment: boolean;
  departmentOptions: string[];
  customDepartmentValue: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (event?: React.FormEvent) => void;
  onPhotoUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onUseCustomDepartmentChange: (value: boolean) => void;
  onFormDataChange: (data: UserFormData) => void;
  tUsers: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
};

export function UserFormModal(props: UserFormModalProps) {
  return (
    <ErrorBoundary
      boundaryName="user-form-modal"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} />}
    >
      <UserFormModalInner {...props} />
    </ErrorBoundary>
  );
}

function UserFormModalInner(props: UserFormModalProps) {
  const {
    isOpen,
    editingUser,
    formData,
    useCustomDepartment,
    departmentOptions,
    customDepartmentValue,
    submitting,
    onClose,
    onSubmit,
    onPhotoUpload,
    onUseCustomDepartmentChange,
    onFormDataChange,
    tUsers,
    tCommon,
  } = props;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingUser ? tUsers('modal.editTitle') : tUsers('modal.addTitle')}
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex flex-col items-center gap-3">
          <label className="group relative cursor-pointer">
            <ProfileAvatar
              name={formData.nom_complet}
              photo={formData.photo}
              alt={tUsers('form.profilePhoto')}
              size="lg"
              className="border border-slate-300"
            />
            <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md transition-colors group-hover:bg-blue-700">
              <CameraIcon className="h-4 w-4" />
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              aria-label={tUsers('form.profilePhoto')}
              onChange={onPhotoUpload}
            />
          </label>
          <span className="text-sm text-slate-500">{tUsers('form.clickAvatar')}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <input
            type="text"
            value={formData.nom_complet}
            onChange={(event) =>
              onFormDataChange({ ...formData, nom_complet: event.target.value })
            }
            className="input-field"
            placeholder={tUsers('form.fullName')}
            aria-label={tUsers('form.fullName')}
            required
          />
          <input
            type="email"
            value={formData.email}
            onChange={(event) =>
              onFormDataChange({ ...formData, email: event.target.value })
            }
            className="input-field"
            placeholder={tUsers('form.email')}
            aria-label={tUsers('form.email')}
            required
          />
        </div>

        <input
          type="password"
          value={formData.password}
          onChange={(event) =>
            onFormDataChange({ ...formData, password: event.target.value })
          }
          className="input-field"
          required={!editingUser}
          placeholder={
            editingUser ? tUsers('placeholders.editPassword') : tUsers('placeholders.password')
          }
          aria-label={tUsers('form.password')}
        />

        <InternationalPhoneInput
          name="phone"
          value={formData.phone}
          onChange={(phone) => onFormDataChange({ ...formData, phone })}
          placeholder={tUsers('validation.phoneHint')}
          className="w-full"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <select
              value={
                useCustomDepartment
                  ? customDepartmentValue
                  : formData.department
              }
              onChange={(event) => {
                if (event.target.value === customDepartmentValue) {
                  onUseCustomDepartmentChange(true);
                  onFormDataChange({ ...formData, department: '' });
                  return;
                }
                onUseCustomDepartmentChange(false);
                onFormDataChange({ ...formData, department: event.target.value });
              }}
              className="input-field"
              aria-label={tUsers('form.department')}
            >
              <option value="">{tUsers('form.department')}</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
              <option value={customDepartmentValue}>
                {tUsers('form.customDepartment')}
              </option>
            </select>
            {useCustomDepartment && (
              <input
                type="text"
                value={formData.department}
                onChange={(event) =>
                  onFormDataChange({ ...formData, department: event.target.value })
                }
                className="input-field mt-2"
                placeholder={tUsers('form.customDepartment')}
              />
            )}
          </div>
          <select
            value={formData.role}
            onChange={(event) =>
              onFormDataChange({ ...formData, role: event.target.value })
            }
            className="input-field"
            aria-label={tUsers('form.role')}
          >
            <option value="admin">{tUsers('roles.admin')}</option>
            <option value="technician">{tUsers('roles.technician')}</option>
            <option value="operator">{tUsers('roles.operator')}</option>
          </select>
        </div>

        <select
          value={formData.is_active ? 'true' : 'false'}
          onChange={(event) =>
            onFormDataChange({
              ...formData,
              is_active: event.target.value === 'true',
            })
          }
          className="input-field"
          aria-label={tUsers('form.status')}
        >
          <option value="true">{tUsers('status.active')}</option>
          <option value="false">{tUsers('status.inactive')}</option>
        </select>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            {tCommon('actions.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? tCommon('actions.saving')
              : editingUser
                ? tUsers('actions.updateUser')
                : tUsers('actions.createUser')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
