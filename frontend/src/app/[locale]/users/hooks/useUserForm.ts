import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiService } from '@/services/api';
import {
  buildInternationalPhone,
  DEFAULT_PHONE_COUNTRY,
  parseInternationalPhoneValue,
  validateNationalPhone,
} from '@/services/phoneNumber';
import { validatePasswordPolicy } from '@/services/userValidation';
import { User, UserFormData } from '../types';
import { getActionId } from '../utils';

export const DEPARTMENT_OPTIONS = ['IT', 'Maintenance', 'Production', 'Administration'];
export const CUSTOM_DEPARTMENT_VALUE = '__custom_department__';

const emptyForm: UserFormData = {
  nom_complet: '',
  email: '',
  password: '',
  role: 'operator',
  department: '',
  phone: {
    country: DEFAULT_PHONE_COUNTRY,
    nationalNumber: '',
  },
  photo: '',
  is_active: true,
};

export function useUserForm({
  loadCurrentView,
  showNotification,
  tUsers,
}: {
  loadCurrentView: () => Promise<void>;
  showNotification: (type: 'success' | 'error', message: string) => void;
  tUsers: ReturnType<typeof useTranslations>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [useCustomDepartment, setUseCustomDepartment] = useState(false);

  function resetForm() {
    setFormData(emptyForm);
    setUseCustomDepartment(false);
    setEditingUser(null);
  }

  function validateForm() {
    if (!formData.nom_complet.trim()) {
      showNotification('error', tUsers('validation.nameRequired'));
      return false;
    }
    if (!formData.email.trim()) {
      showNotification('error', tUsers('validation.emailRequired'));
      return false;
    }
    if (
      !validateNationalPhone(
        formData.phone.country,
        formData.phone.nationalNumber,
      )
    ) {
      showNotification('error', tUsers('validation.invalidPhone'));
      return false;
    }
    if (!editingUser && !formData.password.trim()) {
      showNotification('error', tUsers('validation.passwordRequired'));
      return false;
    }
    if (
      formData.password.trim() &&
      !validatePasswordPolicy(formData.password.trim())
    ) {
      showNotification('error', tUsers('validation.weakPassword'));
      return false;
    }
    return true;
  }

  function handleAdd() {
    resetForm();
    setIsModalOpen(true);
  }

  function handleEdit(user: User) {
    const existingDepartment = user.department || '';
    const isCustomDepartment =
      !!existingDepartment && !DEPARTMENT_OPTIONS.includes(existingDepartment);

    setEditingUser(user);
    setUseCustomDepartment(isCustomDepartment);
    setFormData({
      nom_complet: user.nom_complet || '',
      email: user.email || '',
      password: '',
      role: user.role || 'operator',
      department: existingDepartment,
      phone: parseInternationalPhoneValue(user.phone),
      photo: user.photo || '',
      is_active: user.is_active ?? true,
    });
    setIsModalOpen(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const uploadData = new FormData();
      uploadData.append('photo', file);
      const response = await apiService.uploadPhoto(uploadData);
      const photoPath = response.data.photoPath || response.data.path || '';
      setFormData((prev) => ({ ...prev, photo: photoPath }));

      if (editingUser && photoPath) {
        await apiService.updateUser(getActionId(editingUser), { photo: photoPath });
        await loadCurrentView();
      }

      showNotification('success', tUsers('notifications.photoUploaded'));
    } catch (error) {
      console.error(error);
      showNotification('error', tUsers('notifications.photoUploadFailed'));
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);

    try {
      const phone = buildInternationalPhone(
        formData.phone.country,
        formData.phone.nationalNumber,
      );
      const payload = {
        nom_complet: formData.nom_complet.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department.trim() || undefined,
        phone: phone || undefined,
        photo: formData.photo || undefined,
        is_active: formData.is_active,
        ...(formData.password.trim()
          ? { password: formData.password.trim() }
          : {}),
      };

      if (editingUser) {
        await apiService.updateUser(getActionId(editingUser), payload);
        showNotification('success', tUsers('notifications.updated'));
      } else {
        await apiService.createUser({
          ...payload,
          password: formData.password.trim(),
        });
        showNotification('success', tUsers('notifications.created'));
      }

      setIsModalOpen(false);
      resetForm();
      await loadCurrentView();
    } catch (error) {
      console.error('Save error:', error);
      showNotification('error', tUsers('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(userId?: string) {
    if (!userId) return;
    if (!confirm(tUsers('notifications.confirmDelete'))) return;

    try {
      await apiService.deleteUser(userId);
      await loadCurrentView();
      showNotification('success', tUsers('notifications.deleted'));
    } catch (error) {
      console.error('Error deleting user:', error);
      showNotification('error', tUsers('notifications.deleteFailed'));
    }
  }

  return {
    isModalOpen,
    setIsModalOpen,
    editingUser,
    submitting,
    formData,
    setFormData,
    useCustomDepartment,
    setUseCustomDepartment,
    departmentOptions: DEPARTMENT_OPTIONS,
    customDepartmentValue: CUSTOM_DEPARTMENT_VALUE,
    resetForm,
    handleAdd,
    handleEdit,
    handlePhotoUpload,
    handleSubmit,
    handleDelete,
  };
}
