import { useMemo } from "react";
import { TbWind, TbExternalLink } from "react-icons/tb";
import "./WindMapCard.css";

/**
 * WindMapCard – embeds a Windy.com wind map centred on the station
 * with a pulsing pin at the station coordinates.
 */
export default function WindMapCard({
  latitude,
  longitude,
  stationName,
}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const hasValidCoordinates =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;

  const embedUrl = useMemo(() => {
    if (!hasValidCoordinates) return null;
    return `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=default&metricTemp=default&metricWind=default&zoom=11&overlay=wind&product=ecmwf&level=surface&lat=${lat}&lon=${lon}&marker=true&message=true`;
  }, [hasValidCoordinates, lat, lon]);

  if (!embedUrl) return null;

  return (
    <div className="wind-map-card">
      <div className="wind-map-header">
        <div className="wind-map-header-icon">
          <TbWind size={16} />
        </div>
        <div>
          <h4 className="wind-map-title">Current Wind Map</h4>
          <p className="wind-map-subtitle">
            {stationName ? `Near ${stationName}` : "Live wind layer"}
          </p>
        </div>
      </div>
      <div className="wind-map-iframe-wrap">
        <iframe
          className="wind-map-iframe"
          src={embedUrl}
          title="Wind Map"
          frameBorder="0"
          loading="lazy"
          allowFullScreen
        />

      </div>
      <a
        className="wind-map-link"
        href={`https://www.windy.com/${lat}/${lon}?wind`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <TbExternalLink size={12} />
        Open full wind map
      </a>
    </div>
  );
}
