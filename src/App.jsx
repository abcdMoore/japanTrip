// ─────────────────────────────────────────────────────────────────────────────
//  Japan Trip Guide — App.jsx
//  Data driven from src/trip-data.md (imported as raw string via Vite ?raw)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  MapContainer, TileLayer, CircleMarker, Polyline,
  Marker, Popup, useMap,
} from "react-leaflet";
import L from "leaflet";
import tripData from "./trip-data.md?raw";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOME_BASES = {
  Tokyo: { coords: [35.6330, 139.7157], label: "Meguro — Hotel" },
  Osaka: { coords: [34.6637, 135.5008], label: "Namba — Hotel"  },
};
const CITY_COLORS = {
  Tokyo:  { bg:"rgba(244,184,196,0.12)", accent:"#f4b8c4", text:"#f9d0da", dim:"rgba(244,184,196,0.4)"  },
  Hakone: { bg:"rgba(168,212,168,0.12)", accent:"#88c888", text:"#b0d8b0", dim:"rgba(168,212,168,0.4)"  },
  Osaka:  { bg:"rgba(212,168,67,0.12)",  accent:"#d4a843", text:"#e8c878", dim:"rgba(212,168,67,0.4)"   },
  Kyoto:  { bg:"rgba(196,160,216,0.12)", accent:"#c4a0d8", text:"#d8bce8", dim:"rgba(196,160,216,0.4)"  },
  Nara:   { bg:"rgba(152,212,184,0.12)", accent:"#7cc4a8", text:"#a8d8c0", dim:"rgba(152,212,184,0.4)"  },
};
const TRANSIT_ICONS = {
  train:"🚃","train + walk":"🚃",walk:"🚶",subway:"🚇",
  tram:"🚋",bus:"🚌",shinkansen:"🚅",arrival:"✈️",
  "tram + walk":"🚋","train + bus":"🚃","walk/bus":"🚶",
};
const TURN_ARROWS = {
  "turn left":"↰","turn right":"↱","turn sharp left":"↺","turn sharp right":"↻",
  "turn slight left":"↖","turn slight right":"↗","fork left":"↖","fork right":"↗",
  "continue":"↑","depart":"▶","arrive":"⬛","roundabout":"⟳",
};

// ── Parse trip-data.md at module level (stable, used for lazy state init) ─────
function parseInlineCoords(str) {
  const m = str.match(/\[(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\]\s*$/);
  if (!m) return null;
  const la = parseFloat(m[1]), ln = parseFloat(m[2]);
  return isNaN(la) || isNaN(ln) ? null : [la, ln];
}
function parseStepSeg(raw) {
  const m = raw.match(/\[(walk|line):(-?\d+\.?\d*),(-?\d+\.?\d*):(-?\d+\.?\d*),(-?\d+\.?\d*)\]/);
  if (!m) return { text: raw.trim(), seg: null };
  return {
    text: raw.replace(m[0], "").replace(/\s+$/, ""),
    seg: {
      type: m[1],
      from: [parseFloat(m[2]), parseFloat(m[3])],
      to:   [parseFloat(m[4]), parseFloat(m[5])],
    },
  };
}
function parseTripMd(text) {
  const days = []; let curDay = null, curStop = null, inTransit = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line === "---") { inTransit = false; continue; }
    if (line.startsWith("# ")) {
      const [date, label, city] = line.slice(2).split("|").map(s => s.trim());
      curDay = { date, label: label || "", city: city || "Tokyo", stops: [] };
      days.push(curDay); curStop = null; inTransit = false;
    } else if (line.startsWith("## ")) {
      const parts = line.slice(3).split("|").map(s => s.trim());
      let coords = null;
      if (parts[3]) {
        const [la, ln] = parts[3].split(",").map(Number);
        if (!isNaN(la) && !isNaN(ln)) coords = [la, ln];
      }
      curStop = { time: parts[0], area: parts[1], type: parts[2] || "", coords, activities: [], transit: null };
      if (curDay) curDay.stops.push(curStop);
      inTransit = false;
    } else if (line.startsWith("### transit:")) {
      const [typeRaw, dur] = line.slice(12).trim().split("|").map(s => s.trim());
      if (curStop) { curStop.transit = { type: typeRaw, duration: dur || "", steps: [] }; inTransit = true; }
    } else if (/^\d+\.\s/.test(line) && inTransit && curStop?.transit) {
      const { text, seg } = parseStepSeg(line.replace(/^\d+\.\s/, ""));
      curStop.transit.steps.push({ text, seg });
    } else if (line.startsWith("- ") && curStop && !inTransit) {
      const raw2 = line.slice(2);
      const coords = parseInlineCoords(raw2);
      const text = raw2.replace(/\s*\[[-\d.,\s]+\]\s*$/, "").trim();
      curStop.activities.push({ text, coords });
    }
  }
  return days;
}

