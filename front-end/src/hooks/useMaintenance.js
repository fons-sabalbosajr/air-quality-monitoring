import { useState, useEffect, useRef } from "react";
import { getApiBase } from "../util/apiBase";
import { readJsonResponse } from "../util/jsonResponse";

const POLL_INTERVAL_MS = 30000; // re-check every 30s

/**
 * Polls /api/health and returns { maintenanceMode: boolean }.
 * Pages render a maintenance overlay when true.
 * Automatically lifts the overlay when the server clears the flag.
 */
export default function useMaintenance() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${getApiBase()}/api/health`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Health check");
        if (!cancelled) setMaintenanceMode(!!data.maintenanceMode);
      } catch {
        // Network error — don't change current state
      }
    }

    check();
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, []);

  return { maintenanceMode };
}
