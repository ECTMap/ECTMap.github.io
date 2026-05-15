import maplibregl from 'maplibre-gl';

export const MAP_CONFIG = {
  center: [-52.7, 47.35] as [number, number],
  zoom: 9,
  sat_maxZoom: 17,
  minZoom: 8,
  maxBounds: [[-56.0, 45.5], [-50.0, 49.0]] as [[number, number], [number, number]],
  maxPitch: 75,
};

// --- ICON URLS ---
const ICON_URLS = {
  trailhead: '/icons/Map/trailhead.svg',
  water:     '/icons/Map/water.svg',
  camera:    '/icons/Map/camera.svg',
  campsite:  '/icons/Map/campsite.svg',
  food:      '/icons/Map/food.svg',
  gear:      '/icons/Map/gear.svg',
  emergency: '/icons/Map/emergency.svg',
  recenter:  '/icons/UI/recenter.svg',
};

// --- BASE STYLE ---
// All tile sources declared up-front; layers control visibility.
// CartoDB doesn't support {s} or {r} tokens — enumerate 4 subdomains explicitly.
const CARTO_DARK_TILES = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
];

const TOPO_TILES = [
  'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
];

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles © Esri',
    },
    'carto-dark': {
      type: 'raster',
      tiles: CARTO_DARK_TILES,
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles © OpenStreetMap contributors © CARTO',
    },
    'opentopomap': {
      type: 'raster',
      tiles: TOPO_TILES,
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles © OpenTopoMap (CC-BY-SA)',
    },
    'aws-terrain-dem': {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 14,
      encoding: 'terrarium',
      attribution: 'Hillshade Terrain © Mapzen / AWS'
    },
    'esri-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Labels © Esri',
    },
    'contours-wms': {
      type: 'raster',
      tiles: [
        'https://maps.geogratis.gc.ca/wms/canvec_en?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1' +
        '&LAYERS=contour_approximative_50k,contour_elevation_50k,contour_depression_50k' +
        '&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256' +
        '&BBOX={bbox-epsg-3857}'
      ],
      tileSize: 256,
      attribution: 'Contours © Natural Resources Canada',
    },
  },
  layers: [
    { id: 'esri-satellite-layer',     type: 'raster',     source: 'esri-satellite', paint: { 'raster-saturation': -0.3 } },
    { id: 'carto-dark-layer',         type: 'raster',     source: 'carto-dark',   layout: { visibility: 'none' } },
    { id: 'opentopomap-layer',        type: 'raster',     source: 'opentopomap',  layout: { visibility: 'none' } },
    { id: 'esri-labels-layer',        type: 'raster',     source: 'esri-labels' },
    { id: 'contours-wms-layer',       type: 'raster',     source: 'contours-wms' },
  ],
};

// Base layer id → display label
export const BASE_LAYERS = {
  'esri-satellite-layer': 'Satellite',
  'carto-dark-layer':     'OpenStreetMap',
  'opentopomap-layer':    'Topographic',
};

// Overlay layer id → display label
export const OVERLAY_LAYERS = {
  'contours-wms-layer':         'Contour Lines',
  'esri-labels-layer':          'Labels',
};

// --- MAP INIT ---

