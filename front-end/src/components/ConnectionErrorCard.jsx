import { useState, useEffect, useCallback } from "react";
import { Button } from "antd";
import {
  TbWifiOff,
  TbRefresh,
  TbCloudOff,
  TbPlugConnected,
  TbX,
} from "react-icons/tb";
import "./ConnectionErrorCard.css";

/**
 * ConnectionErrorCard — Floating watermark-style overlay that appears
 * when the app loses connection or an API error occurs.
 * Non-blocking: dashboard content remains visible and interactive.
 *
 * Props:
 *  - error     : error message string (or truthy to show overlay)
 *  - onRetry   : callback to retry the failed request
 *  - retrying  : boolean — shows spinner on retry button
 *  - compact   : boolean — smaller variant
 *  - title     : override default title text
 *  - className : extra className for wrapper
 */
export default function ConnectionErrorCard({
  error,
  onRetry,
  retrying = false,
  compact = false,
  title,
  className = "",
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Auto-retry when connection is restored
  useEffect(() => {
    if (online && error && onRetry) {
      const id = setTimeout(onRetry, 1500);
      return () => clearTimeout(id);
    }
  }, [online]);

  // Reset dismissed state when error changes
  useEffect(() => {
    setDismissed(false);
    setMinimized(false);
  }, [error]);

  const handleDismiss = useCallback(() => setDismissed(true), []);
  const handleMinimize = useCallback(() => setMinimized((v) => !v), []);

  if (!error || dismissed) return null;

  const isOffline = !online;
  const Icon = isOffline ? TbWifiOff : TbCloudOff;
  const heading =
    title ||
    (isOffline ? "No Internet Connection" : "Connection Error");
  const description = isOffline
    ? "Check your network. Auto-retry when back online."
    : typeof error === "string"
      ? error
      : "Trouble reaching the server — please retry.";

  /* ── Minimised pill (just icon + status) ── */
  if (minimized) {
    return (
      <div
        className={`conn-wm conn-wm--pill ${className}`}
        onClick={handleMinimize}
        role="button"
        tabIndex={0}
        title="Expand connection status"
      >
        <Icon size={16} className="conn-wm-icon" />
        <span className="conn-wm-pill-label">
          {isOffline ? "Offline" : "Error"}
        </span>
        <span className="conn-wm-live-dot" />
      </div>
    );
  }

  /* ── Full watermark overlay ── */
  return (
    <div className={`conn-wm${compact ? " conn-wm--compact" : ""} ${className}`}>
      {/* Dismiss / Minimize controls */}
      <div className="conn-wm-controls">
        <button
          className="conn-wm-ctrl-btn"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize connection error"
        >
          <span className="conn-wm-ctrl-dash" />
        </button>
        <button
          className="conn-wm-ctrl-btn"
          onClick={handleDismiss}
          title="Dismiss"
          aria-label="Dismiss connection error"
        >
          <TbX size={12} />
        </button>
      </div>

      <div className="conn-wm-content">
        <div className="conn-wm-icon-ring">
          <Icon className="conn-wm-icon" />
          <span className="conn-wm-pulse-ring" />
        </div>

        <div className="conn-wm-text">
          <span className="conn-wm-heading">{heading}</span>
          <span className="conn-wm-desc">{description}</span>
        </div>
      </div>

      <div className="conn-wm-footer">
        {onRetry && (
          <Button
            size="small"
            type="primary"
            icon={<TbRefresh size={13} />}
            loading={retrying}
            onClick={onRetry}
            className="conn-wm-retry-btn"
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
        <span className="conn-wm-status-tag">
          <TbPlugConnected size={11} />
          {isOffline ? "Offline" : "Unreachable"}
        </span>
      </div>
    </div>
  );
}
