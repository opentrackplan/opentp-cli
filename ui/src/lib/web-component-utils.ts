/**
 * Shared utilities for Shadow DOM–based web components.
 * Used by both <opentp-viewer> and <opentp-platform>.
 */

export interface ShadowSetupResult {
  shadow: ShadowRoot;
  mountPoint: HTMLDivElement;
}

/**
 * Attach a shadow root to `host`, inject a <style> with the given CSS string,
 * and create a mount point <div> for React.
 */
export function setupShadowDom(
  host: HTMLElement,
  cssText: string,
): ShadowSetupResult {
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = cssText;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement("div");
  mountPoint.style.height = "100%";
  shadow.appendChild(mountPoint);

  return { shadow, mountPoint };
}
