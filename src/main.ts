import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'nouislider/dist/nouislider.css';
// @ts-ignore
import '@fontsource-variable/inter';
import './styles/stylesheet.css';

import * as MapModule from './scripts/map';
import { BASE_LAYERS, OVERLAY_LAYERS, MAP_CONFIG } from './scripts/map';
import * as FilterPanel from './scripts/filterPanel';
import * as RoutePanel from './scripts/routePanel';
import {
    data,
    waypointCounts,
    ROUTE_FILTERS,
    ROUTE_TITLE_COLORS,
    ROUTE_TITLE_WALK_COLORS,
    haversineKm,
} from './scripts/data';
import { WAYPOINT_FILTERS, CAMPSITE_QUALITY_COLORS } from './scripts/filterPanel';


// --- STATE ---

const state = {
    activeTypes:        new Set(['trailhead']),
    colorBy:            'type_difficulty',
    clustering:         false,
    selectedRouteId:    null,    // integer feature ID
    selectedWaypoint:   null,    // maplibregl.Marker instance
    selectedWaypointId: null,   // stable string ID (survives re-renders)
    hoveredRouteId:     null,    // integer feature ID
    activeRouteFilter:  null,    // { scheme, keys: Set } | null
    hoveredLegend:      null,    // { scheme, key } | null — transient legend hover
    routeFilter:        true,    // when true, waypoints are filtered to those near the selected/filtered route
};



// --- HELPERS ---

function routeBounds(features): maplibregl.LngLatBoundsLike {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of features) {
        const rings = f.geometry.type === 'LineString'
            ? [f.geometry.coordinates]
            : f.geometry.coordinates;
        for (const ring of rings)
            for (const [lon, lat] of ring) {
                if (lon < minLon) minLon = lon;
                if (lat < minLat) minLat = lat;
                if (lon > maxLon) maxLon = lon;
                if (lat > maxLat) maxLat = lat;
            }
    }
    return [[minLon, minLat], [maxLon, maxLat]];
}

function matchesLegendKey(feature, scheme, key) {
    const p = feature.properties;
    if (scheme === 'title') return p.title === key;
    if (scheme === 'type')  return p.type  === key;
    if (scheme === 'type_difficulty')
        return key === 'COMMUNITY WALK' ? p.type === 'COMMUNITY WALK' : p.difficulty === key;
    return false;
}


// --- WELCOME MODAL TAB SWITCHING ---