export function initializeMap(elementId = 'map') {
  const map = new maplibregl.Map({
    container: elementId,
    pixelRatio: window.devicePixelRatio,
    style: BASE_STYLE,
    center: MAP_CONFIG.center,
    zoom: MAP_CONFIG.zoom,
    minZoom: MAP_CONFIG.minZoom,
    maxZoom: MAP_CONFIG.sat_maxZoom,
    maxBounds: MAP_CONFIG.maxBounds,
    maxPitch: MAP_CONFIG.maxPitch,
    attributionControl: false,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  return map;
}


// --- ROUTE LAYER ---

// Build a MapLibre match expression for route line-color based on the active color scheme.
// Mirrors the logic in filterPanel.routeColor().
export function buildRouteColorExpression(colorBy) {
  const { ROUTE_FILTERS, ROUTE_TITLE_COLORS, ROUTE_TITLE_WALK_COLORS } = _colorData;

  if (colorBy === 'title') {
    // Community walk segments get the lighter ROUTE_TITLE_WALK_COLORS variant
    const coastalPairs = Object.entries(ROUTE_TITLE_COLORS).flat();
    const walkPairs    = Object.entries(ROUTE_TITLE_WALK_COLORS).flat();
    return [
      'case',
      ['==', ['get', 'type'], 'COMMUNITY WALK'],
      ['match', ['get', 'title'], ...walkPairs, '#aaaaaa'],
      ['match', ['get', 'title'], ...coastalPairs, '#aaaaaa'],
    ];
  }

  if (colorBy === 'type_difficulty') {
    const pairs = ROUTE_FILTERS.type_difficulty.flatMap(e => [e.key, e.color]);
    return [
      'case',
      ['==', ['get', 'type'], 'COMMUNITY WALK'], '#4d90c0',
      ['match', ['get', 'difficulty'], ...pairs, '#aaaaaa'],
    ];
  }

  // type
  const pairs = ROUTE_FILTERS.type.flatMap(e => [e.key, e.color]);
  return ['match', ['get', 'type'], ...pairs, '#aaaaaa'];
}

// Color data injected from index.js after data.js loads (avoids circular imports)
let _colorData: any = {};
export function setColorData(colorData: any) {
  _colorData = colorData;
}


// Add GeoJSON route source and the 3 stacked line layers.
export function addRoutes(map, geojsonData, colorExpression) {
  map.addSource('routes-source', { type: 'geojson', data: geojsonData });

  map.addLayer({
    id: 'routes-selection-glow',
    type: 'line',
    source: 'routes-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': 'white',
      'line-width': 11,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'legendHovered'],  false], 0.5,
        ['boolean', ['feature-state', 'filtered'],        false], 0,
        ['boolean', ['feature-state', 'selected'],         false], 0.7,
        ['boolean', ['feature-state', 'hovered'],          false], 0.4,
        0,
      ],
    },
  });

  map.addLayer({
    id: 'routes-halo',
    type: 'line',
    source: 'routes-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#111111',
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'],      false], 9,
        ['boolean', ['feature-state', 'legendHovered'],  false], 9,
        ['boolean', ['feature-state', 'hovered'],        false], 9,
        7,
      ],
      'line-blur': 0,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'legendHovered'],    false], 0.7,
        ['boolean', ['feature-state', 'filtered'],          false], 0,
        ['boolean', ['feature-state', 'selected'],           false], 0.90,
        ['boolean', ['feature-state', 'dimmed'],             false], 0.15,
        ['boolean', ['feature-state', 'selectionDimmed'],    false], 0.30,
        0.6,
      ],
    },
  });

  map.addLayer({
    id: 'routes-layer',
    type: 'line',
    source: 'routes-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': colorExpression,
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'],      false], 6,
        ['boolean', ['feature-state', 'legendHovered'],  false], 6,
        ['boolean', ['feature-state', 'hovered'],        false], 5,
        4,
      ],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'legendHovered'],    false], 1,
        ['boolean', ['feature-state', 'filtered'],          false], 0,
        ['boolean', ['feature-state', 'dimmed'],             false], 0.3,
        ['boolean', ['feature-state', 'selectionDimmed'],    false], 0.6,
        1,
      ],
    },
  });

  // Invisible wide hit target so hover/click works on thin lines
  map.addLayer({
    id: 'routes-hit-target',
    type: 'line',
    source: 'routes-source',
    paint: { 'line-width': 14, 'line-opacity': 0 },
  });
}


// --- WAYPOINT MARKERS ---

