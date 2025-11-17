import { Card, Switch, Select, Divider } from 'antd';
import { useState, useEffect } from 'react';

function useStored(key, initial) {
  const [val, setVal] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('aqm_'+key);
      if (raw != null) setVal(JSON.parse(raw));
    } catch {}
  }, [key]);
  function update(v) {
    setVal(v);
    try { localStorage.setItem('aqm_'+key, JSON.stringify(v)); } catch {}
  }
  return [val, update];
}

export default function SettingsPage() {
  const [autoRefresh, setAutoRefresh] = useStored('autoRefresh', true);
  const [showAnimations, setShowAnimations] = useStored('showAnimations', false);
  const [theme, setTheme] = useStored('theme', 'default');
  const [compactTables, setCompactTables] = useStored('compactTables', true);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Public Settings</h2>
      <p className="text-gray-600 dark:text-gray-300 text-sm">Adjust visual and data preferences. Stored locally in your browser.</p>

      <Card size="small" title={<span style={{ color: 'var(--aqm-muted)' }}>Charts</span>} style={{ background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)' }}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Auto-refresh every 5 minutes</span>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Enable subtle chart animations</span>
            <Switch checked={showAnimations} onChange={setShowAnimations} />
          </div>
        </div>
      </Card>

      <Card size="small" title={<span style={{ color: 'var(--aqm-muted)' }}>Data Tables</span>} style={{ background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)' }}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Compact table rows</span>
            <Switch checked={compactTables} onChange={setCompactTables} />
          </div>
        </div>
      </Card>
    </div>
  );
}