function switchWelcomeTab(tabName: string) {
    document.querySelectorAll('.welcome-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.welcome-tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector<HTMLElement>(`.welcome-tab[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById(`welcome-tab-${tabName}`)?.classList.add('active');
}

document.querySelectorAll<HTMLButtonElement>('.welcome-tab').forEach(tab => {
    tab.addEventListener('click', () => switchWelcomeTab(tab.dataset.tab!));
});

document.querySelectorAll<HTMLElement>('[data-tab-link]').forEach(el => {
    el.addEventListener('click', () => switchWelcomeTab(el.dataset.tabLink!));
});


// --- SELECTION HANDLERS ---

function onRouteSelect(feature) {
    // Clear waypoint selection
    if (state.selectedWaypoint) {
        state.selectedWaypoint.getElement()?.classList.remove('selected-marker');
        state.selectedWaypoint = null;
        state.selectedWaypointId = null;
    }

    // Clear previous route highlight
    if (state.selectedRouteId !== null)
        map.setFeatureState({ source: 'routes-source', id: state.selectedRouteId }, { selected: false });

    state.selectedRouteId = feature.id;
    map.setFeatureState({ source: 'routes-source', id: feature.id }, { selected: true, hovered: false });
    data.routes.features.forEach(f =>
        map.setFeatureState({ source: 'routes-source', id: f.id }, { selectionDimmed: f.id !== feature.id })
    );

    RoutePanel.show(feature);
    renderAll();
}

function onWaypointSelect(feature, marker) {
    if (state.selectedWaypoint)
        state.selectedWaypoint.getElement()?.classList.remove('selected-marker');

    state.selectedWaypoint   = marker;
    state.selectedWaypointId = feature.properties.title ?? String(feature.id);
    marker.getElement()?.classList.remove('hovered-marker');
    marker.getElement()?.classList.add('selected-marker');
}

function clearSelection() {
    RoutePanel.clearChartSelection();

    if (state.selectedRouteId !== null) {
        map.setFeatureState({ source: 'routes-source', id: state.selectedRouteId }, { selected: false });
        state.selectedRouteId = null;
        data.routes.features.forEach(f =>
            map.setFeatureState({ source: 'routes-source', id: f.id }, { selectionDimmed: false })
        );
        RoutePanel.hide();
        renderAll();
    }

    if (state.selectedWaypoint) {
        state.selectedWaypoint.getElement()?.classList.remove('selected-marker');
        state.selectedWaypoint    = null;
        state.selectedWaypointId  = null;
    }

    _activeWaypointPopup?.remove();
    _activeWaypointPopup = null;
}


// --- ROUTE FILTER & LEGEND ---

function applyRouteFilter() {
    const f = state.activeRouteFilter;
    data.routes.features.forEach(feature => {
        const matches = !f || [...f.keys].some(key => matchesLegendKey(feature, f.scheme, key));
        map.setFeatureState({ source: 'routes-source', id: feature.id }, { filtered: !matches });
    });
}

function onLegendHover(info) {
    state.hoveredLegend = info;
    if (!info) {
        data.routes.features.forEach(f =>
            map.setFeatureState({ source: 'routes-source', id: f.id }, { dimmed: false, legendHovered: false })
        );
        renderAll();
        return;
    }
    const { scheme, key } = info;
    data.routes.features.forEach(f => {
        const matches = matchesLegendKey(f, scheme, key);
        map.setFeatureState({ source: 'routes-source', id: f.id }, { dimmed: !matches, legendHovered: matches });
    });
    renderAll();
}

function onColorBy(colorBy) {
    state.colorBy = colorBy;
    state.activeRouteFilter = null;
    FilterPanel.setColorBy(colorBy);
    map.setPaintProperty('routes-layer', 'line-color', MapModule.buildRouteColorExpression(colorBy));
    renderAll();
}

function onLegendClick({ scheme, key, keys }) {
    if (scheme === 'title') {
        const matching = data.routes.features.filter(f => f.properties.title === key);
        if (!matching.length) return;
        const bounds = routeBounds(matching);
        const centerLng = (bounds[0][0] + bounds[1][0]) / 2;
        const centerLat = (bounds[0][1] + bounds[1][1]) / 2;
        map.easeTo({ center: [centerLng, centerLat], duration: 600, essential: true });
        const coastal = matching.find(f => f.properties.type === 'COASTAL PATH') ?? matching[0];
        onRouteSelect(coastal);
        return;
    }

    state.activeRouteFilter = keys && keys.length > 0 ? { scheme, keys: new Set(keys) } : null;
    applyRouteFilter();
    renderAll();
}

function _allCategoryKeys(): string[] {
    const flat = Object.keys(WAYPOINT_FILTERS.category);
    const grouped = WAYPOINT_FILTERS.groups
        ? Object.values(WAYPOINT_FILTERS.groups).flatMap((g: any) => Object.keys(g.categories))
        : [];
    return [...flat, ...grouped];
}

function onFilterChange(newActiveTypes) {
    state.activeTypes = newActiveTypes;
    const allKeys = _allCategoryKeys();
    document.getElementById('toggle-all-markers-btn')
        .classList.toggle('btn-active', newActiveTypes.size === allKeys.length);
    renderAll();
}


// --- WAYPOINT MARKERS ---

const CLUSTER_MAX_ZOOM = 13;
const markerMap = new Map(); // stableId -> maplibregl.Marker
let _clusterZoomHandler: (() => void) | null = null;

function _syncMarkersToZoom() {
    const above = map.getZoom() > CLUSTER_MAX_ZOOM;
    for (const marker of markerMap.values()) {
        if (above) marker.addTo(map);
        else marker.remove();
    }
}

function _stableId(feature) {
    const p = feature.properties;
    if (p.id) return p.id;
    if (p.title && p.route_end) return `${p.title}|${p.route_end}`;
    if (p.title) return p.title;
    if (p.pubURL) return p.pubURL;
    return String(feature.id ?? Math.random());
}

const _outlineColor = (f) => WAYPOINT_FILTERS.category[f.properties.category]?.color ?? '#ffffff';

const _difficultyColorMap: Record<string, string> = Object.fromEntries(
    ROUTE_FILTERS.type_difficulty.map(e => [e.key, e.color])
);
const _popupColors = {
    categoryColor: (cat: string) => WAYPOINT_FILTERS.category[cat]?.color ?? '#555',
    difficultyColor: (d: string) => _difficultyColorMap[d] ?? '#aaa',
    qualityColor: (q: number) => CAMPSITE_QUALITY_COLORS[Math.min(6, Math.max(1, Math.round(q))) - 1] ?? '#aaa',
};

function updateWaypointMarkers(filteredFeatures) {
    const newIds = new Set(filteredFeatures.map(_stableId));

    // Remove markers that are no longer in the filtered set
    for (const [id, marker] of markerMap) {
        if (!newIds.has(id)) {
            marker.remove();
            markerMap.delete(id);
        }
    }

    // Add markers for new features
    for (const feature of filteredFeatures) {
        const id = _stableId(feature);
        if (markerMap.has(id)) {
            // Recolor in case quality slider or colorBy changed
            const tmpEl = MapModule.createWaypointMarkerEl(feature, FilterPanel.categoryColor, _outlineColor);
            markerMap.get(id).getElement().innerHTML = tmpEl.innerHTML;
            continue;
        }

        const el = MapModule.createWaypointMarkerEl(feature, FilterPanel.categoryColor, _outlineColor);
        const [lon, lat] = feature.geometry.coordinates;

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lon, lat]);

        if (!state.clustering || map.getZoom() > CLUSTER_MAX_ZOOM) marker.addTo(map);

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(hoverTimer);
            routeHoverPopup.remove();
            _activeWaypointPopup?.remove();
            const _catColor = _popupColors.categoryColor(feature.properties.category);
            _activeWaypointPopup = new maplibregl.Popup({ offset: [0, -34], closeButton: true })
                .setLngLat([lon, lat])
                .setHTML(MapModule.waypointPopupHTML(feature, {
                    categoryColor: _catColor,
                    difficultyColor: _popupColors.difficultyColor,
                    qualityColor: _popupColors.qualityColor,
                }))
                .addTo(map);
            const _contentEl = _activeWaypointPopup.getElement()
                ?.querySelector('.maplibregl-popup-content') as HTMLElement | null;
            if (_contentEl) _contentEl.style.borderColor = _catColor;
            onWaypointSelect(feature, marker);
        });
        el.addEventListener('mouseenter', () => {
            clearTimeout(hoverTimer);
            routeHoverPopup.remove();
            if (state.selectedWaypoint !== marker)
                el.classList.add('hovered-marker');
        });
        el.addEventListener('mouseleave', () => {
            el.classList.remove('hovered-marker');
        });

        markerMap.set(id, marker);
    }

    // Restore selected-marker styling after re-render
    if (state.selectedWaypointId) {
        const m = markerMap.get(state.selectedWaypointId);
        if (m) {
            m.getElement()?.classList.add('selected-marker');
            state.selectedWaypoint = m;
        }
    }

    // Keep cluster source in sync
    const clusteredSrc = map.getSource('waypoints-clustered') as maplibregl.GeoJSONSource;
    if (clusteredSrc) {
        clusteredSrc.setData({
            type: 'FeatureCollection',
            features: filteredFeatures,
        });
    }
}


