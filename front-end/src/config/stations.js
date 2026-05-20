/**
 * Station configuration – single source of truth for all AQMS stations.
 *
 * Each station entry maps to:
 *   - a tabular API path  (/api/tabular/:province/:pollutant)
 *   - GPS coordinates     (for weather & map)
 *   - display metadata    (name, address, pollutant label)
 *
 * Coordinates are read from Vite env vars so they can be overridden per
 * deployment without a code change.
 */

/* ── Station photos ─────────────────────────────────────────────── */
import clarkPhoto from "../assets/clark.webp";
import meycauayanPhoto from "../assets/meycauayan.webp";
import sanFernandoPhoto from "../assets/san_fernando.webp";
import zambalesPhoto from "../assets/zambales.webp";
import bgEmbPhoto from "../assets/bgemb.webp";

export { bgEmbPhoto };

const STATION_PHOTOS = {
  clark: clarkPhoto,
  meycauayan: meycauayanPhoto,
  "san-fernando": sanFernandoPhoto,
  zambales: zambalesPhoto,
};

/** Get the photo URL for a station by its province key */
export function getStationPhoto(provinceOrKey) {
  if (!provinceOrKey) return null;
  // Try direct match first
  if (STATION_PHOTOS[provinceOrKey]) return STATION_PHOTOS[provinceOrKey];
  // Strip "-pm10", "-pm25", "-merged" suffixes
  const province = provinceOrKey.replace(/-(pm10|pm25|merged)$/, "");
  return STATION_PHOTOS[province] || null;
}

const env = (key, fallback) => {
  const v = import.meta.env?.[key];
  return v != null && v !== "" ? v : fallback;
};

function parseCoordinate(key, fallback, { min, max }) {
  const raw = env(key, fallback);
  const parsed = Number(String(raw).trim());
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }

  const safeFallback = Number(fallback);
  if (import.meta.env?.DEV) {
    console.warn(
      `[stations] Invalid coordinate for ${key}: ${String(raw)}. Using ${safeFallback}.`,
    );
  }
  return safeFallback;
}

const lat = (key, fallback) => parseCoordinate(key, fallback, { min: -90, max: 90 });
const lon = (key, fallback) => parseCoordinate(key, fallback, { min: -180, max: 180 });

export function hasValidCoordinates(station) {
  return Number.isFinite(station?.lat) && Number.isFinite(station?.lon);
}

const STATIONS = [
  {
    key: "meycauayan-pm10",
    province: "meycauayan",
    pollutant: "pm10",
    pollutantLabel: "PM10",
    name: "Meycauayan AQMS (PM10)",
    address: "Meycauayan, Bulacan",
    lat: lat("VITE_STATION_MEYCAUAYAN_LAT", "14.727555"),
    lon: lon("VITE_STATION_MEYCAUAYAN_LON", "120.958200"),
  },
  {
    key: "meycauayan-pm25",
    province: "meycauayan",
    pollutant: "pm25",
    pollutantLabel: "PM2.5",
    name: "Meycauayan AQMS (PM2.5)",
    address: "Meycauayan, Bulacan",
    lat: lat("VITE_STATION_MEYCAUAYAN_LAT", "14.727555"),
    lon: lon("VITE_STATION_MEYCAUAYAN_LON", "120.958200"),
  },
  {
    key: "zambales-pm10",
    province: "zambales",
    pollutant: "pm10",
    pollutantLabel: "PM10",
    name: "Zambales AQMS (PM10)",
    address: "Santa Cruz, Zambales",
    lat: lat("VITE_STATION_ZAMBALES_LAT", "15.775290"),
    lon: lon("VITE_STATION_ZAMBALES_LON", "119.915489"),
  },
  {
    key: "zambales-pm25",
    province: "zambales",
    pollutant: "pm25",
    pollutantLabel: "PM2.5",
    name: "Zambales AQMS (PM2.5)",
    address: "Santa Cruz, Zambales",
    lat: lat("VITE_STATION_ZAMBALES_LAT", "15.775290"),
    lon: lon("VITE_STATION_ZAMBALES_LON", "119.915489"),
  },
  {
    key: "clark-pm10",
    province: "clark",
    pollutant: "pm10",
    pollutantLabel: "PM10",
    name: "Clark AQMS",
    address: "Clark Freeport Zone, Pampanga",
    lat: lat("VITE_STATION_CLARK_LAT", "15.177166"),
    lon: lon("VITE_STATION_CLARK_LON", "120.536421"),
  },
  {
    key: "san-fernando-pm10",
    province: "san-fernando",
    pollutant: "pm10",
    pollutantLabel: "PM10",
    name: "San Fernando AQMS",
    address: "San Fernando, Pampanga",
    lat: lat("VITE_STATION_SAN_FERNANDO_LAT", "15.056462"),
    lon: lon("VITE_STATION_SAN_FERNANDO_LON", "120.643932"),
  },
];

export default STATIONS;

/** Lookup helper – find a station by its key string */
export function getStation(key) {
  return STATIONS.find((s) => s.key === key) || STATIONS[0];
}

/**
 * Build a merged station list – groups stations at the same province
 * that differ only by pollutant (e.g. Zambales PM10 + PM2.5) into a
 * single combined entry.
 */
export function getMergedStations() {
  const merged = [];
  const handled = new Set();
  for (const s of STATIONS) {
    if (handled.has(s.key)) continue;
    // Find all stations with same province
    const siblings = STATIONS.filter(
      (o) => o.province === s.province && o.key !== s.key && !handled.has(o.key),
    );
    if (siblings.length > 0) {
      // Merge all pollutants for this province
      const allPollutants = [s, ...siblings];
      const labels = allPollutants.map((p) => p.pollutantLabel);
      merged.push({
        key: `${s.province}-merged`,
        province: s.province,
        pollutant: s.pollutant, // primary
        pollutantLabel: labels.join(" & "),
        name: s.name.replace(/\s*\(.*?\)\s*$/, "") || s.name,
        address: s.address,
        lat: s.lat,
        lon: s.lon,
        merged: true,
        pollutants: allPollutants.map((p) => ({
          key: p.key,
          pollutant: p.pollutant,
          label: p.pollutantLabel,
        })),
      });
      handled.add(s.key);
      siblings.forEach((sib) => handled.add(sib.key));
    } else {
      merged.push({ ...s, merged: false });
      handled.add(s.key);
    }
  }
  // Sort alphabetically by station name
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

/** All unique physical station locations (for map markers) */
export function getUniqueLocations() {
  const seen = new Set();
  return STATIONS.filter((s) => {
    if (!hasValidCoordinates(s)) return false;
    const k = `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
