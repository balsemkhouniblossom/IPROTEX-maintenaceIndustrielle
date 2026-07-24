export function getDashboardPath(
  locale: string,
  role?: string | null,
): string | null {
  const normalizedRole = role?.trim().toLowerCase();

  if (normalizedRole === 'admin') {
    return `/${locale}`;
  }

  if (normalizedRole === 'technician') {
    return `/${locale}/technician`;
  }

  if (normalizedRole === 'operator') {
    return `/${locale}/operator`;
  }

  return null;
}