// --- RENDER ALL ---

function renderAll() {
    FilterPanel.render(state, data, updateWaypointMarkers);
    applyRouteFilter();
}


// --- MAP INIT ---

const map = MapModule.initializeMap('map');
MapModule.setColorData({ ROUTE_FILTERS, ROUTE_TITLE_COLORS, ROUTE_TITLE_WALK_COLORS });


// Shared route hover popup
const routeHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'route-hover-popup',
});
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

// Active waypoint popup — managed manually so it isn't dependent on marker.setPopup() timing
let _activeWaypointPopup = null;

// Elevation hover marker
const elevHoverEl = document.createElement('div');
elevHoverEl.className = 'elev-hover-dot';
const elevHoverMarker = new maplibregl.Marker({ element: elevHoverEl, anchor: 'center' });

// Flag to prevent clearSelection() when a route layer was just clicked
let _routeClicked = false;

map.once('load', () => {

    // --- Routes ---
    const colorExpr = MapModule.buildRouteColorExpression(state.colorBy);
    MapModule.addRoutes(map, data.routes, colorExpr);

    // Selection highlight layer (sits above routes, below waypoint markers)
    map.addSource('selection-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
        id: 'selection-layer',
        type: 'line',
        source: 'selection-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000000', 'line-width': 5, 'line-opacity': 0.9 },
        
    });

    map.on('click', 'routes-hit-target', (e) => {
        _routeClicked = true;
        clearTimeout(hoverTimer);
        routeHoverPopup.remove();
        const rawId = e.features[0].id;
        const feature = data.routeById.get(rawId) ?? data.routeById.get(Number(rawId)) ?? e.features[0];
        onRouteSelect(feature);
    });

    map.on('mousemove', 'routes-hit-target', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const id = e.features[0].id;

        if (state.hoveredRouteId !== null && state.hoveredRouteId !== id)
            map.setFeatureState({ source: 'routes-source', id: state.hoveredRouteId }, { hovered: false });

        state.hoveredRouteId = id;
        if (state.selectedRouteId !== id)
            map.setFeatureState({ source: 'routes-source', id }, { hovered: true });

        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            const feature = data.routeById.get(id) ?? e.features[0];
            routeHoverPopup
                .setLngLat(e.lngLat)
                .setHTML(MapModule.routePopupHTML(feature.properties))
                .addTo(map);
        }, 400);
    });

    map.on('mouseleave', 'routes-hit-target', () => {
        map.getCanvas().style.cursor = '';
        clearTimeout(hoverTimer);
        routeHoverPopup.remove();
        if (state.hoveredRouteId !== null) {
            map.setFeatureState({ source: 'routes-source', id: state.hoveredRouteId }, { hovered: false });
            state.hoveredRouteId = null;
        }
    });

    // --- Cluster source + layers ---
    map.addSource('waypoints-clustered', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 40,
    });

    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'waypoints-clustered',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': ['step', ['get', 'point_count'], '#1b3daa', 10, '#FB8C00', 50, '#D32F2F'],
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
            'circle-opacity': 0.95,
        },
        layout: { visibility: 'none' },
    });

    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'waypoints-clustered',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': 13,
            visibility: 'none',
        },
        paint: { 'text-color': '#fff' },
    });

    map.on('click', 'clusters', (e) => {
        _routeClicked = true; // prevent clearSelection
        const feature = e.features?.[0];
        if (!feature) return;
        const clusterId = feature.properties.cluster_id;
        (map.getSource('waypoints-clustered') as maplibregl.GeoJSONSource)
            .getClusterExpansionZoom(clusterId)
            .then(zoom => map.easeTo({ center: (feature.geometry as any).coordinates, zoom: Math.max(zoom, CLUSTER_MAX_ZOOM + 1), essential: true }));
    });
    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

    map.once('idle', () => {
        const btn = document.getElementById('welcome-close-btn') as HTMLButtonElement | null;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Continue →';
            btn.classList.add('ready');
        }
    });

    let hasAcknowledged = false;

    function showDisclaimerPage() {
        document.getElementById('welcome-modal-box')?.classList.add('disclaimer-active');
    }

    function resetWelcomeModal() {
        document.getElementById('welcome-modal-box')?.classList.remove('disclaimer-active');
        switchWelcomeTab('welcome');
    }

    document.getElementById('welcome-close-btn')?.addEventListener('click', (e) => {
        (e.currentTarget as HTMLButtonElement).classList.remove('ready');
        if (hasAcknowledged) {
            document.getElementById('welcome-modal')?.classList.remove('open');
        } else {
            showDisclaimerPage();
        }
    });

    document.getElementById('welcome-understand-btn')?.addEventListener('click', () => {
        hasAcknowledged = true;
        document.getElementById('welcome-modal')?.classList.remove('open');
        resetWelcomeModal();
    });

    document.getElementById('map-home-btn')?.addEventListener('click', () => {
        resetWelcomeModal();
        switchWelcomeTab('guide');
        if (hasAcknowledged) {
            const btn = document.getElementById('welcome-close-btn') as HTMLButtonElement | null;
            if (btn) { btn.disabled = false; btn.textContent = 'Close'; }
        }
        document.getElementById('welcome-modal')?.classList.add('open');
    });

    renderAll();
});

