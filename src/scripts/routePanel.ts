import * as d3 from 'd3';
import { buildElevationProfile, ROUTE_FILTERS, ROUTE_NORTH_ENDS, haversineKm } from './data';


// --- CONSTANTS ---
    // IDs of key DOM elements in the route overview panel
const PANEL_ID   = 'route-overview-panel';
const STATS_ID   = 'route-panel-stats';
const CHART_ID   = 'route-elevation-chart';
const TITLE_ID   = 'route-panel-title';
const CLOSE_ID   = 'route-panel-close-btn';
const REVERSE_ID = 'route-panel-reverse-btn';
const PREV_ID    = 'route-panel-prev-btn';
const NEXT_ID    = 'route-panel-next-btn';

// Make neat array of difficulty colors for easy lookup when rendering the difficulty badge
const _difficultyColors = Object.fromEntries(
    ROUTE_FILTERS.type_difficulty.map(e => [e.key, e.color])
);

// Make neat lookup of route title to display name & color for easy access when rendering title and badge
const _routeDisplayByTitle = Object.fromEntries(
    ROUTE_FILTERS.title.map(r => [r.key, r.label])
);

// Routes whose coordinate direction is stored opposite to all other routes — their reversal logic is flipped
    // This gave me such a headache that I'm hardcoding it here to be safe — see _computeReversed() for details
const PARALLEL_ROUTES = new Set([
    'Long Shore|COASTAL PATH',
    'Long Shore|COMMUNITY WALK',
    'Piccos Ridge|COASTAL PATH',
    'Piccos Ridge|COMMUNITY WALK',
    'White Horse|COASTAL PATH',
    'Father Troys Trail|COMMUNITY WALK',
    'Silver Mine Head|COMMUNITY WALK',
]);


// --- MODULE STATE ---

// onHover callback receives {lat, lon, distanceKm, elevation} on chart hover, null on leave
    // Used to link the elevation chart hover with the map hover (highlighting the corresponding point on the map)
let _onHover = null;
export function setHoverCallback(fn) { 
    _onHover = fn; 
}

// Callback invoked when the user clicks prev/next: receives {title, type} to navigate to
let _onNavigate = null;
export function setNavigateCallback(fn) { 
    _onNavigate = fn; 
}

// Ordered nav sequence: [{title, type}, ...] interleaved coastal/walk per route
let _navSequence = [];
export function setNavSequence(seq) { 
    _navSequence = seq; 
}

// Callback invoked when the user drag-selects a range on the elevation chart
let _onSelection: ((pts: any[] | null) => void) | null = null;
export function setSelectionCallback(fn: (pts: any[] | null) => void) { _onSelection = fn; }

// D3 brush refs — stored so clearChartSelection() can clear the brush programmatically
let _brushRef: d3.BrushBehavior<unknown> | null = null;
let _brushGroupRef: d3.Selection<SVGGElement, unknown, HTMLElement, any> | null = null;

export function clearChartSelection() {
    if (_brushRef && _brushGroupRef) _brushRef.move(_brushGroupRef, null);
    document.getElementById('route-selection-stats')?.classList.remove('active');
    _onSelection?.(null);
}

// Default states for the route overview panel
let _globalNorthToSouth = false; // false = all routes display north-to-south; toggled by the reverse button
let _currentFeature = null;      // the GeoJSON feature currently displayed in the panel
let _reversed = false;           // whether the current route's profile is drawn in reverse


// --- INIT ---
    // State function for the route overview panel: shows route stats and elevation profile, with prev/next navigation and reversible direction.
export function init(onClose?: () => void) {
    document.getElementById(CLOSE_ID).addEventListener('click', onClose ?? hide);

    // Reverse button toggles the global N/S direction flag, which in turn flips the detected direction of all routes
    document.getElementById(REVERSE_ID).addEventListener('click', () => { 
        _globalNorthToSouth = !_globalNorthToSouth;
        _reversed = _computeReversed(_currentFeature);
        _render();
    });

    // Cycle prev/next scoped route
    document.getElementById(PREV_ID).addEventListener('click', () => _navigate(-1));
    document.getElementById(NEXT_ID).addEventListener('click', () => _navigate(+1));
}

