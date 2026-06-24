import { useState, useEffect, useCallback } from "react";
import type { TrackingPlanData, DataSource } from "../types";
import { loadTrackingPlan } from "../api/client";

interface UseTrackingPlanResult {
  data: TrackingPlanData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTrackingPlan(source: DataSource): UseTrackingPlanResult {
  const [data, setData] = useState<TrackingPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    setError(null);
    try {
      const result = await loadTrackingPlan(source);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { data, loading, error, refetch: doFetch };
}