// Clear selection on empty map click (not on layer/marker clicks)
map.on('click', () => {
    if (_routeClicked) { _routeClicked = false; return; }
    clearSelection();
});


// --- PANEL INIT ---

FilterPanel.init(document.getElementById('waypoint-filter'), onFilterChange, waypointCounts);
FilterPanel.initRoutes(
    document.getElementById('route-controls'),
    onColorBy,
    onLegendHover,
    onLegendClick,
    (value: boolean) => { state.routeFilter = value; renderAll(); },
    state.routeFilter,
);

RoutePanel.init(clearSelection);

const _typesByTitle: Record<string, Set<string>> = {};
data.routes.features.forEach(({ properties: { title, type } }) => {
    if (!_typesByTitle[title]) _typesByTitle[title] = new Set();
    _typesByTitle[title].add(type);
});

function _endpoints(title: string, type: string): [number, number][] {
    const pts: [number, number][] = [];
    for (const f of data.routes.features) {
        if (f.properties.title !== title || f.properties.type !== type) continue;
        const rings = f.geometry.type === 'LineString'
            ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const ring of rings) {
            pts.push([ring[0][1],     ring[0][0]]);     // [lat, lon]
            pts.push([ring.at(-1)[1], ring.at(-1)[0]]);
        }
    }
    return pts;
}