function _pinIconHTML(color, iconUrl, strokeColor) {
  return `<svg class="marker-pin" width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"
              style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4))">
            <path d="M14 1C7.4 1 2 6.4 2 13c0 9 12 22 12 22S26 22 26 13C26 6.4 20.6 1 14 1z" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/>
            <image href="${iconUrl}" x="6" y="5" width="16" height="16"
              style="filter:brightness(0)"/>
          </svg>`;
}

function _circleIconHTML(color, iconUrl, strokeColor) {
  return `<svg class="marker-circle" width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"
              style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4))">
            <circle cx="14" cy="14" r="12" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/>
            <image href="${iconUrl}" x="6" y="6" width="16" height="16"
                style="filter:brightness(0)"/>
          </svg>`;
}

// Create the DOM element for a waypoint marker.
export function createWaypointMarkerEl(feature, colorFn, outlineColorFn?) {
  const el = document.createElement('div');
  const cat = feature.properties.category;
  const url = ICON_URLS[cat];
  const color       = colorFn(feature);
  const strokeColor = outlineColorFn ? outlineColorFn(feature) : color;

  if (cat === 'trailhead' && url) {
    el.innerHTML = _pinIconHTML(color, url, strokeColor);
  } else if (url) {
    el.innerHTML = _circleIconHTML(color, url, strokeColor);
  } else {
    // Fallback: colored circle for categories with no icon
    el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:2px solid ${strokeColor};box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:pointer;`;
  }

  el.style.cursor = 'pointer';
  return el;
}

// Return HTML string for waypoint popups.
export function waypointPopupHTML(feature, colors?: {
  categoryColor?: string;
  difficultyColor?: (d: string) => string;
  qualityColor?: (q: number) => string;
}) {
  const p = feature.properties;
  const cat = p.category ?? '';
  const iconUrl = ICON_URLS[cat] ?? '';
  const headerColor = colors?.categoryColor ?? '#555';

  const qualVal = p.site_quality ?? p.source_quality;
  const qualColor = qualVal != null && colors?.qualityColor
    ? colors.qualityColor(+qualVal) : null;
  const diffColor = p.difficulty && colors?.difficultyColor
    ? colors.difficultyColor(p.difficulty) : null;

  return `
    <div class="popup-header">
      ${iconUrl ? `<img src="${iconUrl}" class="popup-header-icon">` : ''}
      <span class="popup-header-title">${p.title ?? cat}</span>
    </div>
    <div class="popup-body">
      ${p.route     ? `<p class="popup-row">${p.route}</p>` : ''}
      ${p.length_km ? `<p class="popup-row">${p.length_km} km</p>` : ''}
      ${p.route_end ? `<p class="popup-row">Terminus: ${p.route_end.replace('_end', '').replace(/^./, c => c.toUpperCase())}</p>` : ''}
      ${p.elevation != null ? `<p class="popup-row">${p.elevation} m elevation</p>` : ''}
      ${p.notes     ? `<p class="popup-row popup-notes">${p.notes}</p>` : ''}
      ${diffColor   ? `<p class="popup-row popup-colored-row"><span class="popup-dot" style="background:${diffColor}"></span>${p.difficulty}</p>` : ''}
      ${qualColor && qualVal != null ? `<p class="popup-row popup-colored-row"><span class="popup-dot" style="background:${qualColor}"></span>${(+qualVal).toFixed(1)} / 6</p>` : ''}
    </div>
  `.trim();
}

// Return HTML string for route hover popups.
export function routePopupHTML(p) {
  return `
    <strong>${p.title ?? p.category}</strong>
    ${p.type                                    ? `<p>Type: ${p.type}</p>` : ''}
    ${p.difficulty                              ? `<p>Difficulty: ${p.difficulty}</p>` : ''}
    ${(p.length_km_calc ?? p.length_km) != null ? `<p>Length: ${p.length_km_calc ?? p.length_km} km</p>` : ''}
  `.trim();
}
