/**
 * A message that outlives one navigation: "Profile deleted" is shown on the Welcome screen after
 * the privacy screen redirects there. Held in sessionStorage for one read; if storage is blocked
 * the message is simply not shown.
 */
const KEY = "mira-flash";
export const FLASH_EVENT = "mira:flash";

export function flash(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // Storage blocked: the page change still happens, only the toast is lost.
  }
  window.dispatchEvent(new Event(FLASH_EVENT));
}

export function takeFlash(): string | undefined {
  try {
    const message = sessionStorage.getItem(KEY) ?? undefined;
    if (message !== undefined) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return undefined;
  }
}