function _minDist(a: [number, number][], b: [number, number][]): number {
    let min = Infinity;
    for (const [lat1, lon1] of a)
        for (const [lat2, lon2] of b)
            min = Math.min(min, haversineKm(lat1, lon1, lat2, lon2));
    return min;
}

function _maxLat(title: string, type: string): number {
    let max = -Infinity;
    for (const f of data.routes.features) {
        if (f.properties.title !== title || f.properties.type !== type) continue;
        const rings = f.geometry.type === 'LineString'
            ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const ring of rings)
            for (const [, lat] of ring)
                if (lat > max) max = lat;
    }
    return max === -Infinity ? 0 : max;
}

const titlesInOrder = ROUTE_FILTERS.title.map(({ key }) => key as string);
const _navSequence: { title: string; type: string }[] = [];

for (let i = 0; i < titlesInOrder.length; i++) {
    const title = titlesInOrder[i];
    const types = _typesByTitle[title];
    if (!types) continue;
    const hasCoastal = types.has('COASTAL PATH');
    const hasWalk    = types.has('COMMUNITY WALK');

    if (!hasCoastal || !hasWalk) {
        if (hasCoastal) _navSequence.push({ title, type: 'COASTAL PATH' });
        if (hasWalk)    _navSequence.push({ title, type: 'COMMUNITY WALK' });
        continue;
    }

    let first: string;
    if (i === 0) {
        first = _maxLat(title, 'COMMUNITY WALK') > _maxLat(title, 'COASTAL PATH')
            ? 'COMMUNITY WALK' : 'COASTAL PATH';
    } else {
        const prevTitle = titlesInOrder[i - 1];
        const prevPts: [number, number][] = [];
        const prevTypes = _typesByTitle[prevTitle];
        if (prevTypes?.has('COASTAL PATH'))   prevPts.push(..._endpoints(prevTitle, 'COASTAL PATH'));
        if (prevTypes?.has('COMMUNITY WALK')) prevPts.push(..._endpoints(prevTitle, 'COMMUNITY WALK'));

        const coastalDist = _minDist(_endpoints(title, 'COASTAL PATH'),  prevPts);
        const walkDist    = _minDist(_endpoints(title, 'COMMUNITY WALK'), prevPts);
        first = walkDist < coastalDist ? 'COMMUNITY WALK' : 'COASTAL PATH';
    }

    const second = first === 'COASTAL PATH' ? 'COMMUNITY WALK' : 'COASTAL PATH';
    _navSequence.push({ title, type: first });
    _navSequence.push({ title, type: second });
}
RoutePanel.setNavSequence(_navSequence);

