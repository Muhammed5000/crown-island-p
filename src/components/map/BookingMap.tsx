'use client';

import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  lat: number;
  lng: number;
  label: string;
}

// Custom gold-pin DivIcon — avoids the well-known broken-marker-icon issue
// with leaflet under bundlers, and matches the Crown Island brand colour.
const goldPin = L.divIcon({
  className: 'crown-pin',
  html: `
    <div style="
      width: 28px; height: 28px; border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, #f5e9b9, #deba2e 55%, #a07e22);
      box-shadow: 0 4px 16px -4px rgba(222, 186, 46, 0.7), 0 0 0 3px rgba(222, 186, 46, 0.25);
      border: 2px solid #0a132a;
    "></div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/**
 * Reusable Leaflet map. Imported dynamically with `ssr: false` from the page
 * because react-leaflet directly touches `window` / `document`.
 */
export function BookingMap({ lat, lng, label }: Props) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom
      className="h-full w-full overflow-hidden rounded-3xl"
      style={{ minHeight: '50dvh' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={goldPin}>
        <Tooltip permanent direction="top" offset={[0, -10]}>
          <span>{label}</span>
        </Tooltip>
      </Marker>
    </MapContainer>
  );
}
