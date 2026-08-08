import axios, { AxiosHeaders } from 'axios';
import { getApiBaseUrl } from '@/config/api-base-url';
import { normalizeApiItems, readPaginationMeta } from './pagination';
import { clearAuthSession, getAuthToken, updateStoredTokens, updateStoredUser } from './authStorage';
import {
  getLoginRedirectForAuthFailure,
  getStableAuthFailureCode,
  isConfirmedRefreshAuthFailure,
} from './authErrors';
import { dispatchSessionExpired } from './authSessionEvents';
import { parseLocalLoginSession } from './localLogin';

const API_BASE_URL = getApiBaseUrl();

if (typeof window === 'undefined') {
  // Server-side startup log (visible in Vercel Function logs)
  void API_BASE_URL;
} else if (process.env.NODE_ENV !== 'production') {
  // Client-side dev log only — avoids leaking config in production browser console
  void API_BASE_URL;
}

// Axios has no default timeout (0 = never times out). A hung backend
// request previously left the UI spinning forever with no recovery path.
// File upload/download endpoints override this with a longer budget below.
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const UPLOAD_REQUEST_TIMEOUT_MS = 60000;

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth tokens (if needed later)
api.interceptors.request.use(
  (config) => {
    // Add auth token here if implemented
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const requestUrl = String(config.url || '');
    if (/\/auth\/(refresh|logout)/.test(requestUrl)) {
      const headers = AxiosHeaders.from(config.headers);
      for (const [key, value] of Object.entries(getCsrfHeaders())) {
        headers.set(key, value);
      }
      config.headers = headers;
      config.withCredentials = true;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
let refreshRequest: Promise<string> | null = null;
let sessionExpirationRedirectStarted = false;

// Bounded retry for idempotent GET requests only — a transient network
// blip, timeout, or 5xx shouldn't strand a user who just needs the same
// read repeated. POST/PATCH/PUT/DELETE are never retried here: retrying a
// write after an ambiguous failure risks double-submitting it.
const MAX_GET_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

function isIdempotentGetRequest(config: { method?: string } | undefined): boolean {
  return (config?.method ?? '').toLowerCase() === 'get';
}

function isTransientError(error: {
  response?: { status?: number };
  code?: string;
}): boolean {
  if (!error.response) return true; // network error, CORS failure, or timeout
  const status = error.response.status ?? 0;
  return status >= 500 && status < 600;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isCancel(error)) {
      // Expected: useServerTable (and similar callers) abort an in-flight
      // request when filters/pagination change before it resolves. Not a
      // network failure, so don't scare the console or fire the
      // network-error UI event for it.
      return Promise.reject(error);
    }

    const retryConfig = error.config as
      | (typeof error.config & { _getRetryCount?: number })
      | undefined;

    if (
      retryConfig &&
      isIdempotentGetRequest(retryConfig) &&
      isTransientError(error)
    ) {
      const retryCount = retryConfig._getRetryCount ?? 0;
      if (retryCount < MAX_GET_RETRIES) {
        retryConfig._getRetryCount = retryCount + 1;
        await wait(RETRY_BASE_DELAY_MS * 2 ** retryCount);
        return api(retryConfig);
      }
    }

    if (error.code === 'ERR_NETWORK' || !error.response) {
      console.error('[API] Network/CORS error', {
        baseURL: API_BASE_URL,
        url: error.config?.url,
        method: error.config?.method,
        message: error.message,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('app:api-network-error', {
            detail: {
              message: error.message,
              url: error.config?.url,
              method: error.config?.method,
            },
          }),
        );
      }
    }

    const status = error.response?.status;
    const requestUrl = String(error.config?.url || '');
    const isAuthEndpoint = /\/auth\/(login|logout|register|forgot-password|reset-password|refresh|google\/exchange)/.test(requestUrl);
    const isExpectedAuthFailure = status === 401 && isAuthEndpoint;

    const originalRequest = error.config as typeof error.config & { _retry?: boolean };
    if (status === 401 && !isAuthEndpoint && !originalRequest?._retry) {
      originalRequest._retry = true;
      refreshRequest ??= axios
        .post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          {
            withCredentials: true,
            headers: getCsrfHeaders(),
            timeout: DEFAULT_REQUEST_TIMEOUT_MS,
          },
        )
        .then((response) => {
          const session = parseLocalLoginSession(response.data);
          updateStoredTokens(session.authToken);
          updateStoredUser(session.user);
          return session.authToken;
        })
        .finally(() => {
          refreshRequest = null;
        });

      return refreshRequest.then((nextToken) => {
        if (originalRequest.signal?.aborted) {
          return Promise.reject(new axios.CanceledError('Request was canceled'));
        }

        const headers = AxiosHeaders.from(originalRequest.headers);
        headers.set('Authorization', `Bearer ${nextToken}`);
        originalRequest.headers = headers;
        return api(originalRequest);
      }).catch((refreshError) => {
        if (isConfirmedRefreshAuthFailure(refreshError)) {
          redirectToLoginOnce(refreshError);
        }
        return Promise.reject(refreshError);
      });
    }

    if (status === 401 && !isAuthEndpoint) {
      redirectToLoginOnce(error);
    }
    const suppressErrorLog = Boolean(
      (error.config as QuietAxiosConfig | undefined)?.suppressErrorLog,
    );

    if (!isExpectedAuthFailure && !suppressErrorLog) {
      console.error('API Error:', error);
    }
    return Promise.reject(error);
  }
);