// Parsed once at module load — stable reference, safe to use in lazy useState
const DAYS = parseTripMd(tripData);

// ── OSRM helpers ──────────────────────────────────────────────────────────────
async function osrmRoute(profile, from, to, withSteps = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson${withSteps ? "&steps=true" : ""}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[OSRM] HTTP ${res.status}`, { profile, from, to });
      return null;
    }
    const data = await res.json();
    if (data.code !== "Ok") {
      console.warn(`[OSRM] Non-Ok response: ${data.code}`, { profile, from, to });
      return null;
    }
    return data.routes?.[0] ?? null;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      console.warn("[OSRM] Timed out after 12s — using straight-line fallback", { profile, from, to });
    } else {
      console.warn("[OSRM] Fetch error:", e?.message, { profile, from, to });
    }
    return null;
  }
}

async function fetchWalkRoute(from, to) {
  const route = await osrmRoute("foot", from, to, true);
  if (!route) return null;
  const coords = route.geometry.coordinates.map(([ln, la]) => [la, ln]);
  const steps = route.legs[0].steps.map(s => {
    const dist = Math.round(s.distance);
    if (dist < 15 && s.maneuver.type !== "arrive") return null;
    const key = s.maneuver.type === "turn"
      ? `turn ${s.maneuver.modifier || ""}`.trim()
      : s.maneuver.modifier ? `${s.maneuver.type} ${s.maneuver.modifier}` : s.maneuver.type;
    const arrow = TURN_ARROWS[key] || "↑";
    const cap = s.maneuver.type === "turn"   ? `Turn ${s.maneuver.modifier || ""}`
      : s.maneuver.type === "depart"  ? `Head ${s.maneuver.modifier || ""}`
      : s.maneuver.type === "arrive"  ? "Arrive"
      : s.maneuver.type.charAt(0).toUpperCase() + s.maneuver.type.slice(1);
    return { arrow, text: `${cap}${s.name ? ` on ${s.name}` : ""}`, dist };
  }).filter(Boolean);
  return { coords, steps, totalDist: Math.round(route.distance), totalTime: Math.round(route.duration / 60) };
}

async function fetchTrainRoute(from, to) {
  const route = await osrmRoute("driving", from, to, false);
  if (!route) return null;
  return { coords: route.geometry.coordinates.map(([ln, la]) => [la, ln]) };
}

// ── Leaflet icon factories ─────────────────────────────────────────────────────
const makeNumIcon = (num, accent) => L.divIcon({
  html: `<div style="width:22px;height:22px;background:${accent};border-radius:50%;border:2.5px solid #080808;display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:800;font-size:10px;font-family:system-ui;box-shadow:0 2px 8px rgba(0,0,0,0.9)">${num}</div>`,
  className: "", iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
});
const makeHomeIcon = () => L.divIcon({
  html: `<div style="width:20px;height:20px;background:#222;border-radius:50%;border:2px solid #555;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 5px rgba(0,0,0,0.8)">🏠</div>`,
  className: "", iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -11],
});
const makeDayStopIcon = (num, accent, isCurrent) => L.divIcon({
  html: `<div style="width:${isCurrent?28:22}px;height:${isCurrent?28:22}px;background:${accent};border-radius:50%;border:${isCurrent?"3":"2"}px solid #080808;display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:800;font-size:${isCurrent?12:10}px;font-family:system-ui;box-shadow:0 2px 10px rgba(0,0,0,0.9);opacity:${isCurrent?1:0.65}">${num}</div>`,
  className: "",
  iconSize:   isCurrent ? [28, 28] : [22, 22],
  iconAnchor: isCurrent ? [14, 14] : [11, 11],
  popupAnchor: [0, -14],
});

// ── Map target calculators ─────────────────────────────────────────────────────
// Focus only on stop.coords + numbered activity locations.
// Transit route geometry is intentionally EXCLUDED — those polylines span
// whole cities and would zoom the map out to useless scale.
function computeTarget(stop, homeBase) {
  const pts = [];
  if (stop.coords) pts.push(stop.coords);
  stop.activities.forEach(a => { if (a.coords) pts.push(a.coords); });
  if (pts.length === 0) return homeBase ? { center: homeBase.coords, zoom: 14 } : null;
  if (pts.length === 1) return { center: pts[0], zoom: 15 };
  const lats = pts.map(c => c[0]), lngs = pts.map(c => c[1]);
  return { bounds: [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]] };
}

function computeDayTarget(stops) {
  const pts = stops.flatMap(s => {
    const p = [];
    if (s.coords) p.push(s.coords);
    s.activities.forEach(a => { if (a.coords) p.push(a.coords); });
    return p;
  });
  if (!pts.length) return null;
  if (pts.length === 1) return { center: pts[0], zoom: 14 };
  const lats = pts.map(c => c[0]), lngs = pts.map(c => c[1]);
  return { bounds: [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]] };
}

// ── MapController ─────────────────────────────────────────────────────────────
// Bug fix: dependency array [target] prevents this running on every render.
// The useRef equality check prevents double-firing if target object identity
// changes but its content is the same.
function MapController({ target }) {
  const map = useMap();
  const prev = useRef(null);
  useEffect(() => {
    if (!target) return;
    const key = JSON.stringify(target);
    if (key === prev.current) return;
    prev.current = key;
    try {
      if (target.bounds) map.fitBounds(target.bounds, { padding: [44, 44], maxZoom: 16, animate: true });
      else if (target.center) map.setView(target.center, target.zoom ?? 15, { animate: true });
    } catch {}
  }, [target]); // ← correct dep; previously missing, causing re-fire every render
  return null;
}

// ── MapRefCapture — expose Leaflet map instance outside MapContainer ───────────
function MapRefCapture({ mapRef }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => { mapRef.current = null; };
  }, [map, mapRef]);
  return null;
}

// ── User location pulsing dot ─────────────────────────────────────────────────
function UserLocationMarker({ position }) {
  const icon = useMemo(() => L.divIcon({
    html: `
      <div style="position:relative;width:24px;height:24px">
        <div style="
          position:absolute;top:50%;left:50%;
          width:24px;height:24px;border-radius:50%;
          background:rgba(74,144,226,0.35);
          animation:pulse-gps 2s ease-out infinite;
        "></div>
        <div style="
          position:absolute;top:50%;left:50%;
          transform:translate(-50%,-50%);
          width:10px;height:10px;border-radius:50%;
          background:#4a90e2;border:2.5px solid #fff;
          box-shadow:0 0 8px rgba(74,144,226,0.9);
        "></div>
      </div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  }), []);

  if (!position) return null;
  return (
    <Marker position={position} icon={icon} zIndexOffset={1000}>
      <Popup>
        <span style={{ fontFamily: "system-ui", fontSize: "12px" }}>You are here</span>
      </Popup>
    </Marker>
  );
}