RoutePanel.setNavigateCallback(({ title, type }) => {
    const matching = data.routes.features.filter(f =>
        f.properties.title === title && f.properties.type === type
    );
    if (!matching.length) return;
    const bounds = routeBounds(matching);
    const centerLng = (bounds[0][0] + bounds[1][0]) / 2;
    const centerLat = (bounds[0][1] + bounds[1][1]) / 2;
    map.easeTo({ center: [centerLng, centerLat], duration: 500, essential: true });
    onRouteSelect(matching[0]);
});

RoutePanel.setHoverCallback((pt) => {
    if (!pt) { elevHoverMarker.remove(); return; }
    elevHoverMarker.setLngLat([pt.lon, pt.lat]).addTo(map);
});

RoutePanel.setSelectionCallback((pts) => {
    const src = map.getSource('selection-source') as maplibregl.GeoJSONSource;
    if (!pts || !pts.length) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    const rings: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const p of pts) {
        if (p.segStart && cur.length) { rings.push(cur); cur = []; }
        cur.push([p.lon, p.lat]);
    }
    if (cur.length) rings.push(cur);
    src.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: rings.length === 1
                ? { type: 'LineString', coordinates: rings[0] }
                : { type: 'MultiLineString', coordinates: rings },
            properties: {},
        }],
    });
});


// --- UI EVENT LISTENERS ---

document.getElementById('panel-collapse-btn').addEventListener('click', () => {
    const panel = document.getElementById('panel');
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('panel-collapse-btn');
    if (btn) btn.innerHTML = panel.classList.contains('collapsed')
        ? '<img src="/icons/UI/filter.svg" width="16" height="16" alt="Filters">'
        : '<img src="/icons/UI/x-1.svg" width="14" height="14" alt="Close">';
    if (isMobile && !panel.classList.contains('collapsed'))
        document.getElementById('map-controls')?.classList.add('collapsed');
});

document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
        header.closest('.panel-section').classList.toggle('closed');
    });
});

document.getElementById('toggle-all-markers-btn').addEventListener('click', () => {
    const allKeys = _allCategoryKeys();
    state.activeTypes = state.activeTypes.size === allKeys.length
        ? new Set()
        : new Set(allKeys);
    document.getElementById('toggle-all-markers-btn')
        .classList.toggle('btn-active', state.activeTypes.size === allKeys.length);
    onFilterChange(state.activeTypes);
});

// Sync initial highlighted state on page load
{
    const allKeys = _allCategoryKeys();
    document.getElementById('toggle-all-markers-btn')
        .classList.toggle('btn-active', state.activeTypes.size === allKeys.length);
}

document.getElementById('cluster-toggle-btn').innerHTML =
    `Marker Clustering: <strong>${state.clustering ? 'On' : 'Off'}</strong>`;
document.getElementById('cluster-toggle-btn').classList.toggle('btn-active', state.clustering);

document.getElementById('cluster-toggle-btn').addEventListener('click', () => {
    state.clustering = !state.clustering;

    document.getElementById('cluster-toggle-btn').innerHTML =
        `Marker Clustering: <strong>${state.clustering ? 'On' : 'Off'}</strong>`;
    document.getElementById('cluster-toggle-btn').classList.toggle('btn-active', state.clustering);

    if (state.clustering) {
        for (const marker of markerMap.values()) marker.remove();
        map.setLayoutProperty('clusters',      'visibility', 'visible');
        map.setLayoutProperty('cluster-count', 'visibility', 'visible');
        _clusterZoomHandler = _syncMarkersToZoom;
        map.on('zoomend', _clusterZoomHandler);
    } else {
        if (_clusterZoomHandler) { map.off('zoomend', _clusterZoomHandler); _clusterZoomHandler = null; }
        for (const marker of markerMap.values()) marker.addTo(map);
        map.setLayoutProperty('clusters',      'visibility', 'none');
        map.setLayoutProperty('cluster-count', 'visibility', 'none');
    }

    renderAll();
});


// --- UI SCALE ---

const SCALE_STEP = 0.1, SCALE_MIN = 0.5, SCALE_MAX = 2.2;
const isMobile = window.matchMedia('(max-width: 600px)').matches;
let uiScale = isMobile ? 0.8 : parseFloat(localStorage.getItem('ui-scale') ?? '1');

