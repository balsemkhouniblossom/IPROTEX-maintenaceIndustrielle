export const PUBLIC_REGISTRATION_ROLES = ['operator', 'technician'] as const;

export type PublicRegistrationRole = (typeof PUBLIC_REGISTRATION_ROLES)[number];

export type RegistrationFormInput = {
  nom_complet: string;
  email: string;
  phone?: string;
  password: string;
  role: string;
  department?: string;
};

export function isPublicRegistrationRole(
  role: string,
): role is PublicRegistrationRole {
  return PUBLIC_REGISTRATION_ROLES.includes(role as PublicRegistrationRole);
}

export function buildPublicRegistrationPayload(input: RegistrationFormInput) {
  if (!isPublicRegistrationRole(input.role)) {
    throw new Error('PUBLIC_ROLE_NOT_ALLOWED');
  }

  return {
    nom_complet: input.nom_complet,
    email: input.email,
    phone: input.phone || undefined,
    password: input.password,
    role: input.role,
    department: input.department,
  };
}

export function getRegistrationSuccessRedirect(locale: string): string {
  return `/${locale}/auth/login?registered=pending-approval`;
}

export function getRegistrationErrorCode(error: unknown): string | null {
  const data = (error as { response?: { data?: { code?: unknown; message?: unknown } } })
    ?.response?.data;

  if (typeof data?.code === 'string') {
    return data.code;
  }

  if (
    data?.message &&
    typeof data.message === 'object' &&
    'code' in data.message &&
    typeof (data.message as { code?: unknown }).code === 'string'
  ) {
    return (data.message as { code: string }).code;
  }

  return null;
}
