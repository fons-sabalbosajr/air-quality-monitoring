import { createPortal } from "react-dom";
import { TbTools, TbClockHour4, TbMapPin, TbPhone, TbMail, TbWorld, TbBrandFacebook } from "react-icons/tb";
import embLogo from "../assets/emblogo.svg";
import "./MaintenanceOverlay.css";

/**
 * Full-page maintenance overlay — rendered via portal onto document.body
 * so it always escapes CSS stacking contexts (overflow, transform, etc.).
 * Shown on Kiosk when the server has MAINTENANCE_MODE=true set.
 */
export default function MaintenanceOverlay({ message }) {
  const content = (
    <div className="maint-overlay">
      <div className="maint-card">
        {/* Header */}
        <div className="maint-header">
          <img src={embLogo} alt="EMB Logo" className="maint-logo" />
          <div className="maint-header-text">
            <span className="maint-agency">EMB Region III</span>
            <span className="maint-agency-sub">Environmental Management Bureau – Central Luzon</span>
          </div>
        </div>

        <div className="maint-divider" />

        {/* Status */}
        <div className="maint-icon-wrap">
          <TbTools className="maint-icon maint-icon--tools" />
        </div>
        <h1 className="maint-title">System Under Maintenance</h1>
        <p className="maint-subtitle">
          {message || "We are currently updating our data sources. The Air Quality Monitoring Dashboard will resume shortly."}
        </p>
        <div className="maint-status-row">
          <TbClockHour4 size={15} />
          <span>Checking for updates every 30 seconds</span>
          <span className="maint-dot" />
          <span className="maint-dot" style={{ animationDelay: "0.3s" }} />
          <span className="maint-dot" style={{ animationDelay: "0.6s" }} />
        </div>

        <div className="maint-divider" />

        {/* Contact Info */}
        <div className="maint-contacts">
          <p className="maint-contacts-label">For inquiries, please contact us:</p>
          <div className="maint-contact-grid">
            <div className="maint-contact-item">
              <TbMapPin size={15} />
              <span>Masinop cor. Matalino St., DMGC, Maimpis, City of San Fernando, Pampanga</span>
            </div>
            <div className="maint-contact-item">
              <TbPhone size={15} />
              <span>(045) 963-3623 &nbsp;·&nbsp; EMED: local 115/117</span>
            </div>
            <div className="maint-contact-item">
              <TbMail size={15} />
              <a href="mailto:emb_region3@emb.gov.ph">emb_region3@emb.gov.ph</a>
            </div>
            <div className="maint-contact-item">
              <TbWorld size={15} />
              <a href="https://r3.emb.gov.ph" target="_blank" rel="noopener noreferrer">r3.emb.gov.ph</a>
            </div>
            <div className="maint-contact-item">
              <TbBrandFacebook size={15} />
              <a href="https://www.facebook.com/EMBRegion3" target="_blank" rel="noopener noreferrer">facebook.com/EMBRegion3</a>
            </div>
          </div>
        </div>

        <p className="maint-footer">Air Quality Monitoring System &mdash; &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