// ── Copy button ────────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <button onClick={copy} style={{
      fontSize: "11px", cursor: "pointer", fontFamily: "system-ui",
      padding: "3px 8px", border: "1px solid #333", borderRadius: "5px",
      background: copied ? "rgba(74,200,74,0.15)" : "rgba(255,255,255,0.06)",
      color: copied ? "#6ec96e" : "#888",
    }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ── Day-mode all-stops overlay ─────────────────────────────────────────────────
function DayStopsOverlay({ stops, cc, currentStopIdx, onSelect }) {
  return <>
    {stops.map((s, i) => {
      if (!s.coords) return null;
      const isCurrent = i === currentStopIdx;
      const accent = isCurrent ? cc.accent : "rgba(200,200,200,0.85)";
      const icon = makeDayStopIcon(i + 1, accent, isCurrent);
      return (
        <Marker key={i} position={s.coords} icon={icon}>
          <Popup>
            <div style={{ fontFamily: "system-ui", minWidth: "130px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", marginBottom: "3px", color: "#d0dce8" }}>
                {i + 1}. {s.area}
              </div>
              <div style={{ fontSize: "11px", color: "#6080a0", marginBottom: "8px" }}>{s.time}</div>
              <button
                onClick={() => onSelect?.(i)}
                style={{
                  fontSize: "11px", cursor: "pointer", fontFamily: "system-ui",
                  background: "rgba(74,144,226,0.15)", color: "#6aaae8",
                  border: "1px solid rgba(74,144,226,0.3)", borderRadius: "6px",
                  padding: "4px 10px",
                }}>
                Go to stop
              </button>
            </div>
          </Popup>
        </Marker>
      );
    })}
  </>;
}

