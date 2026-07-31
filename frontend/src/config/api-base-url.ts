const PRODUCTION_RENDER_API_URL =
  'https://pfe-maintenaceindustrielle.onrender.com';

export function getApiBaseUrl(): string {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    const normalized = configuredBaseUrl.replace(/\/$/, '');
    if (process.env.NODE_ENV === 'production') {
      assertProductionApiBaseUrl(normalized);
    }
    return normalized;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Missing required environment variable: NEXT_PUBLIC_API_BASE_URL',
    );
  }

  return 'http://localhost:3001';
}

function assertProductionApiBaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must be a valid HTTPS Render URL');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost') {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must use the HTTPS Render API URL in production');
  }

  if (!parsed.hostname.endsWith('.onrender.com')) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must point to the Render backend in production');
  }

  if (parsed.origin !== PRODUCTION_RENDER_API_URL) {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must be ${PRODUCTION_RENDER_API_URL} in production`,
    );
  }
}
