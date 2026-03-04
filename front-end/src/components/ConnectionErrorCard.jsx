import { useState, useEffect } from "react";
import { Button } from "antd";
import {
  TbWifiOff,
  TbRefresh,
  TbCloudOff,
  TbPlugConnected,
} from "react-icons/tb";

/**
 * ConnectionErrorCard — Displays a clean, themed card when
 * the app loses connection or an API error occurs.
 *
 * Props:
 *  - error     : error message string (or truthy to show card)
 *  - onRetry   : callback to retry the failed request
 *  - retrying  : boolean — shows spinner on retry button
 *  - compact   : boolean — smaller variant for inline use
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

  if (!error) return null;

  const isOffline = !online;
  const Icon = isOffline ? TbWifiOff : TbCloudOff;
  const heading =
    title ||
    (isOffline
      ? "No Internet Connection"
      : "Connection Error");
  const description = isOffline
    ? "Please check your network connection. The app will automatically retry when you're back online."
    : typeof error === "string"
      ? error
      : "We're having trouble reaching the server. This may be temporary — please try again.";

  return (
    <div className={`conn-error-card${compact ? " conn-error-card--compact" : ""} ${className}`}>
      <div className="conn-error-icon-wrap">
        <Icon className="conn-error-icon" />
        <div className="conn-error-pulse" />
      </div>
      <div className="conn-error-body">
        <h4 className="conn-error-title">{heading}</h4>
        <p className="conn-error-desc">{description}</p>
        <div className="conn-error-actions">
          {onRetry && (
            <Button
              type="primary"
              icon={<TbRefresh size={15} />}
              loading={retrying}
              onClick={onRetry}
              size={compact ? "small" : "middle"}
              className="conn-error-retry-btn"
            >
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          <div className="conn-error-status">
            <TbPlugConnected size={13} />
            <span>{isOffline ? "Offline" : "Server unreachable"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
