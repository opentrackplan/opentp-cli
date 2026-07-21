import type { ReactNode } from "react";
import { PlatformProvider } from "./core/platform/PlatformProvider";
import { Roles } from "./types/platform";
import type { OpenTPPlatformProps } from "./types/platform";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";

// jsdom doesn't implement matchMedia — ThemeProvider needs it
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export function createTestWrapper(overrides?: Partial<OpenTPPlatformProps>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PlatformProvider role={Roles.EDITOR} {...overrides}>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </PlatformProvider>
    );
  };
}

export function createBareWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    );
  };
}