// Fade in if hidden; brief opacity flash if already visible (switching between routes)
export function show(feature) {
    clearChartSelection();
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    (panel as HTMLElement).inert = false;
    const alreadyVisible = panel.classList.contains('visible');

    _currentFeature = feature;
    _reversed = _computeReversed(feature);

    if (alreadyVisible) {
        panel.classList.add('switching');
        setTimeout(() => { // 200 ms matches the CSS switching transition duration
            _render();
            panel.classList.remove('switching');
        }, 200);
    } else {
        _render();
        panel.classList.add('visible');
    }
}

export function hide() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('visible');
    (panel as HTMLElement).inert = true;
}

// --- NAVIGATION ---

// Step delta positions through _navSequence from the currently open route
function _navigate(delta) {
    if (!_onNavigate || !_currentFeature) return;

    // Find the currently selected route in the ordered sequence 
    const title = _currentFeature.properties.title;
    const type = _currentFeature.properties.type;
    const idx = _navSequence.findIndex(n => n.title === title && n.type === type);
    if (idx === -1) return;

    // Move one step backward or forward, guard against out-of-bounds, and fire the _onNavigate callback with the new route's {title, type} to update the panel and map
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _navSequence.length) return;
    _onNavigate(_navSequence[newIdx]);
}

// Returns true if the elevation profile array should be reversed before rendering,
    // Chart always displays in a consistent geographic direction (_globalNorthToSouth).
function _computeReversed(feature) {
    if (!feature) return false;
    const title = feature.properties.title;
    const type = feature.properties.type;
    const profile = buildElevationProfile(feature).filter(p => p.lat); // Get elevation profile with lat/lon for direction detection
    if (profile.length < 2) return false;

    // Detect which end of the stored profile is geographically "north".
    const isCommunityWalk = type === 'COMMUNITY WALK';

    // Coastal paths: measure distance from each endpoint to the known north_end waypoint marker -> closer end is north.
    const northEnd = !isCommunityWalk && ROUTE_NORTH_ENDS[title]; 

    // Community walks: CW segments are sequential trail sections through communities that share an endpoint
        // with the adjacent coastal segment. The coastal north_end waypoint sits at that shared junction
        // (distance ≈ 0), so the proximity check always picks it regardless of actual geography.
        // Fall back to latitude comparison instead; reliable for the short, mostly N-S CW segments.
    let northFirst; // true = profile[0] is the northern terminus
    if (northEnd) {
        const dFirst = haversineKm(profile[0].lat, profile[0].lon, northEnd.lat, northEnd.lon);
        const dLast = haversineKm(profile.at(-1).lat, profile.at(-1).lon, northEnd.lat, northEnd.lon);
        northFirst = dFirst < dLast;
    } else {
        northFirst = profile[0].lat > profile.at(-1).lat; // fallback
    }

    // northFirst = true; profile is stored N->S (storedNtoS = true)
    const storedNtoS = northFirst;
    const isParallel = PARALLEL_ROUTES.has(`${title}|${type}`);
    // Main routes: reverse when stored direction differs from desired global direction.
    // Parallel routes: always opposite to main routes, so flip the condition.
    return isParallel
        ? storedNtoS === _globalNorthToSouth
        : storedNtoS !== _globalNorthToSouth;
}


// --- RENDER ---

