import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

export interface WorkOrderKpiCounts {
  openCount: number;
  inProgressCount: number;
  overdueCount: number;
  dueTodayCount: number;
  waitingValidationCount: number;
  completedTodayCount: number;
  totalCount: number;
  currentMonthCount: number;
  lastMonthCount: number;
  percentageChange: number;
}

export interface StockAlertItem {
  stockId: string;
  stockCode: string;
  partId?: string;
  partLabel?: string;
  quantiteEnStock: number;
  quantiteReservee: number;
  available: number;
  threshold: number;
}

export interface WorkloadEntry {
  technicianId: string;
  name: string;
  openCount: number;
}

export interface AdminDashboardStatistics {
  workOrders: WorkOrderKpiCounts;
  stockAlerts: { count: number; items: StockAlertItem[] };
  preventiveCompliance: { ratePercent: number; onTimeCount: number; evaluableCount: number };
  correctiveResponseTime: { averageResponseHours: number; sampleSize: number };
  mttrMtbf: {
    mttrHours: number;
    mtbfHours: number;
    availabilityPercent: number;
    sampleSize: number;
  };
  workload: WorkloadEntry[];
  totals: { machines: number; users: number };
  businessTimezone: string;
  generatedAt: string;
  // Legacy fields kept for the topbar system-status widget, which reads
  // these two directly — both are just workOrders.percentageChange and a
  // fleet-wide "worth flagging" count, not separately computed.
  pendingMaintenance: number;
  percentageChange: number;
}

/**
 * The Admin dashboard's single data source. Every number this hook
 * exposes comes straight from `GET /dashboard/admin` (`KpiService`,
 * computed fresh from the current database) — nothing here is derived
 * client-side from paginated list endpoints, and nothing is fetched at
 * all for non-Admin roles (an Operator/Technician session simply never
 * calls an endpoint it isn't permitted to use).
 */
export function useDashboardStatistics() {
  const [statistics, setStatistics] = useState<AdminDashboardStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (authLoading) return;

    if (!user || !isAdmin) {
      setStatistics(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStatistics() {
      try {
        setLoading(true);
        const response = await apiService.getAdminDashboard();
        if (cancelled) return;

        const data = response.data as Omit<
          AdminDashboardStatistics,
          'pendingMaintenance' | 'percentageChange'
        >;

        setStatistics({
          ...data,
          pendingMaintenance:
            data.workOrders.overdueCount + data.workOrders.dueTodayCount,
          percentageChange: data.workOrders.percentageChange,
        });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching admin dashboard statistics:', err);
        setError('Failed to load statistics');
        setStatistics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatistics();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin, user]);

  return { statistics, loading, error };
}
