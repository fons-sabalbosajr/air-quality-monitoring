import "./PageLoadingSkeleton.css";

/**
 * PageLoadingSkeleton — shimmer loading state for Suspense fallbacks
 * and initial data loading screens. Matches the dashboard card layout.
 */
export default function PageLoadingSkeleton({ sections = 3, compact = false }) {
  return (
    <div className="page-loading-skeleton">
      {/* Hero skeleton */}
      <div className="skeleton-card" style={{ padding: compact ? 16 : 24 }}>
        <div className="skeleton-hero">
          <div
            className="skeleton-circle"
            style={{ width: compact ? 90 : 120, height: compact ? 90 : 120, flexShrink: 0 }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
            <div className="skeleton-line" style={{ width: "60%", height: 18 }} />
            <div className="skeleton-line" style={{ width: "40%", height: 12 }} />
            <div className="skeleton-line" style={{ width: "80%", height: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div className="skeleton-line" style={{ width: 60, height: 28, borderRadius: 8 }} />
              <div className="skeleton-line" style={{ width: 60, height: 28, borderRadius: 8 }} />
              <div className="skeleton-line" style={{ width: 60, height: 28, borderRadius: 8 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Grid cards skeleton */}
      <div className="skeleton-card" style={{ padding: compact ? 14 : 20 }}>
        <div className="skeleton-line" style={{ width: 140, height: 14, marginBottom: 14 }} />
        <div className="skeleton-grid">
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="skeleton-line" style={{ width: "50%", height: 10 }} />
              <div className="skeleton-line" style={{ width: "70%", height: 20 }} />
              <div className="skeleton-line" style={{ width: "90%", height: 8 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Additional section skeletons */}
      {sections > 2 && (
        <div className="skeleton-card" style={{ padding: compact ? 14 : 20 }}>
          <div className="skeleton-line" style={{ width: 180, height: 14, marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8, overflowX: "hidden" }}>
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 60,
                }}
              >
                <div className="skeleton-line" style={{ width: 32, height: 10 }} />
                <div className="skeleton-circle" style={{ width: 28, height: 28 }} />
                <div className="skeleton-line" style={{ width: 40, height: 14 }} />
                <div className="skeleton-line" style={{ width: 50, height: 6 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chart skeleton */}
      {sections > 3 && (
        <div className="skeleton-card" style={{ padding: compact ? 14 : 20 }}>
          <div className="skeleton-line" style={{ width: 200, height: 14, marginBottom: 14 }} />
          <div className="skeleton-line" style={{ width: "100%", height: 160, borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
