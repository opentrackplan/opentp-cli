import type { AccentColor } from "../../types/platform";
import type { AccentColorClasses } from "../../utils/accentColors";
import { getAccentClasses } from "../../utils/accentColors";
import { useBrandingContext } from "./PlatformProvider";

export function useBranding(): {
  title: string;
  logo: string | undefined;
  accentColor: AccentColor;
  accentClasses: AccentColorClasses;
  favicon: string | undefined;
} {
  const ctx = useBrandingContext();
  return {
    ...ctx,
    accentClasses: getAccentClasses(ctx.accentColor),
  };
}
