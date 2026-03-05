import type { AppDefinition } from "../../types/platform";
import { useAppContext } from "./PlatformProvider";

export function useCurrentApp(): {
  app: AppDefinition | undefined;
  apps: AppDefinition[];
  switchApp: (id: string) => void;
} {
  const { apps, currentAppId, switchApp } = useAppContext();

  const app = apps.find((a) => a.id === currentAppId) ?? apps[0];

  return { app: apps.length > 0 ? app : undefined, apps, switchApp };
}
