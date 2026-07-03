export function getDashboardPath(locale: string, role?: string | null): string {
  const normalizedRole = role?.trim().toLowerCase();

  if (normalizedRole === 'admin') {
    return `/${locale}`;
  }

  if (normalizedRole === 'technician') {
    return `/${locale}/technician`;
  }

  return `/${locale}/operator`;
}