import { useState, useEffect } from 'react';

export interface Activity {
  id: string;
  type: string;
  title?: string;
  description?: string;
  date?: string;
  timestamp?: string;
  status?: string;
  [key: string]: unknown;
}

export function useRecentActivities(limit: number = 5) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const loading = false;

  useEffect(() => {
    // Mock data for now
    setActivities([
      { id: '1', type: 'system', title: 'System check completed', description: 'System check completed', timestamp: new Date().toISOString() }
    ]);
  }, [limit]);

  return { activities, loading };
}
