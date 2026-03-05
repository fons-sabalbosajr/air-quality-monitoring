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
  const embedUrl = useMemo(() => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=default&metricTemp=default&metricWind=default&zoom=11&overlay=wind&product=ecmwf&level=surface&lat=${latitude}&lon=${longitude}&marker=true&message=true`;
  }, [latitude, longitude]);

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
        href={`https://www.windy.com/${latitude}/${longitude}?wind`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <TbExternalLink size={12} />
        Open full wind map
      </a>
    </div>
  );
}
