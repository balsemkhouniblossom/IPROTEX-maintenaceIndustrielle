export interface PaginationMeta {
  page: number;
  totalPages: number;
}

export interface PaginatedPayload<T> {
  items: T[];
  page: number;
  totalPages: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

export function normalizeApiItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  const objectPayload = asObject(payload);
  if (!objectPayload) {
    return [];
  }

  const candidates = [
    objectPayload.items,
    objectPayload.data,
    objectPayload.results,
    objectPayload.docs,
    objectPayload.rows,
    objectPayload.users,
    objectPayload.documents,
    objectPayload.machines,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
}

export function readPaginationMeta(payload: unknown): PaginationMeta | null {
  const objectPayload = asObject(payload);
  if (!objectPayload) {
    return null;
  }

  const maybePage = Number(objectPayload.page);
  const maybeTotalPages = Number(objectPayload.totalPages);

  if (!Number.isFinite(maybePage) || !Number.isFinite(maybeTotalPages)) {
    return null;
  }

  return {
    page: Math.max(1, Math.floor(maybePage)),
    totalPages: Math.max(1, Math.floor(maybeTotalPages)),
  };
}

type PaginatedRequest = (params?: {
  page?: number;
  limit?: number;
}) => Promise<{ data: unknown }>;

export async function fetchAllPaginated<T>(
  request: PaginatedRequest,
  pageSize = 100,
): Promise<T[]> {
  const firstResponse = await request({ page: 1, limit: pageSize });
  const firstItems = normalizeApiItems<T>(firstResponse.data);
  const pagination = readPaginationMeta(firstResponse.data);

  if (!pagination || pagination.totalPages <= 1) {
    return firstItems;
  }

  const remainingRequests: Array<Promise<{ data: unknown }>> = [];
  for (
    let page = pagination.page + 1;
    page <= pagination.totalPages;
    page += 1
  ) {
    remainingRequests.push(request({ page, limit: pageSize }));
  }

  const remainingResponses = await Promise.all(remainingRequests);
  const remainingItems = remainingResponses.flatMap((response) =>
    normalizeApiItems<T>(response.data),
  );

  return [...firstItems, ...remainingItems];
}
