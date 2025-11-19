import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { FilterOutlined, CloseOutlined } from '@ant-design/icons';

/**
 * Responsive filter group wrapper.
 * Desktop/tablet: always shows children inline.
 * <=640px width: shows a toggle button; filters collapse by default.
 */
export default function FilterGroup({ label = 'Filters', children, defaultOpen = false, size = 'small' }) {
  const [open, setOpen] = useState(defaultOpen);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function handleResize() {
      const mobile = window.innerWidth <= 640;
      setIsMobile(mobile);
      if (!mobile) setOpen(true); // force open on larger screens
      else if (mobile && !defaultOpen) setOpen(false);
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [defaultOpen]);

  const toggle = () => setOpen(o => !o);

  return (
    <div className={`aqm-filters-collapsible${open ? ' open' : ''}`}> 
      {isMobile && (
        <Button
          type={open ? 'default' : 'primary'}
          size={size}
          onClick={toggle}
          className="aqm-filters-toggle-btn"
          icon={open ? <CloseOutlined /> : <FilterOutlined />}
        >
          {open ? 'Hide ' + label : 'Show ' + label}
        </Button>
      )}
      <div className="aqm-filter-row">
        {children}
      </div>
    </div>
  );
}
