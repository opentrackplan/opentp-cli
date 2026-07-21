import { useState, useEffect } from "react";

export interface GeneratorInfo {
  name: string;
  target?: string;
  standalone?: boolean;
}

export interface UseGeneratorsResult {
  generators: GeneratorInfo[];
  bundleEnabled: boolean;
  loading: boolean;
  error: string | null;
}

export function useGenerators(baseUrl: string): UseGeneratorsResult {
  const [generators, setGenerators] = useState<GeneratorInfo[]>([]);
  const [bundleEnabled, setBundleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchGenerators() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/api/generators`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) {
          // Filter out `template` generator — it requires --file which the UI can't provide
          const gens = (data.generators ?? []).filter(
            (g: GeneratorInfo) => g.name !== "template",
          );
          setGenerators(gens);
          setBundleEnabled(data.bundleEnabled ?? false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchGenerators();

    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return { generators, bundleEnabled, loading, error };
}