function applyUIScale() {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
    localStorage.setItem('ui-scale', String(uiScale));
    const label = document.getElementById('ui-scale-label');
    if (label) label.textContent = `${Math.round(uiScale * 100)}%`;
}
applyUIScale();

document.getElementById('ui-scale-down-btn')?.addEventListener('click', () => {
    uiScale = Math.max(SCALE_MIN, Math.round((uiScale - SCALE_STEP) * 10) / 10);
    applyUIScale();
});
document.getElementById('ui-scale-up-btn')?.addEventListener('click', () => {
    uiScale = Math.min(SCALE_MAX, Math.round((uiScale + SCALE_STEP) * 10) / 10);
    applyUIScale();
});

// --- MARKER SCALE ---

let markerScale = isMobile ? 0.8 : parseFloat(localStorage.getItem('marker-scale') ?? '1');

function applyMarkerScale() {
    document.documentElement.style.setProperty('--marker-scale', String(markerScale));
    localStorage.setItem('marker-scale', String(markerScale));
    const label = document.getElementById('marker-size-label');
    if (label) label.textContent = `${Math.round(markerScale * 100)}%`;
    const slider = document.getElementById('marker-size-slider') as HTMLInputElement | null;
    if (slider) slider.value = String(markerScale);
}
applyMarkerScale();

document.getElementById('marker-size-slider')?.addEventListener('input', (e) => {
    markerScale = parseFloat((e.target as HTMLInputElement).value);
    applyMarkerScale();
});

// --- MAP CONTROLS ---

document.querySelectorAll<HTMLInputElement>('#map-basemap-control input[type=radio]').forEach(radio => {
    radio.addEventListener('change', () => {
        for (const id of Object.keys(BASE_LAYERS)) {
            map.setLayoutProperty(id, 'visibility', id === radio.value ? 'visible' : 'none');
        }
    });
});

document.querySelectorAll<HTMLInputElement>('#map-overlay-control input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
        map.setLayoutProperty(cb.dataset.layer!, 'visibility', cb.checked ? 'visible' : 'none');
    });
});

const _3dBtn = document.getElementById('map-3d-btn')!;
let _3dActive = false;
_3dBtn.addEventListener('click', () => {
    _3dActive = !_3dActive;
    _3dBtn.classList.toggle('active', _3dActive);
    if (_3dActive) {
        map.setTerrain({ source: 'aws-terrain-dem', exaggeration: 1.0 });
        map.easeTo({ zoom: 13, pitch: 65, duration: 800, essential: true });
    } else {
        map.setTerrain(null);
        map.easeTo({ pitch: 0, duration: 800, essential: true });
    }
});

document.getElementById('map-zoom-in-btn')?.addEventListener('click', () => map.zoomIn({ duration: 200, essential: true }));
document.getElementById('map-zoom-out-btn')?.addEventListener('click', () => map.zoomOut({ duration: 200, essential: true }));
document.getElementById('map-reset-btn')?.addEventListener('click', () =>
    map.flyTo({ center: MAP_CONFIG.center, zoom: MAP_CONFIG.zoom, bearing: 0, pitch: 0,  duration: 200, essential: true  } )
);
document.getElementById('map-ctrl-collapse-btn')?.addEventListener('click', () => {
    const mapControls = document.getElementById('map-controls');
    mapControls?.classList.toggle('collapsed');
    if (isMobile && mapControls && !mapControls.classList.contains('collapsed')) {
        const panel = document.getElementById('panel');
        if (panel && !panel.classList.contains('collapsed')) {
            panel.classList.add('collapsed');
            const btn = document.getElementById('panel-collapse-btn');
            if (btn) btn.innerHTML = '<img src="/icons/UI/filter.svg" width="16" height="16" alt="Filters">';
        }
    }
});

// --- MOBILE INIT ---

if (window.innerWidth <= 600) {
    document.getElementById('panel')?.classList.add('collapsed');
    const collapseBtn = document.getElementById('panel-collapse-btn');
    if (collapseBtn) collapseBtn.innerHTML = '<img src="/icons/UI/filter.svg" width="16" height="16" alt="Filters">';
    document.getElementById('map-controls')?.classList.add('collapsed');
}
