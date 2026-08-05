import { useEffect, useState } from 'react';
import type { MachineHealthSummary } from '@/hooks/usePredictiveHealth';
import { apiService } from '@/services/api';

export function usePlanHealth() {
  const [planHealth, setPlanHealth] = useState<Record<string, MachineHealthSummary>>({});

  useEffect(() => {
    apiService
      .getPredictivePlansSummary()
      .then((response) => {
        setPlanHealth(response.data && typeof response.data === 'object' ? response.data : {});
      })
      .catch((error) => {
        console.error('Failed to load predictive maintenance plan health summary', error);
        setPlanHealth({});
      });
  }, []);

  return { planHealth };
}