// ── Map content (markers + polylines) ─────────────────────────────────────────
function MapContent({ stop, stops, dayMode, cc, homeBase, stepRoutes, userLocation, currentStopIdx, onDayStopSelect }) {
  const numLocs  = useMemo(() => stop.activities.filter(a => a.coords), [stop]);
  const homeIcon = useMemo(() => makeHomeIcon(), []);
  const numIcons = useMemo(
    () => numLocs.map((_, i) => makeNumIcon(i + 1, cc.accent)),
    [numLocs.length, cc.accent],
  );

  return <>
    {/* Hotel base marker — stop mode only */}
    {!dayMode && homeBase && (
      <Marker position={homeBase.coords} icon={homeIcon}>
        <Popup>
          <span style={{ fontFamily: "system-ui", fontSize: "12px" }}>{homeBase.label}</span>
        </Popup>
      </Marker>
    )}

    {/* Full-day mode: numbered markers for every stop */}
    {dayMode && (
      <DayStopsOverlay
        stops={stops} cc={cc}
        currentStopIdx={currentStopIdx}
        onSelect={onDayStopSelect}
      />
    )}

    {/* Transit route lines — stop mode only, purely decorative context */}
    {!dayMode && (stop.transit?.steps || []).map((step, i) => {
      if (!step.seg) return null;
      const r = stepRoutes[i];
      const isWalk = step.seg.type === "walk";
      // While loading or failed: show straight-line placeholder so map isn't blank
      if (!r || r === "loading") {
        return <Polyline key={i}
          positions={[step.seg.from, step.seg.to]}
          pathOptions={{ color: isWalk ? "#a8d8f0" : "#9090e8", weight: 2.5, opacity: 0.5, dashArray: isWalk ? "8 6" : "4 3" }}
        />;
      }
      if (isWalk) {
        return <Polyline key={i} positions={r.coords}
          pathOptions={{ color: "#a8d8f0", weight: 3.5, dashArray: "10 7", opacity: 0.95, lineCap: "round", lineJoin: "round" }} />;
      }
      return <Polyline key={i} positions={r.coords}
        pathOptions={{ color: "#9090e8", weight: 3.5, opacity: 0.85, lineCap: "round", lineJoin: "round" }} />;
    })}

    {/* Numbered activity markers — stop mode only */}
    {!dayMode && numLocs.map((loc, i) => (
      <Marker key={i} position={loc.coords} icon={numIcons[i]}>
        <Popup>
          <div style={{ fontFamily: "system-ui", minWidth: "140px" }}>
            <div style={{ fontSize: "12px", color: "#c8d4e8", marginBottom: "8px", lineHeight: "1.4" }}>
              {loc.text}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <a
                href={`https://maps.apple.com/?ll=${loc.coords[0]},${loc.coords[1]}&q=${encodeURIComponent(loc.text)}`}
                onClick={e => e.stopPropagation()}
                style={{
                  fontSize: "11px", color: "#6aaae8", textDecoration: "none",
                  padding: "3px 8px", border: "1px solid rgba(74,144,226,0.35)",
                  borderRadius: "5px", background: "rgba(74,144,226,0.08)",
                }}>
                Open in Maps
              </a>
              <CopyButton text={loc.text} />
            </div>
          </div>
        </Popup>
      </Marker>
    ))}

    {/* Main stop circle — stop mode only */}
    {!dayMode && stop.coords && (
      <CircleMarker center={stop.coords} radius={10}
        fillColor={cc.accent} fillOpacity={1} color="#080808" weight={3}>
        <Popup>
          <div style={{ fontFamily: "system-ui", minWidth: "140px" }}>
            <div style={{ fontSize: "13px", fontWeight: "600", color: "#d0dce8", marginBottom: "8px" }}>
              {stop.area}
            </div>
            <a
              href={`https://maps.apple.com/?ll=${stop.coords[0]},${stop.coords[1]}&q=${encodeURIComponent(stop.area)}`}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: "11px", color: "#6aaae8", textDecoration: "none",
                padding: "3px 8px", border: "1px solid rgba(74,144,226,0.35)",
                borderRadius: "5px", background: "rgba(74,144,226,0.08)",
              }}>
              Open in Maps
            </a>
          </div>
        </Popup>
      </CircleMarker>
    )}

    {/* GPS blue dot — always on top */}
    <UserLocationMarker position={userLocation} />
  </>;
}

