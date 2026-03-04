import { Button, Alert } from "antd";

export default function FallbackPanel({ powerBiUrl, onRetry }) {
  return (
    <div style={{
      border: '1px solid var(--aqm-panel-border)',
      background: 'var(--aqm-panel-bg)',
      borderRadius: 12,
      padding: 16,
    }}>
      <Alert
        type="warning"
        showIcon
        message="The live dashboard is temporarily unavailable"
        description={
          <div>
            <p style={{ marginTop: 8 }}>
              We’re having trouble loading data right now. You can open the temporary dashboard below while we recover.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button type="primary" href={powerBiUrl} target="_blank" rel="noopener noreferrer">
                Open Temporary Power BI Dashboard
              </Button>
              <Button onClick={onRetry}>
                Retry Loading
              </Button>
            </div>
          </div>
        }
      />
    </div>
  );
}
