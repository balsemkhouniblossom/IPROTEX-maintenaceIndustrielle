
import { useState, useEffect } from 'react';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardStatistics {
  currentMonthWorkOrders: number;
  lastMonthWorkOrders: number;
  percentageChange: number;
  pendingMaintenance: number;
  totalWorkOrders: number;
  // Additional stats for dashboard cards
  activeUsers: number;
  totalMachines: number;
  activeWorkOrders: number;
  completedThisMonth: number;
  // Percentage changes
  usersPercentageChange: number;
  machinesPercentageChange: number;
  workOrdersPercentageChange: number;
  completedPercentageChange: number;
  totalUsers: number;
}

const emptyStatistics: DashboardStatistics = {
  currentMonthWorkOrders: 0,
  lastMonthWorkOrders: 0,
  percentageChange: 0,
  pendingMaintenance: 0,
  totalWorkOrders: 0,
  activeUsers: 0,
  totalUsers: 0,
  totalMachines: 0,
  activeWorkOrders: 0,
  completedThisMonth: 0,
  usersPercentageChange: 0,
  machinesPercentageChange: 0,
  workOrdersPercentageChange: 0,
  completedPercentageChange: 0,
};

export function useDashboardStatistics() {
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, isLoading: authLoading } = useAuth();
  const hasUser = Boolean(user);
  const userRole = user?.role;

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        setLoading(true);
        const includeUserStats = userRole === 'admin';

        // Fetch all data in parallel
        const results = await Promise.allSettled([
          apiService.getWorkOrderStatistics(),
          apiService.getDashboardData(),
          apiService.getMachinesTotal(),
          includeUserStats ? apiService.getUsersTotal() : Promise.resolve(null),
        ]);

        const workOrderStats =
          results[0].status === 'fulfilled' ? results[0].value : null;

        const dashboardData =
          results[1].status === 'fulfilled' ? results[1].value : null;

        const machinesTotalRes =
          results[2].status === 'fulfilled' ? results[2].value : null;

        const usersTotalRes =
          results[3].status === 'fulfilled' ? results[3].value : null;
        const data: any = dashboardData ?? {};
        const safeArray = (value: any) =>
          Array.isArray(value) ? value : value?.items ?? [];
        const machines = safeArray(data?.machines ?? []);
        const users = safeArray([]);
        const workOrders = safeArray(data?.workOrders ?? []);
        // API returns either { totalMachines } or { data: { totalMachines } } depending on axios wrapping
        const machinesTotal =
          machinesTotalRes?.data ??
          machinesTotalRes ??
          0;


        const usersTotal =
          usersTotalRes?.data?.totalUsers ??
          (usersTotalRes as any)?.totalUsers ??
          0;
        // Calculate current month vs last month for various metrics
        const now = new Date();
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        // Active users (current active users vs last month active users)
        const currentActiveUsers = usersTotalRes?.data?.activeUsers ?? 0;
        const lastMonthActiveUsers = users.filter((user: any) => {
          if (!user.is_active) return false;
          const createdDate = new Date(user.created_at);
          return createdDate < currentMonth && createdDate >= lastMonth;
        }).length;

        // Total machines should come from DB total (non-paginated)
        const currentMachines = machinesTotal;


        const lastMonthMachines = machines.filter((machine: any) => {
          const createdDate = machine.created_at
            ? new Date(machine.created_at)
            : null;

          if (!createdDate) return false;
          return createdDate < currentMonth && createdDate >= lastMonth;
        }).length;

        // Active work orders (current vs last month)
        const currentActiveWorkOrders =
          workOrders.filter((wo: any) => wo?.status && wo.status !== 'completed').length;
        const lastMonthActiveWorkOrders = workOrders.filter((wo: any) => {
          if (wo.status === 'completed') return false;
          const createdDate = new Date(wo.date_created);
          return createdDate < currentMonth && createdDate >= lastMonth;
        }).length;

        // Completed this month
        const completedThisMonth = workOrders.filter((wo: any) => {
          if (wo.status !== 'completed') return false;
          const completedDate = new Date(wo.date_end || wo.date_closed || wo.date_created);
          return completedDate >= currentMonth;
        }).length;

        // Calculate percentage changes
        const usersPercentageChange = lastMonthActiveUsers > 0 ? ((currentActiveUsers - lastMonthActiveUsers) / lastMonthActiveUsers) * 100 : 0;
        const machinesPercentageChange = lastMonthMachines > 0 ? ((currentMachines - lastMonthMachines) / lastMonthMachines) * 100 : 0;
        const workOrdersPercentageChange = lastMonthActiveWorkOrders > 0 ? ((currentActiveWorkOrders - lastMonthActiveWorkOrders) / lastMonthActiveWorkOrders) * 100 : 0;

        setStatistics({
          currentMonthWorkOrders: workOrderStats?.data?.currentMonthWorkOrders ?? 0,
          lastMonthWorkOrders: workOrderStats?.data?.lastMonthWorkOrders ?? 0,
          percentageChange: workOrderStats?.data?.percentageChange ?? 0,
          pendingMaintenance: workOrderStats?.data?.pendingMaintenance ?? 0,
          totalWorkOrders: workOrderStats?.data?.totalWorkOrders ?? 0,
          completedPercentageChange: workOrderStats?.data?.percentageChange ?? 0,
          activeUsers: currentActiveUsers,
          totalUsers: usersTotal,
          totalMachines: currentMachines,
          activeWorkOrders: currentActiveWorkOrders,
          completedThisMonth: completedThisMonth,
          usersPercentageChange: Math.round(usersPercentageChange * 100) / 100,
          machinesPercentageChange: Math.round(machinesPercentageChange * 100) / 100,
          workOrdersPercentageChange: Math.round(workOrdersPercentageChange * 100) / 100,
        });

        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard statistics:', err);
        setError('Failed to load statistics');
        // Set default values if API fails
        setStatistics({
          currentMonthWorkOrders: 0,
          lastMonthWorkOrders: 0,
          percentageChange: 0,
          pendingMaintenance: 0,
          totalWorkOrders: 0,
          activeUsers: 0,
          totalUsers: 0,
          totalMachines: 0,
          activeWorkOrders: 0,
          completedThisMonth: 0,
          usersPercentageChange: 0,
          machinesPercentageChange: 0,
          workOrdersPercentageChange: 0,
          completedPercentageChange: 0
        });
      } finally {
        setLoading(false);
      }
    };

    if (authLoading) {
      return;
    }

    if (!hasUser) {
      setStatistics(emptyStatistics);
      setLoading(false);
      return;
    }

    fetchStatistics();
  }, [authLoading, hasUser, userRole]);

  return { statistics, loading, error };
}
