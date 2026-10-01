/**
 * Shared admin session handling for the PIN-gated /admin pages.
 *
 * The server keeps admin sessions in memory, so every token dies on deploy or
 * `pm2 restart`. Without a shared 401 path each admin page silently fails on
 * its own — the shell still renders because sessionStorage still holds a
 * token, but nothing loads and there is no way back to the login screen.
 *
 * adminFetch() centralises that: on a 401 it clears the dead token and
 * reloads, which drops the user at AdminPinGate's login form.
 */
import { getApiBase } from "./apiBase";
import { secureSession } from "../utils/secureStorage";

export const ADMIN_SESSION_KEY = "admin-pin-token";

export function getAdminToken() {
  try {
    return secureSession.getItem(ADMIN_SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function clearAdminSession() {
  try {
    secureSession.removeItem(ADMIN_SESSION_KEY);
  } catch { /* storage may be blocked — the reload still re-gates */ }
}

// One reload per page life, so several parallel 401s don't loop.
let _reloading = false;

/** Drop the dead session and send the user back to the PIN gate. */
export function endAdminSession() {
  clearAdminSession();
  if (_reloading || typeof window === "undefined") return;
  _reloading = true;
  window.location.reload();
}

/**
 * fetch() against the API base with the admin token attached. A 401 clears
 * the session and reloads; the rejected Response is still returned so callers
 * can keep their own error handling.
 */
export async function adminFetch(path, opts = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": getAdminToken(),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) endAdminSession();
  return res;
}