// ── WalkSubBullets ─────────────────────────────────────────────────────────────
function WalkSubBullets({ route, loading }) {
  if (loading) return (
    <div style={{ marginTop: "5px", marginLeft: "25px", fontSize: "10px", color: "#3a5870", fontFamily: "system-ui", fontStyle: "italic" }}>
      fetching directions…
    </div>
  );
  if (!route) return (
    <div style={{ marginTop: "5px", marginLeft: "25px", fontSize: "10px", color: "#3a4a58", fontFamily: "system-ui", fontStyle: "italic" }}>
      follow the dashed line on the map
    </div>
  );
  if (!route.steps?.length) return null;
  return (
    <div style={{ marginTop: "6px", marginLeft: "25px", paddingLeft: "9px", borderLeft: "1px solid #1e3040" }}>
      <div style={{ fontSize: "8px", color: "#2a4a60", fontFamily: "system-ui", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "5px" }}>
        {route.totalDist}m · ~{route.totalTime} min
      </div>
      {route.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: i < route.steps.length - 1 ? "5px" : 0 }}>
          <span style={{ fontSize: "12px", color: "#5aaac8", flexShrink: 0, width: "14px", textAlign: "center", lineHeight: "1.3" }}>{s.arrow}</span>
          <div>
            <span style={{ fontSize: "10px", color: "#5080a0", fontFamily: "system-ui", lineHeight: "1.4" }}>{s.text}</span>
            {s.dist > 0 && <span style={{ fontSize: "9px", color: "#223040", fontFamily: "system-ui", marginLeft: "5px" }}>{s.dist}m</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── StopMap shell ─────────────────────────────────────────────────────────────
function StopMap({ stop, stops, dayMode, cc, homeBase, stepRoutes, userLocation, onNearMePress, onDayStopSelect, stopIdx }) {
  const mapRef    = useRef(null);
  const nearTimer = useRef(null);

  const target = useMemo(
    () => dayMode ? computeDayTarget(stops) : computeTarget(stop, homeBase),
    [stop, homeBase, dayMode, stops],
  );

  const handleNearMe = useCallback(() => {
    const map = mapRef.current;
    if (!userLocation) { onNearMePress(); return; }    // ask for permission
    if (!map) return;
    map.setView(userLocation, 17, { animate: true });
    if (nearTimer.current) clearTimeout(nearTimer.current);
    // Snap back to stop target after 4 s
    nearTimer.current = setTimeout(() => {
      if (!target || !mapRef.current) return;
      try {
        if (target.bounds) mapRef.current.fitBounds(target.bounds, { padding: [44, 44], maxZoom: 16, animate: true });
        else if (target.center) mapRef.current.setView(target.center, target.zoom ?? 15, { animate: true });
      } catch {}
    }, 4000);
  }, [userLocation, target, onNearMePress]);

  useEffect(() => () => { if (nearTimer.current) clearTimeout(nearTimer.current); }, []);

  const initCenter = stop.coords ?? homeBase?.coords ?? [35.63, 139.72];

  return (
    <div style={{ height: "280px", overflow: "hidden", borderRadius: "14px 14px 0 0", position: "relative" }}>
      <MapContainer
        center={initCenter} zoom={14}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        scrollWheelZoom={true} dragging={true}
        doubleClickZoom={true} touchZoom={true}
        tap={true} attributionControl={false}
      >
        <MapRefCapture mapRef={mapRef} />
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <MapController target={target} />
        <MapContent
          stop={stop} stops={stops} dayMode={dayMode} cc={cc}
          homeBase={homeBase} stepRoutes={stepRoutes}
          userLocation={userLocation} currentStopIdx={stopIdx}
          onDayStopSelect={onDayStopSelect}
        />
      </MapContainer>

      {/* ◎ Near me button — DOM overlay (not inside Leaflet canvas) */}
      <button
        onClick={handleNearMe}
        title="Show my location"
        style={{
          position: "absolute", bottom: "48px", right: "8px", zIndex: 1000,
          width: "36px", height: "36px", borderRadius: "8px",
          background: "rgba(14,14,14,0.92)", border: `1px solid ${userLocation ? "rgba(74,144,226,0.5)" : "#2a2a2a"}`,
          cursor: "pointer", fontSize: "16px", display: "flex",
          alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
          color: userLocation ? "#4a90e2" : "#444",
        }}>
        ◎
      </button>

      {/* Gradient + attribution */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "36px",
        background: "linear-gradient(transparent,rgba(14,14,14,0.7))", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: "3px", right: "6px", fontSize: "8px",
        color: "rgba(255,255,255,0.13)", fontFamily: "system-ui", pointerEvents: "none",
      }}>
        © OpenStreetMap · CartoDB
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function JapanGuide() {
  // ── Persistent state: restore last-viewed stop from localStorage ─────────────
  const [dayIdx, setDayIdx] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("japan-guide-pos") || "null");
      if (s?.dayIdx >= 0 && DAYS[s.dayIdx] && DAYS[s.dayIdx].stops[s.stopIdx]) return s.dayIdx;
    } catch {}
    return 0;
  });
  const [stopIdx, setStopIdx] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("japan-guide-pos") || "null");
      if (s?.dayIdx >= 0 && DAYS[s.dayIdx] && DAYS[s.dayIdx].stops[s.stopIdx]) return s.stopIdx;
    } catch {}
    return 0;
  });

  useEffect(() => {
    try { localStorage.setItem("japan-guide-pos", JSON.stringify({ dayIdx, stopIdx })); } catch {}
  }, [dayIdx, stopIdx]);

  const [transitOpen, setTransitOpen] = useState(false);
  const [stepRoutes, setStepRoutes]   = useState({});   // { [stepIdx]: "loading" | result | null }
  const [dayMode, setDayMode]         = useState(false); // full-day map overview
  const [userLocation, setUserLocation] = useState(null);

  const watchIdRef  = useRef(null);
  const dayScrollRef = useRef(null);

  const day      = DAYS[dayIdx] ?? DAYS[0];
  const stop     = day.stops[stopIdx] ?? day.stops[0];
  const isFirst  = stopIdx === 0;
  const isLast   = stopIdx === day.stops.length - 1;
  const cc       = CITY_COLORS[day.city] ?? CITY_COLORS.Tokyo;
  const homeBase = HOME_BASES[day.city] ?? null;
  const hasTransit = !!stop.transit;

  // ── GPS tracking ─────────────────────────────────────────────────────────────
  // Only starts on first user interaction (Near Me press), not on page load.
  const startTracking = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current != null) return;
    // Immediate fix so the dot appears quickly
    navigator.geolocation.getCurrentPosition(
      p => setUserLocation([p.coords.latitude, p.coords.longitude]),
      e => console.warn("[GPS] Permission denied or unavailable:", e.message),
      { enableHighAccuracy: true },
    );
    // Ongoing watch for movement
    watchIdRef.current = navigator.geolocation.watchPosition(
      p => setUserLocation([p.coords.latitude, p.coords.longitude]),
      e => console.warn("[GPS] Watch error:", e.message),
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  }, []);

  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
  }, []);

  // ── Fetch OSRM routes when stop changes ─────────────────────────────────────
  useEffect(() => {
    setStepRoutes({});
    if (!stop.transit) return;
    let cancelled = false;

    stop.transit.steps.forEach((step, i) => {
      if (!step.seg) return;
      setStepRoutes(prev => ({ ...prev, [i]: "loading" }));
      const fetcher = step.seg.type === "walk"
        ? fetchWalkRoute(step.seg.from, step.seg.to)
        : fetchTrainRoute(step.seg.from, step.seg.to);
      fetcher.then(result => {
        if (!cancelled) setStepRoutes(prev => ({ ...prev, [i]: result }));
      });
    });

    return () => { cancelled = true; };
  }, [dayIdx, stopIdx]);

  // ── Auto-scroll day pill into view ──────────────────────────────────────────
  useEffect(() => {
    dayScrollRef.current?.children[dayIdx]
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [dayIdx]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const selectDay = i => { setDayIdx(i); setStopIdx(0); setTransitOpen(false); setDayMode(false); };
  const goPrev    = () => { if (!isFirst) { setStopIdx(s => s - 1); setTransitOpen(false); } };
  // goNext auto-opens transit panel (you're about to be in transit)
  const goNext    = () => { if (!isLast)  { setStopIdx(s => s + 1); setTransitOpen(true);  } };

  const handleDayStopSelect = useCallback(i => {
    setStopIdx(i);
    setDayMode(false);
    setTransitOpen(false);
  }, []);

  // ── Stop type flags ──────────────────────────────────────────────────────────
  const isSpecial   = stop.type.includes("⭐");
  const isDeparture = ["depart","transit","arrive","arrival"].some(t => stop.type.includes(t));
  const isNight     = ["dinner","drinks","late night","evening","onsen"].some(t => stop.type.includes(t));
  const isFree      = stop.type === "free";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: "#0e0e0e", fontFamily: "'Georgia', serif",
      color: "#e8e0d8", display: "flex", flexDirection: "column",
      maxWidth: "480px", margin: "0 auto",
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: "16px 16px 10px", borderBottom: "1px solid #1a1a1a",
        background: "rgba(14,14,14,0.97)", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "10px" }}>
          <span style={{ fontSize: "11px", letterSpacing: "0.18em", color: "#555", textTransform: "uppercase", fontFamily: "system-ui" }}>Japan</span>
          <span style={{ fontSize: "10px", color: "#2e2e2e", fontFamily: "system-ui" }}>Mar 17–31 · 2026</span>
        </div>
        <div ref={dayScrollRef} style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px" }}>
          {DAYS.map((d, i) => {
            const c = CITY_COLORS[d.city] ?? CITY_COLORS.Tokyo;
            const active = i === dayIdx;
            return (
              <button key={i} onClick={() => selectDay(i)} style={{
                flexShrink: 0, padding: "5px 10px", borderRadius: "20px", minHeight: "44px",
                border: `1px solid ${active ? c.accent : "#222"}`,
                background: active ? c.bg : "transparent",
                color: active ? c.text : "#484848",
                cursor: "pointer", fontFamily: "system-ui", fontSize: "10px",
                fontWeight: active ? "700" : "400", whiteSpace: "nowrap",
                lineHeight: 1.4, transition: "all 0.2s",
              }}>
                <span style={{ display: "block", fontSize: "8px", color: active ? c.accent : "#333", marginBottom: "1px" }}>{d.date}</span>
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, padding: "14px 14px 108px", overflowY: "auto" }}>

        {/* City row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: cc.accent }} />
          <span style={{ fontSize: "10px", letterSpacing: "0.2em", color: cc.accent, textTransform: "uppercase", fontFamily: "system-ui" }}>{day.city}</span>
          <span style={{ fontSize: "10px", color: "#2e2e2e", fontFamily: "system-ui", marginLeft: "auto" }}>{day.label}</span>
        </div>

        {/* Progress dots + Day/Stop toggle */}
        <div style={{ display: "flex", gap: "5px", marginBottom: "16px", alignItems: "center" }}>
          {day.stops.map((_, i) => (
            <button key={i}
              onClick={() => { setStopIdx(i); setTransitOpen(false); setDayMode(false); }}
              style={{
                width: i === stopIdx ? "22px" : "6px", height: "6px",
                borderRadius: "3px", border: "none", padding: 0,
                cursor: "pointer", transition: "all 0.3s", flexShrink: 0,
                background: i === stopIdx ? cc.accent : i < stopIdx ? cc.dim : "#1e1e1e",
              }}
            />
          ))}
          <span style={{ marginLeft: "auto", fontFamily: "system-ui", fontSize: "10px", color: "#383838" }}>
            {stopIdx + 1}/{day.stops.length}
          </span>
          {/* Full-day map toggle */}
          <button
            onClick={() => setDayMode(m => !m)}
            title={dayMode ? "Back to stop view" : "View full day on map"}
            style={{
              marginLeft: "6px", padding: "3px 8px", borderRadius: "8px",
              border: `1px solid ${dayMode ? cc.accent : "#282828"}`,
              background: dayMode ? cc.bg : "transparent",
              color: dayMode ? cc.text : "#444",
              cursor: "pointer", fontFamily: "system-ui", fontSize: "9px",
              fontWeight: dayMode ? "700" : "400", letterSpacing: "0.05em",
            }}>
            {dayMode ? "Stop" : "Day"}
          </button>
        </div>

        {/* ── Card ── */}
        <div style={{
          borderRadius: "14px", border: "1px solid #1c1c1c", overflow: "hidden",
          background: isSpecial   ? "rgba(244,184,196,0.06)"
            : isDeparture ? "rgba(80,100,160,0.07)"
            : isNight     ? "rgba(80,60,120,0.07)"
            : "rgba(255,255,255,0.03)",
        }}>

          {/* Map */}
          <StopMap
            stop={stop} stops={day.stops} dayMode={dayMode}
            cc={cc} homeBase={homeBase} stepRoutes={stepRoutes}
            userLocation={userLocation} stopIdx={stopIdx}
            onNearMePress={startTracking}
            onDayStopSelect={handleDayStopSelect}
          />

          {/* Time + badge */}
          <div style={{ padding: "14px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: "12px", color: cc.accent, fontFamily: "system-ui", fontWeight: "700" }}>{stop.time}</div>
            <div style={{
              fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase",
              fontFamily: "system-ui", padding: "2px 8px", borderRadius: "10px", border: "1px solid",
              color: isSpecial ? "#f4b8c4" : isFree ? "#555" : isDeparture ? "#6888c0" : isNight ? "#9080b8" : "#6a8868",
              borderColor: isSpecial ? "rgba(244,184,196,0.25)" : "#1e1e1e",
              background: isSpecial ? "rgba(244,184,196,0.08)" : "transparent",
            }}>{stop.type}</div>
          </div>

          {/* Area name + Navigate button */}
          <div style={{ padding: "5px 16px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
            <div style={{
              fontSize: "24px", lineHeight: "1.2", color: "#f0ece8",
              letterSpacing: "-0.02em", fontStyle: isSpecial ? "italic" : "normal", flex: 1,
            }}>
              {stop.area}
            </div>
            {stop.coords && (
              <a
                href={`https://maps.apple.com/?saddr=My+Location&daddr=${stop.coords[0]},${stop.coords[1]}&dirflg=w`}
                onClick={e => e.stopPropagation()}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  padding: "7px 11px", borderRadius: "9px", flexShrink: 0,
                  background: "rgba(74,144,226,0.1)", border: "1px solid rgba(74,144,226,0.28)",
                  color: "#6aaae8", textDecoration: "none",
                  fontFamily: "system-ui", fontSize: "11px", fontWeight: "600",
                  minHeight: "44px",
                }}>
                📍 Navigate
              </a>
            )}
          </div>

          <div style={{ height: "1px", background: "#161616", margin: "0 16px" }} />

          {/* Activities */}
          <div style={{ padding: "12px 16px 0" }}>
            {(() => {
              let n = 0;
              return stop.activities.map((act, i) => {
                const has = !!act.coords; if (has) n++;
                return (
                  <div key={i} style={{
                    display: "flex", gap: "10px", alignItems: "flex-start",
                    marginBottom: i < stop.activities.length - 1 ? "8px" : 0,
                  }}>
                    {has
                      ? <div style={{
                          width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
                          background: cc.dim, border: `1px solid ${cc.accent}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "9px", color: cc.accent, fontWeight: "800", fontFamily: "system-ui",
                        }}>{n}</div>
                      : <div style={{
                          width: "4px", height: "4px", borderRadius: "50%", flexShrink: 0, marginTop: "7px",
                          background: isSpecial ? "#f4b8c4" : cc.accent,
                        }} />
                    }
                    <div style={{ fontSize: "13px", color: "#b8b0a8", lineHeight: "1.55", fontFamily: "system-ui" }}>
                      {act.text}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* ── Transit panel ── */}
          {hasTransit && (
            <div style={{ margin: "12px 16px 0", borderRadius: "10px", border: "1px solid #1c1c1c", overflow: "hidden" }}>
              <button onClick={() => setTransitOpen(o => !o)} style={{
                width: "100%", padding: "10px 12px", background: "rgba(50,70,120,0.18)",
                border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                minHeight: "44px",
              }}>
                <span style={{ fontSize: "14px" }}>{TRANSIT_ICONS[stop.transit.type] ?? "🚃"}</span>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontFamily: "system-ui", fontWeight: "600", fontSize: "12px", color: "#8a9ec8", marginBottom: "1px" }}>
                    Getting here — {stop.transit.type}
                  </div>
                  <div style={{ fontFamily: "system-ui", fontSize: "10px", color: "#3e4e68" }}>{stop.transit.duration}</div>
                </div>
                <span style={{
                  fontSize: "9px", color: "#3e4e68", fontFamily: "system-ui",
                  transform: transitOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.25s", display: "inline-block",
                }}>▼</span>
              </button>

              {transitOpen && (
                <div style={{ padding: "12px", background: "rgba(24,36,60,0.5)" }}>
                  {stop.transit.steps.map((step, i) => {
                    const isWalkStep  = step.seg?.type === "walk";
                    const isTrainStep = step.seg?.type === "line";
                    const routeResult = stepRoutes[i];
                    const loading = routeResult === "loading";
                    const route   = (routeResult && routeResult !== "loading") ? routeResult : null;

                    return (
                      <div key={i} style={{ marginBottom: i < stop.transit.steps.length - 1 ? "10px" : 0 }}>
                        <div style={{ display: "flex", gap: "9px", alignItems: "flex-start" }}>
                          {/* Step number circle */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                            <div style={{
                              width: "16px", height: "16px", borderRadius: "50%",
                              background: isWalkStep  ? "rgba(90,170,200,0.18)"
                                : isTrainStep ? "rgba(110,120,210,0.2)" : "rgba(60,80,130,0.35)",
                              border: `1px solid ${isWalkStep ? "#2a5870" : isTrainStep ? "#3a4888" : "#2a3a58"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "8px", fontWeight: "700", fontFamily: "system-ui",
                              color: isWalkStep ? "#5aaac8" : isTrainStep ? "#7888d8" : "#6070a0",
                            }}>{i + 1}</div>
                            {i < stop.transit.steps.length - 1 && (
                              <div style={{ width: "1px", minHeight: "10px", flex: 1, background: "#1a2840", marginTop: "2px" }} />
                            )}
                          </div>
                          {/* Step content */}
                          <div style={{ flex: 1, paddingTop: "1px" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                              {isWalkStep  && <span style={{ fontSize: "10px", opacity: 0.4 }}>🚶</span>}
                              {isTrainStep && <span style={{ fontSize: "10px", opacity: 0.4 }}>🚃</span>}
                              <span style={{ fontSize: "12px", color: "#90a8c8", lineHeight: "1.5", fontFamily: "system-ui" }}>{step.text}</span>
                            </div>
                            {isWalkStep && <WalkSubBullets route={route} loading={loading} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ height: "16px" }} />
        </div>
      </div>

      {/* ── Bottom nav ── */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: "480px",
        padding: "12px 14px max(22px, env(safe-area-inset-bottom))",
        background: "rgba(14,14,14,0.97)", borderTop: "1px solid #181818",
        display: "flex", gap: "8px", backdropFilter: "blur(14px)", zIndex: 50,
      }}>
        <button onClick={goPrev} disabled={isFirst} style={{
          flex: 1, padding: "11px", borderRadius: "11px",
          fontFamily: "system-ui", fontSize: "13px", minHeight: "44px",
          border: `1px solid ${isFirst ? "#181818" : "#282828"}`,
          background: "transparent", color: isFirst ? "#282828" : "#707070",
          cursor: isFirst ? "not-allowed" : "pointer",
        }}>← Prev</button>
        <button onClick={goNext} disabled={isLast} style={{
          flex: 2, padding: "11px", borderRadius: "11px",
          fontFamily: "system-ui", fontSize: "13px", fontWeight: "600", minHeight: "44px",
          border: `1px solid ${isLast ? "#181818" : cc.accent}`,
          background: isLast ? "transparent" : cc.bg,
          color: isLast ? "#282828" : cc.text,
          cursor: isLast ? "not-allowed" : "pointer",
        }}>Next Stop →</button>
      </div>
    </div>
  );
}
