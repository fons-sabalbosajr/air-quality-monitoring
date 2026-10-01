/**
 * Freshness — a one-line "is this actually live?" indicator for chart cards.
 *
 * Shows the newest reading's hour, how long ago that was, and when the browser
 * last re-fetched. Stations report hourly and the server re-syncs the sheets
 * every minute, so a reading older than ~2 hours means the pipeline is behind
 * and the chart is showing stale numbers — that is called out rather than left
 * for the viewer to work out from the x-axis.
 */
import { Tooltip } from "antd";

// A station is hourly, so one missed hour is normal jitter; two is a problem.
const WARN_AFTER_MS = 2 * 60 * 60 * 1000;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ${mins % 60} min ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h ago`;
}

function clock(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function Freshness({ lastReadingAt, syncedAt, refreshedAt }) {
  if (!lastReadingAt) return null;
  const readingMs = new Date(lastReadingAt).getTime();
  if (Number.isNaN(readingMs)) return null;

  const age = Date.now() - readingMs;
  const level = age > STALE_AFTER_MS ? "stale" : age > WARN_AFTER_MS ? "late" : "live";
  const color =
    level === "stale" ? "#f5222d" : level === "late" ? "#fa8c16" : "#52c41a";
  const label =
    level === "stale" ? "Stale" : level === "late" ? "Behind" : "Live";

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <div>Newest reading: {clock(lastReadingAt)}</div>
          <div>Sheets last synced: {clock(syncedAt)}</div>
          <div>This chart last refreshed: {clock(refreshedAt)}</div>
          {level !== "live" && (
            <div style={{ marginTop: 6 }}>
              Stations report hourly. A gap this long means the Google Sheets
              sync is behind — check Logs or the backup status.
            </div>
          )}
        </div>
      }
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--aqm-muted)",
          marginBottom: 8,
          cursor: "help",
        }}
      >
        <span
          className={level === "live" ? "aqi-dot-pulse" : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flex: "0 0 auto",
          }}
        />
        <strong style={{ color }}>{label}</strong>
        <span>
          · newest reading {clock(lastReadingAt)} ({ago(age)})
        </span>
        {refreshedAt && <span>· refreshed {ago(Date.now() - refreshedAt)}</span>}
      </div>
    </Tooltip>
  );
}
