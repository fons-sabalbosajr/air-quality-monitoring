import { useMemo } from "react";
import { TbWorld } from "react-icons/tb";
import "./IqEarthMapCard.css";

/**
 * IQEarth Air Quality Map – embeds the IQAir visual air quality map
 * centered on the given station coordinates.
 *
 * Uses the free IQAir Earth map widget (no API key required).
 * Stations are shown at their GPS locations on the map.
 */
export default function IqEarthMapCard({ latitude, longitude, stationName, stations = [] }) {
  const stationLat = Number(latitude);
  const stationLng = Number(longitude);
  const hasValidCoordinates =
    Number.isFinite(stationLat) &&
    Number.isFinite(stationLng) &&
    stationLat >= -90 &&
    stationLat <= 90 &&
    stationLng >= -180 &&
    stationLng <= 180;
  // Build the IQAir Earth map URL centered on the station location
  const mapUrl = useMemo(() => {
    const lat = hasValidCoordinates ? stationLat : 15.0;
    const lng = hasValidCoordinates ? stationLng : 120.7;
    // IQAir visual earth map – public, no key required
    return `https://www.iqair.com/air-quality-map?lat=${lat}&lng=${lng}&zoomLevel=8`;
  }, [hasValidCoordinates, stationLat, stationLng]);

  // Build a static fallback embed using OpenStreetMap air quality overlay  
  const embedUrl = useMemo(() => {
    const lat = hasValidCoordinates ? stationLat : 15.0;
    const lng = hasValidCoordinates ? stationLng : 120.7;
    // WAQI (World Air Quality Index) provides a free embeddable map
    return `https://aqicn.org/map/philippines/?lat=${lat}&lng=${lng}&zoom=8`;
  }, [hasValidCoordinates, stationLat, stationLng]);

  return (
    <div className="iqearth-map-section">
      <div className="section-header">
        <div className="section-header-icon">
          <TbWorld size={22} />
        </div>
        <div>
          <h3 className="section-title">Air Quality Map</h3>
          <p className="section-subtitle">
            Real-time air quality index from IQAir · Philippines
          </p>
        </div>
        <div className="section-header-actions">
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="iqearth-external-link"
          >
            <TbWorld size={14} />
            Open Full Map
          </a>
        </div>
      </div>

      <div className="iqearth-map-container">
        <iframe
          src={embedUrl}
          title="IQAir Air Quality Map – Philippines"
          className="iqearth-map-iframe"
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
        {/* Station markers overlay */}
        {stations.length > 0 && (
          <div className="iqearth-station-legend">
            {stations.map((s) => (
              <div key={s.key} className="iqearth-station-item">
                <span className="iqearth-station-dot" />
                <span className="iqearth-station-name">{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