// Recompute stats HTML and redraw the elevation chart for _currentFeature
function _render() {
    const feature = _currentFeature;
    if (!feature) return;
    const props = feature.properties;

    const profile = buildElevationProfile(feature);

    // Strip any points missing elevation or distance data (rare artifacts in the source GeoJSON)
    const pts: any[] = profile.filter(p => p.elevation != null && p.elevation && p.distanceKm != null);
    if (!pts.length) return;

    // Pull out our cumulative per-route stats from the profile for display in the stats panel
    const totalDist = pts.at(-1).distanceKm;
    const elevVals = pts.map(p => p.elevation);
    const maxElev = Math.max(...elevVals);
    const minElev = Math.min(...elevVals) > 0 ? Math.min(...elevVals) : 0; // treat negative as sea level i.e., 0

    // Tag the first point of each disconnected ring with segStart = true.
    // Use the ringStart flag from buildElevationProfile rather than haversine distance:
    // after @turf/simplify, consecutive points within the same ring can be 50–500 m apart,
    // which would cause false gaps with any fixed distance threshold.
    pts.forEach((point) => {
        point.segStart = point.ringStart;
    });

    // Elevation gain/loss computed from original direction — reversing just swaps the two values
    let gain = 0, loss = 0;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].segStart) continue; // skip if at gap - would signficantly mess up the data

        const delta = pts[i].elevation - pts[i - 1].elevation;
        if (delta > 0) gain += delta;

        else loss += -delta;
    }

    // Reverse the profile and remap cumulative distance so the chart reads right-to-left
    let chartPts;

    if (_reversed) {
        const ordered = _reversed ? [...pts].reverse() : pts;

        // Mirror x-axis so distances still run 0 -> totalDist after reversal
        chartPts = ordered.map((p, i, arr) => ({
            ...p,
            distanceKm: _reversed ? totalDist - p.distanceKm : p.distanceKm,

            // In the reversed array, a segment boundary falls where the previous element
            // (reversed order) was the start of a ring in the original order.
            segStart: i > 0 && arr[i - 1].ringStart,
        }));

    } else {
        chartPts = pts.map(p => ({ ...p }));
    }

    // Type label -> "Coastal Path" | "Community Walk"
    const typeStr = props.type === 'COMMUNITY WALK' ? 'Community Walk' : 'Coastal Path';
    const displayTitle = _routeDisplayByTitle[props.title] ?? props.title ?? 'Route';
    document.getElementById(TITLE_ID).textContent = displayTitle;

    // Badge color follows difficulty for easy visual parsing
    const badgeColor = _difficultyColors[props.difficulty ?? props.type];

    // Gain/loss -> also flip if _reversed
    const displayGain = _reversed ? loss : gain;
    const displayLoss = _reversed ? gain : loss;

    // Populate the stats panel with the computed values, using conditional rendering to hide any missing data points
    document.getElementById(STATS_ID).innerHTML = `
        <div class="rp-badge-row">

            <div class="rp-badge" style="border-left-color:${badgeColor};">
                <span class="rp-badge-label">${props.difficulty ?? props.type ?? '—'}</span>
            </div>

            <span class="rp-type-label">—</span>

            <span class="rp-type-label">${typeStr}</span>
        </div>
        <div class="rp-stats-grid">
            <div class="rp-stat">

                <span class="rp-stat-val">${Number(totalDist).toFixed(1)}<span class="rp-unit"> km</span></span>
                <span class="rp-stat-lbl">Dist.</span>
            </div>
            <div class="rp-stat">
            
                <span class="rp-stat-val">${Math.round(displayGain)}<span class="rp-unit"> m</span></span>
                <span class="rp-stat-lbl">↑ Gain</span>
            </div>
            <div class="rp-stat">

                <span class="rp-stat-val">${Math.round(displayLoss)}<span class="rp-unit"> m</span></span>
                <span class="rp-stat-lbl">↓ Loss</span>
            </div>
            <div class="rp-stat">

                <span class="rp-stat-val">${Math.round(maxElev)}<span class="rp-unit"> m</span></span>
                <span class="rp-stat-lbl">Max Elv.</span>
            </div>
            <div class="rp-stat">

                <span class="rp-stat-val">${Math.round(minElev)}<span class="rp-unit"> m</span></span>
                <span class="rp-stat-lbl">Min Elv.</span>
            </div>
        </div>
    `;

    const reverseBtn = document.getElementById(REVERSE_ID);
    if (reverseBtn) reverseBtn.classList.toggle('active', _globalNorthToSouth);

    // Disable prev/next at the ends of the nav sequence; otherwise go next/prev
    const navIdx = _navSequence.findIndex(
        n => n.title === (_currentFeature?.properties?.title ?? '') &&
             n.type === (_currentFeature?.properties?.type ?? '')
    );
    const prevBtn = document.getElementById(PREV_ID) as HTMLButtonElement | null;
    const nextBtn = document.getElementById(NEXT_ID) as HTMLButtonElement | null;
    if (prevBtn) prevBtn.disabled = navIdx <= 0;
    if (nextBtn) nextBtn.disabled = navIdx < 0 || navIdx >= _navSequence.length - 1;

    _drawElevationChart(chartPts);
}


// --- SELECTION STATS ---

