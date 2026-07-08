import axios from 'axios';
import { getApiBaseUrl } from '@/config/api-base-url';

const API_BASE_URL = getApiBaseUrl();

if (typeof window === 'undefined') {
  // Server-side startup log (visible in Vercel Function logs)
  console.log(`[API] Base URL resolved to: ${API_BASE_URL}`);
} else if (process.env.NODE_ENV !== 'production') {
  // Client-side dev log only — avoids leaking config in production browser console
  console.log(`[API] Base URL resolved to: ${API_BASE_URL}`);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth tokens (if needed later)
api.interceptors.request.use(
  (config) => {
    // Add auth token here if implemented
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
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
    const isAuthEndpoint = /\/auth\/(login|register|forgot-password|reset-password)/.test(requestUrl);
    const isExpectedAuthFailure = status === 401 && isAuthEndpoint;

    if (status === 401 && !isAuthEndpoint) {
      // Token expired or invalid, redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (typeof window !== 'undefined') {
        const locale = window.location.pathname.split('/')[1] || 'en';
        window.location.href = `/${locale}/auth/login`;
      }
    }
    if (!isExpectedAuthFailure) {
      console.error('API Error:', error);
    }
    return Promise.reject(error);
  }
);

export default api;

type AnyObject = Record<string, unknown>;
type PaginationParams = { page?: number; limit?: number };

function withPagination(params?: PaginationParams) {
  if (!params) return {};
  return {
    params: {
      page: params.page,
      limit: params.limit,
    },
  };
}

// Generic CRUD operations
export const apiService = {
  // Users
  getUsers: (params?: PaginationParams) => api.get('/users', withPagination(params)),
  createUser: (data: AnyObject) => api.post('/users', data),
  updateUser: (id: string, data: AnyObject) => api.patch(`/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  uploadPhoto(formData: FormData) {
    return api.post('/users/upload-photo', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  uploadUserPhoto: (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return api.post('/users/upload-photo', formData, {
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
  getMaintenancePlans: (params?: PaginationParams) => api.get('/maintenance-plans', withPagination(params)),
  createMaintenancePlan: (data: AnyObject) => api.post('/maintenance-plans', data),
  updateMaintenancePlan: (id: string, data: AnyObject) => api.patch(`/maintenance-plans/${id}`, data),
  deleteMaintenancePlan: (id: string) => api.delete(`/maintenance-plans/${id}`),

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

  // OT Pieces
  getOtPieces: (params?: PaginationParams) => api.get('/ot-pieces', withPagination(params)),
  createOtPiece: (data: AnyObject) => api.post('/ot-pieces', data),
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
  getWorkOrders: (params?: PaginationParams) => api.get('/work-orders', withPagination(params)),

  getCalendarEvents: (params?: AnyObject) =>
    api.get('/work-orders/calendar/events', { params }),
  getCalendarTimeline: (params?: AnyObject) =>
    api.get('/work-orders/calendar/timeline', { params }),
  getCalendarWidget: () => api.get('/work-orders/calendar/widget'),
  getCalendarNotifications: () => api.get('/work-orders/calendar/notifications'),
  getCalendarEventDetails: (id: string) => api.get(`/work-orders/calendar/event/${id}`),
  completeWorkOrder: (id: string) => api.post(`/work-orders/${id}/complete`),
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

  // Capteurs (Sensors)
  getCapteurs: (params?: PaginationParams) => api.get('/capteurs', withPagination(params)),
  createCapteur: (data: AnyObject) => api.post('/capteurs', data),
  updateCapteur: (id: string, data: AnyObject) => api.patch(`/capteurs/${id}`, data),
  deleteCapteur: (id: string) => api.delete(`/capteurs/${id}`),

  // Intervention Reports
  getInterventionReports: (params?: PaginationParams) => api.get('/intervention-reports', withPagination(params)),
  createInterventionReport: (data: AnyObject) => api.post('/intervention-reports', data),
  updateInterventionReport: (id: string, data: AnyObject) => api.patch(`/intervention-reports/${id}`, data),
  deleteInterventionReport: (id: string) => api.delete(`/intervention-reports/${id}`),

  // Pannes
  getPannes: (params?: PaginationParams) => api.get('/pannes', withPagination(params)),
  createPanne: (data: AnyObject) => api.post('/pannes', data),
  updatePanne: (id: string, data: AnyObject) => api.patch(`/pannes/${id}`, data),
  deletePanne: (id: string) => api.delete(`/pannes/${id}`),

  // Panne Solutions
  getPanneSolutions: (params?: PaginationParams) => api.get('/panne-solutions', withPagination(params)),
  createPanneSolution: (data: AnyObject) => api.post('/panne-solutions', data),
  updatePanneSolution: (id: string, data: AnyObject) => api.patch(`/panne-solutions/${id}`, data),
  deletePanneSolution: (id: string) => api.delete(`/panne-solutions/${id}`),

  getDocuments: (params?: PaginationParams) => api.get('/documents', withPagination(params)),

  getDocument: (id: string) => api.get(`/documents/${id}`),

  createDocument: (data: AnyObject) => api.post('/documents', data),

  updateDocument: (id: string, data: AnyObject) => api.put(`/documents/${id}`, data),

  uploadDocument: (formData: FormData) =>
    api.post('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),

  deleteDocument: (id: string) => api.delete(`/documents/${id}`),


  // Get all data for dashboard
  getDashboardData: async () => {
    try {
      const results = await Promise.allSettled([
        api.get('/users'),
        api.get('/machines'),
        api.get('/machine-types'),
        api.get('/work-orders'),
        api.get('/catalogues'),
        api.get('/module-types'),
        api.get('/capteurs')
      ]);

      // Extract successful results, use empty arrays for failed requests
      const [
        users,
        machines,
        machineTypes,
        workOrders,
        catalogues,
        moduleTypes,
        capteurs
      ] = results.map(result =>
        result.status === 'fulfilled' ? result.value : { data: [] }
      );

      return {
        users: users.data,
        machines: machines.data,
        machineTypes: machineTypes.data,
        workOrders: workOrders.data,
        catalogues: catalogues.data,
        moduleTypes: moduleTypes.data,
        capteurs: capteurs.data
      };
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      throw error;
    }
  },
};