export default api;

function redirectToLoginOnce(error: unknown): void {
  if (sessionExpirationRedirectStarted) return;
  sessionExpirationRedirectStarted = true;

  const code = getStableAuthFailureCode(error);
  clearAuthSession();
  dispatchSessionExpired();

  if (typeof window !== 'undefined') {
    const locale = window.location.pathname.split('/')[1] || 'en';
    window.location.href = getLoginRedirectForAuthFailure(locale, code);
  }
}

export function resetAuthRefreshState(): void {
  refreshRequest = null;
  sessionExpirationRedirectStarted = false;
}

export function getCsrfHeaders(): Record<string, string> {
  const csrfToken = getCookieValue('csrf_token');
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
}

function getCookieValue(key: string): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`));
  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : null;
}

type AnyObject = Record<string, unknown>;
type QuietAxiosConfig = {
  params?: AnyObject;
  suppressErrorLog?: boolean;
};
type PaginationParams = {
  page?: number;
  limit?: number;
  search?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  sort?: string;
};
type FilterPaginationParams = PaginationParams & Record<string, string | number | undefined>;

function withPagination(params?: PaginationParams) {
  if (!params) return {};
  return {
    params: {
      page: params.page,
      limit: params.limit,
      search: params.search,
      approvalStatus: params.approvalStatus,
      sort: params.sort,
    },
  };
}

function quiet(config: QuietAxiosConfig = {}) {
  return {
    ...config,
    suppressErrorLog: true,
  };
}

// Generic CRUD operations
export const apiService = {
  // Users
  getUsers: (params?: PaginationParams) => api.get('/users', withPagination(params)),
  createUser: (data: AnyObject) => api.post('/users', data),
  updateUser: (id: string, data: AnyObject) => api.patch(`/users/${id}`, data),
  relinkUserGoogleAuth: (id: string, data: { google_id: string }) =>
    api.patch(`/users/${id}/google-auth`, data),
  unlinkUserGoogleAuth: (id: string) => api.delete(`/users/${id}/google-auth`),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  uploadPhoto(formData: FormData) {
    return api.post('/users/upload-photo', formData, {
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  uploadUserPhoto: (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return api.post('/users/upload-photo', formData, {
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getUsersTotal: () => api.get('/users/total'),

  // Machines
  getMachines: (params?: PaginationParams) => api.get('/machines', withPagination(params)),
  createMachine: (data: AnyObject) => api.post('/machines', data),
  updateMachine: (id: string, data: AnyObject) => api.patch(`/machines/${id}`, data),
  deleteMachine: (id: string) => api.delete(`/machines/${id}`),

  // Machine timeline (header/stats + chronological event feed)
  getMachineTimelineSummary: (machineId: string, options?: { signal?: AbortSignal }) =>
    api.get(`/machines/${machineId}/timeline/summary`, { signal: options?.signal }),
  getMachineTimeline: (
    machineId: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      types?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    options?: { signal?: AbortSignal },
  ) => api.get(`/machines/${machineId}/timeline`, { params, signal: options?.signal }),

  // Device monitoring (Admin registration + role-scoped live status)
  getDevices: () => api.get('/devices'),
  getDevice: (id: string) => api.get(`/devices/${id}`),
  registerDevice: (data: AnyObject) => api.post('/devices', data),
  updateDevice: (id: string, data: AnyObject) => api.patch(`/devices/${id}`, data),
  rotateDeviceKey: (id: string) => api.post(`/devices/${id}/rotate-key`),
  deleteDevice: (id: string) => api.delete(`/devices/${id}`),

  getLiveMonitoringSummary: () => api.get('/live-monitoring/machines'),
  getMachineLiveStatus: (machineId: string) => api.get(`/live-monitoring/machines/${machineId}`),
  resolveFaultEvent: (id: string) => api.patch(`/live-monitoring/faults/${id}/resolve`),

  // Machine Types
  getMachineTypes: (params?: PaginationParams) => api.get('/machine-types', withPagination(params)),
  createMachineType: (data: AnyObject) => api.post('/machine-types', data),
  updateMachineType: (id: string, data: AnyObject) => api.patch(`/machine-types/${id}`, data),
  deleteMachineType: (id: string) => api.delete(`/machine-types/${id}`),

  // Module Types
  getModuleTypes: (params?: PaginationParams) => api.get('/module-types', withPagination(params)),
  createModuleType: (data: AnyObject) => api.post('/module-types', data),
  updateModuleType: (id: string, data: AnyObject) => api.patch(`/module-types/${id}`, data),
  deleteModuleType: (id: string) => api.delete(`/module-types/${id}`),

  // Modules
  getModules: (params?: PaginationParams) => api.get('/modules', withPagination(params)),
  createModule: (data: AnyObject) => api.post('/modules', data),
  updateModule: (id: string, data: AnyObject) => api.patch(`/modules/${id}`, data),
  deleteModule: (id: string) => api.delete(`/modules/${id}`),

  // Maintenance Plans
  getMaintenancePlans: (
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      sort?: string;
      status?: string;
      typeMaintenance?: string;
    },
    options?: { signal?: AbortSignal },
  ) => api.get('/maintenance-plans', { params, signal: options?.signal }),
  createMaintenancePlan: (data: AnyObject) => api.post('/maintenance-plans', data),
  updateMaintenancePlan: (id: string, data: AnyObject) => api.patch(`/maintenance-plans/${id}`, data),
  deleteMaintenancePlan: (id: string, expectedVersion?: number) =>
    api.delete(`/maintenance-plans/${id}`, {
      params: expectedVersion !== undefined ? { expected_version: expectedVersion } : undefined,
    }),
  transitionMaintenancePlan: (
    id: string,
    action: 'activate' | 'pause' | 'resume' | 'archive' | 'complete',
    reason?: string,
  ) => api.patch(`/maintenance-plans/${id}/transition`, { action, reason }),

  // Catalogues
  getCatalogues: (params?: PaginationParams) => api.get('/catalogues', withPagination(params)),
  createCatalogue: (data: AnyObject) => api.post('/catalogues', data),
  updateCatalogue: (id: string, data: AnyObject) => api.patch(`/catalogues/${id}`, data),
  deleteCatalogue: (id: string) => api.delete(`/catalogues/${id}`),

  // Stocks
  getStocks: (params?: PaginationParams) => api.get('/stocks', withPagination(params)),
  createStock: (data: AnyObject) => api.post('/stocks', data),
  updateStock: (id: string, data: AnyObject) => api.patch(`/stocks/${id}`, data),
  deleteStock: (id: string) => api.delete(`/stocks/${id}`),
  adjustStock: (
    id: string,
    data: { delta: number; reason: string; expected_version?: number },
  ) => api.post(`/stocks/${id}/adjustment`, data),
  getStockMovements: (id: string, params?: PaginationParams) =>
    api.get(`/stocks/${id}/movements`, withPagination(params)),

  // OT Pieces
  getOtPieces: (params?: PaginationParams) => api.get('/ot-pieces', withPagination(params)),
  createOtPiece: (data: AnyObject) => api.post('/ot-pieces', data),
  requestOperatorParts: (workOrderId: string, data: { part_id: string; quantity: number }) =>
    api.post(`/operator/work-orders/${workOrderId}/parts-request`, data),
  updateOtPiece: (id: string, data: AnyObject) => api.patch(`/ot-pieces/${id}`, data),
  deleteOtPiece: (id: string) => api.delete(`/ot-pieces/${id}`),

  // Lubrifiants and logs
  getLubrifiants: (params?: PaginationParams) => api.get('/lubrifiants', withPagination(params)),
  createLubrifiant: (data: AnyObject) => api.post('/lubrifiants', data),
  updateLubrifiant: (id: string, data: AnyObject) => api.patch(`/lubrifiants/${id}`, data),
  deleteLubrifiant: (id: string) => api.delete(`/lubrifiants/${id}`),
  getLubrificationLogs: (params?: PaginationParams) => api.get('/lubrification-logs', withPagination(params)),
  createLubrificationLog: (data: AnyObject) => api.post('/lubrification-logs', data),
  updateLubrificationLog: (id: string, data: AnyObject) => api.patch(`/lubrification-logs/${id}`, data),
  deleteLubrificationLog: (id: string) => api.delete(`/lubrification-logs/${id}`),

  // KPI
  getKpis: (params?: PaginationParams) => api.get('/kpis', withPagination(params)),
  createKpi: (data: AnyObject) => api.post('/kpis', data),
  updateKpi: (id: string, data: AnyObject) => api.patch(`/kpis/${id}`, data),
  deleteKpi: (id: string) => api.delete(`/kpis/${id}`),

  // Machines total count (non-paginated)
  getMachinesTotal: () => api.get('/machines/total'),

  // Work Orders
  getWorkOrders: (
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      sort?: string;
      status?: string;
      priority?: string;
      machineId?: string;
      technicianId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    options?: { signal?: AbortSignal },
  ) => api.get('/work-orders', { params, signal: options?.signal }),
  getMyWorkOrders: (params?: PaginationParams) => api.get('/operator/work-orders/my', withPagination(params)),

  getCalendarEvents: (params?: AnyObject) =>
    api.get('/work-orders/calendar/events', { params }),
  getCalendarTimeline: (params?: AnyObject) =>
    api.get('/work-orders/calendar/timeline', { params }),
  getCalendarWidget: () => api.get('/work-orders/calendar/widget'),
  getCalendarNotifications: () => api.get('/work-orders/calendar/notifications'),
  getCalendarEventDetails: (id: string) => api.get(`/work-orders/calendar/event/${id}`),
  completeWorkOrder: (id: string) => api.post(`/work-orders/${id}/complete`),
  rescheduleWorkOrder: (id: string, data: { new_due_date: string; reason: string }) =>
    api.patch(`/work-orders/${id}/reschedule`, data),

  // Operator-scoped calendar (personal widgets/notifications/timeline/event
  // actions, hard-limited server-side to work orders assigned to the
  // authenticated Operator — never the Admin-only /work-orders/calendar/* routes above)
  getMyCalendarWidget: () => api.get('/operator/calendar/widget'),
  getMyCalendarNotifications: () => api.get('/operator/calendar/notifications'),
  getMyCalendarTimeline: (params?: AnyObject) =>
    api.get('/operator/calendar/timeline', { params }),
  getMyCalendarEventDetails: (id: string) => api.get(`/operator/calendar/events/${id}`),
  startMyCalendarEvent: (id: string) => api.post(`/operator/calendar/events/${id}/start`),
  completeMyCalendarEvent: (id: string) => api.post(`/operator/calendar/events/${id}/complete`),
  rescheduleMyCalendarEvent: (id: string, data: { new_due_date: string; reason: string }) =>
    api.patch(`/operator/calendar/events/${id}/reschedule`, data),
  validateWorkOrder: (
    id: string,
    data: { action: 'approve' | 'reject' | 'request_correction'; technician_id?: string },
  ) => api.post(`/work-orders/${id}/validation`, data),
  getCorrectiveAssistant: (params?: AnyObject) =>
    api.get('/work-orders/calendar/corrective-assistant', { params }),

  createWorkOrder: (data: AnyObject) => api.post('/work-orders', data),
  updateWorkOrder: (id: string, data: AnyObject) => api.patch(`/work-orders/${id}`, data),
  deleteWorkOrder: (id: string) => api.delete(`/work-orders/${id}`),
  getWorkOrderStatistics: () => api.get('/work-orders/statistics'),
  getAdminDashboard: () => api.get('/dashboard/admin'),
  getOperatorDashboard: () => api.get('/operator/dashboard'),
  getTechnicianDashboard: () => api.get('/technician/dashboard'),
  getTechnicianWorkOrders: (params?: AnyObject) => api.get('/technician/work-orders', { params }),
  getTechnicianWorkOrder: (id: string) => api.get(`/technician/work-orders/${id}`),
  getTechnicianManuals: (params?: AnyObject) => api.get('/technician/manuals', { params }),
  getTechnicianParts: (params?: AnyObject) => api.get('/technician/parts', { params }),
  claimTechnicianWorkOrder: (id: string) => api.patch(`/technician/work-orders/${id}/claim`),
  reviewTechnicianWorkOrder: (id: string, action: 'return' | 'intervene') => api.patch(`/technician/work-orders/${id}/review`, { action }),
  startTechnicianWorkOrder: (id: string) => api.patch(`/technician/work-orders/${id}/start`),
  waitForTechnicianParts: (id: string) => api.patch(`/technician/work-orders/${id}/waiting-parts`),
  resumeTechnicianWorkOrder: (id: string) => api.patch(`/technician/work-orders/${id}/resume`),
  updateTechnicianReport: (id: string, data: AnyObject) => api.patch(`/technician/work-orders/${id}/report`, data),
  setTechnicianPartQuantity: (id: string, data: { partId: string; quantity: number }) => api.post(`/technician/work-orders/${id}/parts`, data),
  closeTechnicianWorkOrder: (id: string) => api.patch(`/technician/work-orders/${id}/close`),

  // Capteurs (Sensors)
  getCapteurs: (params?: PaginationParams) => api.get('/capteurs', withPagination(params)),
  createCapteur: (data: AnyObject) => api.post('/capteurs', data),
  updateCapteur: (id: string, data: AnyObject) => api.patch(`/capteurs/${id}`, data),
  deleteCapteur: (id: string) => api.delete(`/capteurs/${id}`),

  // Sensor measurements
  getMesures: (params?: FilterPaginationParams) => api.get('/mesures', { params }),
  createMesure: (data: AnyObject) => api.post('/mesures', data),
  updateMesure: (id: string, data: AnyObject) => api.patch(`/mesures/${id}`, data),
  deleteMesure: (id: string) => api.delete(`/mesures/${id}`),

  // Standard parts assigned to module types
  getModulePieces: (params?: FilterPaginationParams) => api.get('/module-pieces', { params }),
  createModulePiece: (data: AnyObject) => api.post('/module-pieces', data),
  updateModulePiece: (id: string, data: AnyObject) => api.patch(`/module-pieces/${id}`, data),
  deleteModulePiece: (id: string) => api.delete(`/module-pieces/${id}`),

  // Persistent preventive checklist tasks
  getPreventiveTasks: (params?: FilterPaginationParams) => api.get('/preventive-tasks', { params }),
  createPreventiveTask: (data: AnyObject) => api.post('/preventive-tasks', data),
  updatePreventiveTask: (id: string, data: AnyObject) => api.patch(`/preventive-tasks/${id}`, data),
  deletePreventiveTask: (id: string) => api.delete(`/preventive-tasks/${id}`),
  syncPreventiveTasks: () => api.post('/preventive-tasks/sync-plans'),

  // Intervention Reports
  getInterventionReports: (params?: PaginationParams) => api.get('/intervention-reports', withPagination(params)),
  getMyInterventionReports: (params?: PaginationParams) => api.get('/operator/reports/my', withPagination(params)),
  createInterventionReport: (data: AnyObject) => api.post('/intervention-reports', data),
  updateInterventionReport: (id: string, data: AnyObject) => api.patch(`/intervention-reports/${id}`, data),
  deleteInterventionReport: (id: string) => api.delete(`/intervention-reports/${id}`),

  // Pannes
  getPannes: (params?: PaginationParams) => api.get('/pannes', withPagination(params)),
  getOperatorFaults: (params?: AnyObject) => api.get('/operator/faults', { params }),
  createPanne: (data: AnyObject) => api.post('/pannes', data),
  updatePanne: (id: string, data: AnyObject) => api.patch(`/pannes/${id}`, data),
  deletePanne: (id: string) => api.delete(`/pannes/${id}`),

  // Panne Solutions
  getPanneSolutions: (params?: PaginationParams) => api.get('/panne-solutions', withPagination(params)),
  getOperatorFaultSolutions: (params?: AnyObject) => api.get('/operator/fault-solutions', { params }),
  createPanneSolution: (data: AnyObject) => api.post('/panne-solutions', data),
  updatePanneSolution: (id: string, data: AnyObject) => api.patch(`/panne-solutions/${id}`, data),
  deletePanneSolution: (id: string) => api.delete(`/panne-solutions/${id}`),

  getDocuments: (params?: PaginationParams) => api.get('/documents', withPagination(params)),
  getDocumentsByMachine: (machineId: string) => api.get(`/documents/machine/${machineId}`),
  getOperatorManuals: (params?: AnyObject) => api.get('/operator/manuals', { params }),

  getDocument: (id: string) => api.get(`/documents/${id}`),

  createDocument: (data: AnyObject) => api.post('/documents', data),

  updateDocument: (id: string, data: AnyObject) => api.put(`/documents/${id}`, data),

  uploadDocument: (formData: FormData) =>
    api.post('/documents/upload', formData, {
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),

  deleteDocument: (id: string) => api.delete(`/documents/${id}`),

  getDocumentVersions: (id: string) => api.get(`/documents/${id}/versions`),

  publishDocument: (id: string, data?: { reason?: string; expected_version?: number }) =>
    api.patch(`/documents/${id}/publish`, data ?? {}),

  archiveDocument: (id: string, data?: { reason?: string; expected_version?: number }) =>
    api.patch(`/documents/${id}/archive`, data ?? {}),

  replaceDocument: (id: string, formData: FormData) =>
    api.post(`/documents/${id}/replace`, formData, {
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),

  // Knowledge Base
  getKnowledgeArticles: (params?: AnyObject) => api.get('/knowledge-base/articles', { params }),

  getKnowledgeArticleSuggestions: (params?: AnyObject) =>
    api.get('/knowledge-base/articles/suggestions', { params }),

  getKnowledgeArticle: (id: string) => api.get(`/knowledge-base/articles/${id}`),

  getKnowledgeArticleVersions: (id: string) => api.get(`/knowledge-base/articles/${id}/versions`),

  createKnowledgeArticle: (data: AnyObject) => api.post('/knowledge-base/articles', data),

  updateKnowledgeArticle: (id: string, data: AnyObject) =>
    api.put(`/knowledge-base/articles/${id}`, data),

  publishKnowledgeArticle: (id: string, data?: { reason?: string; expected_version?: number }) =>
    api.patch(`/knowledge-base/articles/${id}/publish`, data ?? {}),

  archiveKnowledgeArticle: (id: string, data?: { reason?: string; expected_version?: number }) =>
    api.patch(`/knowledge-base/articles/${id}/archive`, data ?? {}),

  reviseKnowledgeArticle: (id: string, data: AnyObject) =>
    api.post(`/knowledge-base/articles/${id}/revise`, data),

  deleteKnowledgeArticle: (id: string) => api.delete(`/knowledge-base/articles/${id}`),

  // AI corrective assistant (advisory only — never mutates work orders, stock, or machine status)
  requestAiAssistantRecommendation: (data: {
    machineId?: string;
    workOrderId?: string;
    faultCode?: string;
    question: string;
    locale: string;
  }) => api.post('/ai-assistant/recommendations', data),

  getAiAssistantHistory: () => api.get('/ai-assistant/history'),

  getAllAiAssistantHistory: () => api.get('/ai-assistant/history/all'),

  getAiAssistantHealth: () => api.get('/ai-assistant/health'),

  // Predictive maintenance (advisory only — read endpoints never mutate a work order, stock, or machine)
  getPredictiveFleetSummary: () => api.get('/predictive-maintenance/fleet-summary'),

  getPredictivePlansSummary: () => api.get('/predictive-maintenance/plans-summary'),

  getMachineHealthPredictions: (machineId: string) =>
    api.get(`/predictive-maintenance/machines/${machineId}`),

  getMachineHealthHistory: (machineId: string, params?: AnyObject) =>
    api.get(`/predictive-maintenance/machines/${machineId}/history`, { params }),

  refreshMachineHealthPrediction: (machineId: string) =>
    api.post(`/predictive-maintenance/machines/${machineId}/refresh`),

  getPredictionModelVersions: () => api.get('/predictive-maintenance/models'),

  trainPredictionModel: (modelType: string) =>
    api.post(`/predictive-maintenance/models/${modelType}/train`),

  // Get all data for dashboard
  getDashboardData: async (options: { includeUsers?: boolean } = {}) => {
    try {
      const requests = {
        ...(options.includeUsers ? { users: api.get('/users', quiet()) } : {}),
        machines: api.get('/machines', quiet()),
        machineTypes: api.get('/machine-types', quiet()),
        workOrders: api.get('/work-orders', quiet()),
        catalogues: api.get('/catalogues', quiet()),
        moduleTypes: api.get('/module-types', quiet()),
        capteurs: api.get('/capteurs', quiet()),
      };

      const entries = await Promise.all(
        Object.entries(requests).map(async ([key, request]) => {
          const value = await Promise.resolve(request).then(
            (response) => response.data,
            () => [],
          );

          return [key, value] as const;
        }),
      );
      const data = Object.fromEntries(entries);

      return {
        users: data.users ?? [],
        machines: data.machines ?? [],
        machineTypes: data.machineTypes ?? [],
        workOrders: data.workOrders ?? [],
        catalogues: data.catalogues ?? [],
        moduleTypes: data.moduleTypes ?? [],
        capteurs: data.capteurs ?? [],
      };
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      throw error;
    }
  },

  getMyMachines: (params?: PaginationParams & { machineTypeId?: string }) =>
    api.get('/operator/machines/my', {
      params: {
        page: params?.page,
        limit: params?.limit,
        machineTypeId: params?.machineTypeId,
      },
    }),
  getOperatorMachineTypes: (params?: PaginationParams) =>
    api.get('/operator/machine-types', withPagination(params)),
  getOperatorModules: (params?: PaginationParams) =>
    api.get('/operator/modules', withPagination(params)),
  getOperatorMaintenancePlans: (params?: PaginationParams) =>
    api.get('/operator/maintenance-plans', withPagination(params)),
  getOperatorLubrifiants: (params?: PaginationParams) =>
    api.get('/operator/lubrifiants', withPagination(params)),
  getOperatorKpis: (params?: PaginationParams) =>
    api.get('/operator/kpis', withPagination(params)),
  getOperatorCatalogues: (params?: PaginationParams) =>
    api.get('/operator/catalogues', withPagination(params)),
  getOperatorStocks: (params?: PaginationParams) =>
    api.get('/operator/stocks', withPagination(params)),

  getMyCalendarEvents: (params?: AnyObject) => api.get('/operator/calendar/my', { params }),
  getOperatorPreventiveStates: (params: { machineId: string }) =>
    api.get('/operator/preventive/states', { params }),
  getOperatorPreventiveTaskChecklist: (
    params?: PaginationParams & { machineId?: string; machineTypeId?: string; status?: string },
  ) => api.get('/operator/preventive-tasks', { params }),
  updateOperatorPreventiveTaskChecklist: (id: string, data: { status?: 'pending' | 'completed'; notes?: string }) =>
    api.patch(`/operator/preventive-tasks/${id}`, data),
  scheduleOperatorPreventive: (data: { machine_id: string; plan_id: string; scheduled_date: string }) =>
    api.post('/operator/preventive/schedule', data),
  createOperatorCorrectiveReport: (data: {
    machine_id: string;
    code_panne: string;
    fault_description?: string;
    actions: string[];
    priority?: string;
  }) => api.post('/operator/report-problem', data),
  submitOperatorPreventiveMaintenance: (data: {
    work_order_id: string;
    tasks_completed: string[];
    condition: string;
    comments?: string;
    lubrication?: { lubrifiant_id: string; quantity: number };
  }) => api.post('/operator/preventive/submit', data),

  async fetchAllFromPaginatedEndpoint<T>(
    request: (params?: { page?: number; limit?: number }) => Promise<{ data: unknown }>,
    pageSize = 100,
  ): Promise<T[]> {
    const firstResponse = await request({ page: 1, limit: pageSize });
    const firstItems = normalizeApiItems<T>(firstResponse.data);
    const pagination = readPaginationMeta(firstResponse.data);

    if (!pagination || pagination.totalPages <= 1) {
      return firstItems;
    }

    const remainingRequests: Array<Promise<{ data: unknown }>> = [];
    for (let page = pagination.page + 1; page <= pagination.totalPages; page += 1) {
      remainingRequests.push(request({ page, limit: pageSize }));
    }

    const remainingResponses = await Promise.all(remainingRequests);
    const remainingItems = remainingResponses.flatMap((response) =>
      normalizeApiItems<T>(response.data),
    );

    return [...firstItems, ...remainingItems];
  },

  // In-app notifications — one shared, role-scoped surface for
  // Operator/Technician/Admin; the backend derives identity from the
  // authenticated request, so every call here only ever returns/affects
  // notifications visible to the current user.
  getNotifications: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get('/notifications', { params }),
  getUnreadNotificationCount: () => api.get('/notifications/unread-count'),
  markNotificationRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllNotificationsRead: () => api.patch('/notifications/read-all'),
  clearNotification: (id: string) => api.delete(`/notifications/${id}`),
  clearAllNotifications: () => api.delete('/notifications'),

  // Technician/Admin part-request decision
  decidePartRequest: (id: string, action: 'approve' | 'reject') =>
    api.patch(`/work-orders/part-requests/${id}/decision`, { action }),

  // Reports — role-scoped exports built from existing KPI/maintenance/
  // stock/document/predictive data. Generation is async: `requestReport`
  // returns a `pending` row immediately, the caller polls `getReport(id)`
  // for status, then `downloadReportFile(id)` once `status` is `completed`.
  getReportTypes: () => api.get('/reports/types'),
  getReports: (
    params?: { page?: number; limit?: number; type?: string; status?: string; format?: string; sort?: string },
    options?: { signal?: AbortSignal },
  ) => api.get('/reports', { params, signal: options?.signal }),
  getAllReports: (
    params?: { page?: number; limit?: number; type?: string; status?: string; format?: string; sort?: string },
    options?: { signal?: AbortSignal },
  ) => api.get('/reports/all', { params, signal: options?.signal }),
  getReport: (id: string) => api.get(`/reports/${id}`),
  requestReport: (data: {
    type: string;
    format: string;
    parameters?: Record<string, unknown>;
  }) => api.post('/reports', data),
  deleteReport: (id: string) => api.delete(`/reports/${id}`),
  // Downloaded as a blob (not a plain <a href>) because the route sits
  // behind JwtAuthGuard and needs the Authorization header the axios
  // interceptor attaches — mirrors DocumentAttachmentViewer's pattern.
  downloadReportFile: (id: string) =>
    api.get(`/reports/${id}/download`, {
      responseType: 'blob',
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    }),
  getReportSchedules: () => api.get('/reports/schedules'),
  createReportSchedule: (data: {
    type: string;
    format: string;
    frequency: string;
    parameters?: Record<string, unknown>;
  }) => api.post('/reports/schedules', data),
  updateReportSchedule: (
    id: string,
    data: { active?: boolean; frequency?: string; parameters?: Record<string, unknown> },
  ) => api.patch(`/reports/schedules/${id}`, data),
  deleteReportSchedule: (id: string) => api.delete(`/reports/schedules/${id}`),

  // Saved views — per-user, per-page saved search/filter/sort state.
  getSavedViews: (pageKey: string) => api.get('/saved-views', { params: { pageKey } }),
  createSavedView: (data: { pageKey: string; name: string; query: Record<string, unknown>; isDefault?: boolean }) =>
    api.post('/saved-views', data),
  updateSavedView: (
    id: string,
    data: { name?: string; query?: Record<string, unknown>; isDefault?: boolean },
  ) => api.patch(`/saved-views/${id}`, data),
  deleteSavedView: (id: string) => api.delete(`/saved-views/${id}`),

  // Transactional bulk user approve/reject — either every selected user
  // is approved/rejected or none are (see backend UsersService).
  bulkApproveUsers: (userIds: string[]) => api.post('/users/bulk-approve', { userIds }),
  bulkRejectUsers: (userIds: string[], reason: string) =>
    api.post('/users/bulk-reject', { userIds, reason }),
};
