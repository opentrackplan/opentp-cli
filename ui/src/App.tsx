import { useTrackingPlan } from "./hooks/useTrackingPlan";
import { Layout } from "./components/layout/Layout";
import { useT } from "./i18n";
import { Modes } from "./types";
import type { DataSource, UIMode, OpenTPUIOptions } from "./types";

interface AppProps {
  source: DataSource;
  mode?: UIMode;
  options?: OpenTPUIOptions;
}

export function App({ source, mode = Modes.VIEWER, options }: AppProps) {
  const { data, loading, error, refetch } = useTrackingPlan(source);
  const { t } = useT();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950 text-gray-400">
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">
            {error}
          </p>
          <button
            onClick={refetch}
            className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return <Layout data={data} mode={mode} source={source} onRefetch={refetch} options={options} />;
}
