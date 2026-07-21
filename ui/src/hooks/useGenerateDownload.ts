import { useState, useCallback } from "react";

export interface UseGenerateDownloadResult {
  downloading: boolean;
  error: string | null;
  download: (generatorName: string, target?: string) => void;
  downloadBundle: () => void;
}

function extractFilename(
  res: Response,
  fallback: string,
): string {
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    const match = disposition.match(/filename="?([^";\s]+)"?/);
    if (match) return match[1];
  }
  return fallback;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useGenerateDownload(baseUrl: string): UseGenerateDownloadResult {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(
    async (generatorName: string, target?: string) => {
      setDownloading(true);
      setError(null);
      try {
        const params = target ? `?target=${encodeURIComponent(target)}` : "";
        const res = await fetch(
          `${baseUrl}/api/generate/${encodeURIComponent(generatorName)}${params}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const filename = extractFilename(res, `${generatorName}-output`);
        triggerBlobDownload(blob, filename);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDownloading(false);
      }
    },
    [baseUrl],
  );

  const downloadBundle = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/export/bundle`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const filename = extractFilename(res, "tracking-plan.zip");
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }, [baseUrl]);

  return { downloading, error, download, downloadBundle };
}