function _renderSelectionStats(pts: any[], dist0: number, dist1: number) {
    const el = document.getElementById('route-selection-stats');
    if (!el || pts.length < 2) return;
    let gain = 0, loss = 0;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].segStart) continue;
        const d = pts[i].elevation - pts[i - 1].elevation;
        if (d > 0) gain += d; else loss -= d;
    }
    const dist = Math.abs(dist1 - dist0);
    el.innerHTML = `
        <span class="sel-dist">${dist.toFixed(1)} km selected</span>
        <span class="sel-gain">↑ ${Math.round(gain)} m</span>
        <span class="sel-loss">↓ ${Math.round(loss)} m</span>
        <button class="sel-clear-btn" title="Clear selection"><img src="/icons/UI/x-1.svg" width="12" height="12" alt="Clear"></button>
    `;
    el.classList.add('active');
    el.querySelector('.sel-clear-btn')?.addEventListener('click', clearChartSelection);
}


// --- ELEVATION CHART ---

// Clears and redraws the D3 SVG elevation chart from scratch on each call
    // Receives the pre-processed, (possibly-reversed) array of profile points from _render() -> see above
function _drawElevationChart(pts) {
    const container = document.getElementById(CHART_ID);
    container.innerHTML = ''; // clear previous chart before redrawing

    // Read chart config from CSS custom properties on the container element
    const chartStyle = getComputedStyle(container);
    const marginLeft  = parseFloat(chartStyle.getPropertyValue('--chart-margin-left')) || 50;
    const yTickCount  = parseInt(chartStyle.getPropertyValue('--chart-y-ticks'))       || 5;
    const xTickCount  = parseInt(chartStyle.getPropertyValue('--chart-x-ticks'))       || 5;

    // D3 margin handling -> reserve space around the inner plot area for axis labels
    const margin = { top: 8, right: 14, bottom: 24, left: marginLeft };
    const W = container.clientWidth;
    const H = container.clientHeight;
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;

    // X scale: use `m` for short trails (<2km), `km` otherwise
    const totalDistKm: number = d3.max<any, number>(pts, d => d.distanceKm) ?? 0;
    let xScale, tickFormat, tickCount, getX;

    if (totalDistKm < 2) {
        xScale = d3.scaleLinear()
            .domain([0, totalDistKm * 1000])
            .range([0, width]);
        tickFormat = d => `${d.toFixed(0)} m`;
        tickCount = xTickCount;
        getX = d => d.distanceKm * 1000; // convert to meters for x position

    } else {
        xScale = d3.scaleLinear()
            .domain([0, totalDistKm])
            .range([0, width]);
        tickFormat = d => `${d.toFixed(0)} km`;
        tickCount = xTickCount;
        getX = d => d.distanceKm;
    }

    const elevMin: number = d3.min<any, number>(pts, d => d.elevation) ?? 0;
    const elevMax: number = d3.max<any, number>(pts, d => d.elevation) ?? 0;

    // Pad the y domain so the line doesn't touch the top or bottom of the chart
    const pad = Math.max((elevMax - elevMin) * 0.12, 5);

    const yScale = d3.scaleLinear()
        .domain([Math.max(0, elevMin - pad), elevMax + pad])
        .range([height, 0]) // SVG y increases downward, so flip the range
        .nice(yTickCount);  // Round domain to clean tick values aligned to tick count

    // Compute explicit tick values and ensure the top tick is at or above the data max.
    // D3's ticks(n) can fall short of the nice domain ceiling in some ranges.
    const yTickVals = yScale.ticks(yTickCount);
    if (yTickVals.length > 0 && yTickVals[yTickVals.length - 1] < elevMax) {
        const step = yTickVals.length > 1
            ? yTickVals[yTickVals.length - 1] - yTickVals[yTickVals.length - 2]
            : 25;
        const extendedMax = yTickVals[yTickVals.length - 1] + step;
        yScale.domain([yScale.domain()[0], extendedMax]);
        yTickVals.push(extendedMax);
    }

    const svg = d3.select(container)
        .append('svg')
        .attr('width', W)
        .attr('height', H);

    // Vertical gradient fill under the elevation line (accent color, fades to transparent)
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient')
        .attr('id', 'elev-area-grad')
        .attr('gradientUnits', 'userSpaceOnUse') // coordinates are in SVG pixel space
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 0).attr('y2', height);

    // Two gradient stops: solid area color at top, fading to transparent at bottom.
    // Uses .style() (not .attr()) so CSS variables are resolved by the browser.
    grad.append('stop').attr('offset', '0%')
        .style('stop-color', 'var(--chart-area-color)')
        .style('stop-opacity', 'var(--chart-area-opacity-top, 0.55)');

    grad.append('stop').attr('offset', '100%')
        .style('stop-color', 'var(--chart-area-color)')
        .style('stop-opacity', 'var(--chart-area-opacity-bottom, 0.05)');

    // All chart elements live inside this group -> offset to respect the margins
    const chart = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Y axis with subtle grid lines
    chart.append('g')
        .call(
            d3.axisLeft(yScale)
                .tickValues(yTickVals)
                .tickFormat(d => `${d} m`)
        )
        .call(g => {
            g.select('.domain').remove();   // Hide the vertical axis spine line
            const tickLines = g.selectAll<SVGLineElement, unknown>('.tick line');
            tickLines.attr('class', 'elev-tick-line');
            tickLines.clone()               // clone tick marks into full-width grid lines
                .attr('x2', width)
                .attr('class', 'elev-grid-line');

            g.selectAll('.tick text')
                .attr('class', 'elev-tick-text')
                .attr('dx', '-1');
        });

    // X axis
    chart.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3.axisBottom(xScale)
                .ticks(tickCount)
                .tickFormat(tickFormat)
        )
        .call(g => {
            g.select('.domain').attr('class', 'elev-axis-domain');
            g.selectAll('.tick line').attr('class', 'elev-tick-line');
            g.selectAll('.tick text').attr('class', 'elev-tick-text');
        });

    // Downsample to a density proportional to route length (~1 pt per 10 m) so all routes
    // have consistent scrubbing resolution regardless of total distance.
    const maxPts = Math.max(200, Math.ceil(totalDistKm * 100));
    const step = Math.ceil(pts.length / maxPts);

    // Always keep the first and last point of each segment so gaps are preserved exactly
        // Use segStart flag (set by _render)
    const gapSet = new Set();
    for (let i = 0; i < pts.length; i++) {

        if (pts[i].segStart) {

            if (i > 0) gapSet.add(i - 1); // last pt of previous segment
            gapSet.add(i);                 // first pt of new segment
        }
    }

    const sampled: any[] = pts.filter((_, i) => i % step === 0 || gapSet.has(i));
    if (sampled.at(-1) !== pts.at(-1)) sampled.push(pts.at(-1)); // always include the final point

    // Split sampled pts into continuous segments (each gap = new segment)
    const segments = [];
    let seg = [sampled[0]];
    for (let i = 1; i < sampled.length; i++) {

        if (sampled[i].segStart) {
            if (seg.length > 0) segments.push(seg);
            seg = [sampled[i]];

        } else {
            seg.push(sampled[i]);
        }
    }
    if (seg.length > 0) segments.push(seg);

    // Merge segments whose boundary falls within 0.5% of start/end
        // Tiny disconnected routes (rings) at the very edge produce a phantom visual break; absorbing them fixes
    const totalDist = xScale.domain()[1];
    const edgeGuard = totalDist * 0.005;
    const mergedSegs = [];
    let cur = segments[0];

    for (let s = 1; s < segments.length; s++) {
        const boundary = getX(cur.at(-1));
        
        if (boundary < edgeGuard || boundary > totalDist - edgeGuard) {
            cur = [...cur, ...segments[s]]; // absorb edge-zone segment into its neighbor

        } else {
            mergedSegs.push(cur);
            cur = segments[s];
        }
    }
    mergedSegs.push(cur);

    // D3 path generators for the filled area and the elevation line
    const area = d3.area<any>()
        .x(d => xScale(getX(d)))
        .y0(height)
        .y1(d => yScale(d.elevation))
        .curve(d3.curveMonotoneX);

    const line = d3.line<any>()
        .x(d => xScale(getX(d)))
        .y(d => yScale(d.elevation))
        .curve(d3.curveMonotoneX);

    // Draw each continuous segment as its own filled area + line path
    mergedSegs.forEach(s => {

        chart.append('path').datum(s)
            .attr('fill', 'url(#elev-area-grad)')
            .attr('d', area);

        chart.append('path').datum(s)
            .attr('class', 'elev-line')
            .attr('d', line);
    });

    // Gap markers between genuinely disconnected segments (> 5 m apart)
    for (let s = 0; s < mergedSegs.length - 1; s++) {

        const lastPt = mergedSegs[s].at(-1);
        const nextPt = mergedSegs[s + 1][0];
        const gapM = haversineKm(lastPt.lat, lastPt.lon, nextPt.lat, nextPt.lon) * 1000;

        if (gapM < 5) continue;

        const gx = xScale(getX(lastPt));

        chart.append('line')
            .attr('class', 'elev-gap-line')
            .attr('x1', gx).attr('x2', gx)
            .attr('y1', 0).attr('y2', height);

        chart.append('text')
            .attr('class', 'elev-gap-label')
            .attr('x', gx + 3)
            .attr('y', 9)
            .text('gap');
    }

    // Hover indicator -> vertical crosshair line + dot snapped to the nearest sampled point
    const hoverLine = chart.append('line')
        .attr('class', 'chart-hover-line')
        .attr('y1', 0).attr('y2', height)
        .style('display', 'none');

    const hoverDot = chart.append('circle')
        .attr('class', 'chart-hover-dot')
        .attr('r', 3.5)
        .style('display', 'none');

    // Tooltip is a floating div that follows the hover indicators, showing the exact distance and elevation at the hovered point
    const tooltip = d3.select(container)
        .append('div')
        .attr('class', 'elev-tooltip')
        .style('display', 'none');

    // Create binary search on distanceKm for fast nearest-point lookup on mousemove
    const bisect = d3.bisector<any, number>(d => d.distanceKm).left;

    function _applyHover(event) {
        const [mx] = d3.pointer(event);
        const dist = xScale.invert(mx);
        const distKm = totalDistKm < 2 ? dist / 1000 : dist;

        const idx = Math.min(bisect(sampled, distKm), sampled.length - 1);
        const right = sampled[idx];
        const left  = idx > 0 ? sampled[idx - 1] : right;

        const span = right.distanceKm - left.distanceKm;
        const t = span > 0 ? Math.max(0, Math.min(1, (distKm - left.distanceKm) / span)) : 0;

        const elevation = left.elevation + t * (right.elevation - left.elevation);
        const lat = left.lat + t * (right.lat - left.lat);
        const lon = left.lon + t * (right.lon - left.lon);

        const cx = mx;
        const cy = yScale(elevation);

        hoverLine.attr('x1', cx).attr('x2', cx).style('display', null);
        hoverDot.attr('cx', cx).attr('cy', cy).style('display', null);

        const tipLeft = margin.left + cx + (cx > width * 0.68 ? -88 : 8);
        const tipTop  = margin.top  + cy - 28;

        tooltip
            .style('display', null)
            .style('left', `${tipLeft}px`)
            .style('top',  `${tipTop}px`)
            .html(totalDistKm < 2
                ? `Dist: ${(distKm * 1000).toFixed(0)} m | Elev: ${Math.round(elevation)} m`
                : `Dist: ${distKm.toFixed(2)} km | Elev: ${Math.round(elevation)} m`
            );

        _onHover?.({ lat, lon, distanceKm: distKm, elevation });
    }

    function _clearHover() {
        hoverLine.style('display', 'none');
        hoverDot.style('display', 'none');
        tooltip.style('display', 'none');
        _onHover?.(null);
    }

    // D3 brushX — handles drag-selection; hover is attached to the brush overlay
    const brush = d3.brushX<unknown>()
        .extent([[0, 0], [width, height]])
        .on('brush', ({ selection }) => {
            if (!selection) return;
            const [x0, x1] = selection as [number, number];
            const d0Km = totalDistKm < 2 ? xScale.invert(x0) / 1000 : xScale.invert(x0);
            const d1Km = totalDistKm < 2 ? xScale.invert(x1) / 1000 : xScale.invert(x1);
            const selPts = sampled.filter(p => p.distanceKm >= d0Km && p.distanceKm <= d1Km);
            _renderSelectionStats(selPts, d0Km, d1Km);
            _onSelection?.(selPts);
        })
        .on('end', ({ selection }) => {
            if (!selection) {
                document.getElementById('route-selection-stats')?.classList.remove('active');
                _onSelection?.(null);
            }
        });

    const brushGroup = chart.append('g').attr('class', 'brush').call(brush);
    _brushRef = brush;
    _brushGroupRef = brushGroup as any;

    // Attach hover to the brush overlay so it works alongside drag-selection
    brushGroup.select('.overlay')
        .on('mousemove.hover', _applyHover)
        .on('mouseleave.hover', _clearHover);
}
