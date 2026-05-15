import noUiSlider from 'nouislider';
import { data, WAYPOINT_FILTERS, ROUTE_FILTERS, ROUTE_TITLE_COLORS, ROUTE_TITLE_WALK_COLORS } from './data';


// Re-export so consumers can import color constants from here instead of data.js directly
export { WAYPOINT_FILTERS, ROUTE_FILTERS };


// --- MODULE STATE ---
    // All module-level states are declared here so it's easy to find.
    // State is grouped by the subsystem that owns it.

// Color scheme — updated by index.js when the user changes the route color mode
let _colorBy = 'type_difficulty';

// Campsite quality sub-filter -> dual-range slider
let _campsiteQualityOpen = false;   // flag for it quality dropdown is expanded -> enables campsite quality coloring and filtering
let _qualityMin = 1;                // lower bound of the quality range (1–6)
let _qualityMax = 6;                // upper bound of the quality range (1–6)

// Route legend panel
let _routeContainer = null;
let _onColorChange = null;
let _onLegendHover = null;
let _onLegendClick = null;
let _colorIdx = 0; // index into ROUTE_COLOR_CYCLES; tracks which color scheme is active
let _routeFilter = true;
let _onRouteFilterToggle = null;

// Waypoint filter panel
let _container = null;
let _onFilterChange = null;


// --- COLOR STATES ---

// Set the active color scheme -> called by index.js when the user cycles the "Color by" button -> changes state here
    // Valid values: 'type_difficulty' | 'type' | 'title'
export function setColorBy(scheme) {
    _colorBy = scheme;
}

// Waypoint marker fill:
    // Decision tree:
    // 1. Campsites when quality dropdown is open -> color by site_quality (0–6 gradient)
        // Else color by category default color
    // 2. Trailheads in 'title' mode ("Route Name") -> color by associated route title
    // 3. Trailheads with a difficulty value ("Difficulty") -> color by difficulty
    // 4. All other waypoints -> look up the category's default color

function _categoryColor(cat: string): string | undefined {
    if (WAYPOINT_FILTERS.category[cat]) return WAYPOINT_FILTERS.category[cat].color;
    for (const group of Object.values(WAYPOINT_FILTERS.groups ?? {})) {
        if ((group as any).categories[cat]) return (group as any).categories[cat].color;
    }
    return undefined;
}

export function categoryColor(feature) {
    const props = feature.properties;

    // 1. Campsite quality coloring (only when the quality sub-filter is open)
    if (props.category === 'campsite' && _campsiteQualityOpen) {
        const qual = props.site_quality;

        if (qual != null) {
            const idx = Math.min(6, Math.max(1, Math.round(+qual))) - 1;
            return CAMPSITE_QUALITY_COLORS[idx];
        }
        // Fall through to default campsite color if quality data is missing
        return WAYPOINT_FILTERS.category.campsite.color;
    }

    // 2 & 3. Trailhead coloring depends on the active color scheme
    if (props.category === 'trailhead') {

        if (_colorBy === 'title') {
            // Strip "NN. " prefix and " Path" suffix to match the route title key
            const routeTitle = props.title.replace(/^\d+\.\s+/, '').replace(/ Path$/, '');
            return ROUTE_TITLE_COLORS[routeTitle] ?? WAYPOINT_FILTERS.category.trailhead.color;
        }

        if (props.difficulty) {
            const lookup = Object.fromEntries(
                ROUTE_FILTERS.type_difficulty.map(e => [e.key, e.color])
            );
            return lookup[props.difficulty] ?? WAYPOINT_FILTERS.category.trailhead.color;
        }
    }

    // 4. Default/Fallback: look up the category's base color
    return _categoryColor(props.category) ?? WAYPOINT_FILTERS.category.trailhead.color;
}



// --- CAMPSITE QUALITY SUB-FILTER ---

// Color ramp for site_quality values 0 worst -> 6 best (red -> amber -> green)
export const CAMPSITE_QUALITY_COLORS = [
    '#a11a1a', 
    '#e64a19', 
    '#ffffbf',
    '#c0ca33', 
    '#42b147',
    '#3288bd', // switched to blue since 6.0 is qualitatively different -> they are the only maintained campsites with full (backcountry) amenities
];



// Update the "(n)" count badge to reflect how many campsites are in the current quality range
function _refreshQualityCount() {
    const countEl = _container?.querySelector('#quality-count');
    if (!countEl) return;

    // Sum up how many campsites in the full dataset fall within the current quality range
    const n = data.site_waypoints.features.filter(({ properties }) => {
        const q = properties.site_quality;
        if (q == null) return false;

        const rating = Math.round(+q);
        return rating >= _qualityMin && rating <= _qualityMax;
    }).length;

    countEl.textContent = `(${n})`;
}


// Build the HTML for the campsite filter element -> includes both the checkbox row and the collapsible quality range slider section below it.

function _buildCampsiteHTML(key, color, countBadge) {
    const ticksHTML = CAMPSITE_QUALITY_COLORS.map((c, i) =>
        `<span style="color:${c}">${i + 1}</span>`
    ).join('');

    return `
        <div class="filter-item-group">
            <label class="filter-item">

                <input type="checkbox" class="type-checkbox" value="${key}" checked>
                <span class="filter-dot" style="background:${color}"> </span>
                Campsites${countBadge}
            </label>
            
            <button class="sub-filter-toggle" title="Filter by site quality"><img src="/icons/UI/arrow-up-to-line.svg" width="12" height="12" alt=""></button>
        </div>

        <div class="sub-filter-section" id="campsite-quality-filter">
            <div class="quality-slider-wrap">

                <div class="quality-slider-label">
                    Site Quality
                    <span id="quality-count" class="filter-count"> </span>
                </div>

                <div id="quality-slider"></div>
                <div class="quality-ticks">${ticksHTML}</div>
            </div>
        </div>
    `;
}


// --- ROUTE LEGEND ---

// Available color schemes in cycle order, and their display labels
const ROUTE_COLOR_CYCLES = ['type_difficulty', 'type', 'title'];
const ROUTE_COLOR_LABELS = { type_difficulty: 'Difficulty', type: 'Type', title: 'Route Name' };

// Export function by index.js to initialize the route legend panel with event handlers for color changes, legend item hover, and legend item click.
export function initRoutes(container, onColorChange, onLegendHover = null, onLegendClick = null, onRouteFilterToggle = null, initialRouteFilter = true) {
    _routeContainer = container;
    _onColorChange = onColorChange;
    _onLegendHover = onLegendHover;
    _onLegendClick = onLegendClick;
    _onRouteFilterToggle = onRouteFilterToggle;
    _routeFilter = initialRouteFilter;
    _colorIdx = 0;
    _renderRouteControls();
}


// Returns the data-key values of all currently active (selected) legend items.
function _getActiveKeys() {
    return [..._routeContainer.querySelectorAll('.legend-item.active')].map(el => el.dataset.key);
}

// Rebuild the route legend HTML and re-attach all event listeners. -> Called on init and every time the user changes the color scheme.
    // Returns html for route legend based on color scheme, and attaches event listeners for color cycling, legend item hover, and legend item click.
function _renderRouteControls() {
    const current = ROUTE_COLOR_CYCLES[_colorIdx];
    const legend = ROUTE_FILTERS[current];
    const isTitle = current === 'title';

    // In `title` legend is long -> make it scrollable 
    const hasScroll = isTitle ? 'max-height:180px; overflow-y:auto; padding-right:4px; ' : '';

    // --- Build HTML ---
    _routeContainer.innerHTML = `
        <div class="marker-btn-row">
            ${isTitle ? '' : `<button class="legend-clear-btn inactive" disabled title="Clear filter"><img src="/icons/UI/x-1.svg" width="12" height="12" alt="Clear"></button>`}
            <button class="color-cycle-btn">
                <img src="/icons/UI/cycle.svg" class="color-cycle-icon"> Color by <span class="color-badge">${ROUTE_COLOR_LABELS[current]}</span>
            </button>
        </div>

        <div class="route-legend" style="${hasScroll}">
            ${legend.map(({ label, color, key }) => {

                // In title mode show a split swatch: solid route color | lighter community-walk variant
                const swatchStyle = isTitle
                    ? `background:linear-gradient(to right,${color} 50%,${ROUTE_TITLE_WALK_COLORS[key]} 50%)`
                    : `background:${color}`;

                return `
                <div class="legend-item" data-key="${key}" style="cursor:pointer">

                    <span class="legend-swatch" style="${swatchStyle}"></span>
                    <span>${label}</span>
                </div>`;
            }).join('')}

        </div>

        <div class="marker-btn-row" style="margin-top:6px;">
            <button class="route-filter-toggle-btn color-cycle-btn${_routeFilter ? ' btn-active' : ''}">
                Filter markers: <strong>${_routeFilter ? 'On' : 'Off'}</strong>
            </button>
        </div>
    `;

    // --- Attach color cycle button ---
    _routeContainer.querySelector('.color-cycle-btn').addEventListener('click', () => {
        _colorIdx = (_colorIdx + 1) % ROUTE_COLOR_CYCLES.length;
        _renderRouteControls();
        _onColorChange(ROUTE_COLOR_CYCLES[_colorIdx]);
    });

    // --- Attach filter markers toggle ---
    const nearbyBtn = _routeContainer.querySelector('.route-filter-toggle-btn');
    nearbyBtn?.addEventListener('click', () => {
        _routeFilter = !_routeFilter;
        nearbyBtn.innerHTML = `Filter markers: <strong>${_routeFilter ? 'On' : 'Off'}</strong>`;
        nearbyBtn.classList.toggle('btn-active', _routeFilter);
        _onRouteFilterToggle?.(_routeFilter);
    });

    // --- Attach clear filter button (not shown in title mode) ---
    const clearBtn = _routeContainer.querySelector('.legend-clear-btn');
    clearBtn?.addEventListener('click', () => {
        _routeContainer.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active'));
        clearBtn.disabled = true;
        clearBtn.classList.add('inactive');
        _onLegendClick?.({ scheme: current, keys: [] });
    });

    // --- Attach legend item hover and click event listeners ---
    _routeContainer.querySelectorAll('.legend-item').forEach(item => {
        
        // Hovering a legend item fires the onLegendHover callback with the item's key and current color scheme 
            // -> highlights corresponding segments on the map until mouseoff
        item.addEventListener('mouseenter', () =>
            _onLegendHover?.({ scheme: current, key: item.dataset.key })
        );
        item.addEventListener('mouseleave', () => _onLegendHover?.(null));

        // Clicking a legend item toggles its active state and fires the onLegendClick callback with the new set of active keys for the current scheme 
            // -> highlights corresponding segments on the map until cleared
        item.addEventListener('click', () => {

            if (isTitle) { // Title mode: clicking a legend item navigates directly to that route
                _onLegendClick?.({ scheme: current, key: item.dataset.key });
            
            } else { // Other modes: clicking toggles a multi-select filter
                
                item.classList.toggle('active');
                const activeKeys = _getActiveKeys();
                if (clearBtn) {
                    clearBtn.disabled = activeKeys.length === 0; 
                    clearBtn.classList.toggle('inactive', activeKeys.length === 0);
                }
                _onLegendClick?.({ scheme: current, keys: activeKeys }); 
            }
        });
    });
}


// --- WAYPOINT FILTER PANEL ---
    // Initialize the waypoint filter panel with checkboxes for each category.
export function init(container, onFilterChange, counts = {}) {
    _container = container;
    _onFilterChange = onFilterChange;

    // Build one checkbox row per flat waypoint category
    const flatHTML = Object.entries(WAYPOINT_FILTERS.category).map(([key, { label, color }]) => {
        const countBadge = counts[key] != null
            ? ` <span class="filter-count">(${counts[key]})</span>`
            : '';

        if (key === 'campsite') return _buildCampsiteHTML(key, color, countBadge);

        return `
            <label class="filter-item">
                <input type="checkbox" class="type-checkbox" value="${key}" checked>
                <span class="filter-dot" style="background:${color}"></span>
                ${label}${countBadge}
            </label>
        `;
    }).join('');

    // Build collapsible group sections
    const groupHTML = WAYPOINT_FILTERS.groups ? Object.entries(WAYPOINT_FILTERS.groups).map(([groupKey, group]) => {
        const childRows = Object.entries(group.categories).map(([key, { label, color }]) => {
            const countBadge = counts[key] != null ? ` <span class="filter-count">(${counts[key]})</span>` : '';
            return `
                <label class="filter-item filter-item--child">
                    <input type="checkbox" class="type-checkbox" value="${key}" checked>
                    <span class="filter-dot" style="background:${color}"></span>
                    ${label}${countBadge}
                </label>
            `;
        }).join('');

        return `
            <div class="filter-group" data-group="${groupKey}">
                <div class="filter-item-group">
                    <label class="filter-item">
                        <input type="checkbox" class="group-checkbox" data-group="${groupKey}" checked>
                        ${group.label}
                    </label>
                    <button class="sub-filter-toggle group-toggle is-open" title="Expand ${group.label}">
                        <img src="/icons/UI/arrow-up-to-line.svg" width="12" height="12" alt="">
                    </button>
                </div>
                <div class="sub-filter-section open" id="group-${groupKey}-items">
                    ${childRows}
                </div>
            </div>
        `;
    }).join('') : '';

    _container.innerHTML = flatHTML + groupHTML;

    // Attach all category checkboxes
    _container.querySelectorAll('.type-checkbox').forEach(cb => {
        cb.addEventListener('change', _handleChange);
    });

    // Attach the campsite quality dropdown toggle & update look
    const subToggle = _container.querySelector('.sub-filter-toggle:not(.group-toggle)');
    if (subToggle) {
        subToggle.addEventListener('click', (e) => {

            e.stopPropagation();
            _campsiteQualityOpen = !_campsiteQualityOpen;
            const section = _container.querySelector('#campsite-quality-filter');

            section.classList.toggle('open', _campsiteQualityOpen);
            (subToggle as HTMLElement).classList.toggle('is-open', _campsiteQualityOpen);
            if (_campsiteQualityOpen) _refreshQualityCount();
            _handleChange();
        });
    }

    // Attach group master checkboxes (check/uncheck all children)
    _container.querySelectorAll('.group-checkbox').forEach(gcb => {
        gcb.addEventListener('change', () => {
            const groupKey = (gcb as HTMLInputElement).dataset.group;
            _container.querySelectorAll(`#group-${groupKey}-items .type-checkbox`).forEach(cb => {
                (cb as HTMLInputElement).checked = (gcb as HTMLInputElement).checked;
            });
            _handleChange();
        });
    });

    // Attach group expand/collapse toggles
    _container.querySelectorAll('.group-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = (btn.closest('.filter-group') as HTMLElement).querySelector('.sub-filter-section');
            const isOpen = section.classList.toggle('open');
            (btn as HTMLElement).classList.toggle('is-open', isOpen);
        });
    });

    // Initialize the noUiSlider (dual-range slider) for campsite quality
    const sliderEl = _container.querySelector('#quality-slider');
    noUiSlider.create(sliderEl, {
        start: [1, 6],
        connect: true,
        range: {min: 1, max: 6},
        step: 1,
    });

    // While dragging: update count badge and re-render markers live
    sliderEl.noUiSlider.on('slide', (values) => {
        _qualityMin = Math.round(+values[0]);
        _qualityMax = Math.round(+values[1]);
        _refreshQualityCount();
        _handleChange();
    });

    // On release: trigger the full map re-render
    sliderEl.noUiSlider.on('change', (values) => {
        _qualityMin = Math.round(+values[0]);
        _qualityMax = Math.round(+values[1]);
        _handleChange();
    });
}


// Update the filter panel DOM and re-filter waypoints -> called by index.js as part of renderAll() after any state change.
// updateMarkersFn receives the filtered features array and is responsible for adding/removing markers on the map.
export function render(state, data, updateMarkersFn) {

    // Sync checkbox checked states with the current state.activeTypes
    _container.querySelectorAll('.type-checkbox').forEach(cb => {
        cb.checked = state.activeTypes.has(cb.value);
    });

    // Sync group master checkboxes: checked if all children active, indeterminate if some
    _container.querySelectorAll('.group-checkbox').forEach(gcb => {
        const groupKey = (gcb as HTMLInputElement).dataset.group;
        const children = [..._container.querySelectorAll(`#group-${groupKey}-items .type-checkbox`)] as HTMLInputElement[];
        const checkedCount = children.filter(c => c.checked).length;
        (gcb as HTMLInputElement).checked = checkedCount === children.length;
        (gcb as HTMLInputElement).indeterminate = checkedCount > 0 && checkedCount < children.length;
    });

    // Filter the waypoint feature collection down to only what should be visible
    let filtered = data.all_waypoints.features.filter(f => {
        if (!state.activeTypes.has(f.properties.category)) return false;

        // When the quality dropdown is open, additionally filter campsites by quality range
        if (f.properties.category === 'campsite' && _campsiteQualityOpen) {
            const q = f.properties.site_quality;
            if (q != null) {
                const rounded = Math.min(6, Math.max(1, Math.round(+q)));
                return rounded >= _qualityMin && rounded <= _qualityMax;
            }
        }

        return true;
    });

    // Route filter — trailheads use property matching; other markers use precomputed nearTrailTitles
    if (state.routeFilter && (state.hoveredLegend != null || state.selectedRouteId != null || state.activeRouteFilter != null)) {

        const hovered = state.hoveredLegend;
        const clicked  = state.activeRouteFilter;
        const selectedTitle = state.selectedRouteId != null
            ? data.routeById.get(state.selectedRouteId)?.properties?.title ?? null
            : null;

        // title→difficulty map for non-trailhead difficulty filtering
        const titleDifficulty: Record<string, string> = {};
        data.routes.features
            .filter(r => r.properties.type === 'COASTAL PATH')
            .forEach(r => { titleDifficulty[r.properties.title] = r.properties.difficulty; });

        filtered = filtered.filter(wp => {
            const props = wp.properties;

            if (props.category === 'trailhead') {
                const cleanedTitle = props.title?.replace(/^\d+\.\s+/, '').replace(/ Path$/, '');
                if (hovered) {
                    const { scheme, key } = hovered;
                    if (scheme === 'title') return cleanedTitle === key;
                    if (scheme === 'type')  return true;
                    return props.difficulty === key;
                }
                if (selectedTitle != null) return cleanedTitle === selectedTitle;
                if (clicked) {
                    const { scheme, keys } = clicked;
                    if (scheme === 'type') return true;
                    return keys.has(props.difficulty);
                }
                return true;
            }

            // campsite / water / camera — precomputed nearTrailTitles (tagged by tag_waypoints.py)
            const nearTitles: string[] = props.nearTrailTitles ?? [];
            if (hovered) {
                const { scheme, key } = hovered;
                if (scheme === 'title') return nearTitles.includes(key);
                if (scheme === 'type')  return true;
                return nearTitles.some(t => titleDifficulty[t] === key);
            }
            if (selectedTitle != null) return nearTitles.includes(selectedTitle);
            if (clicked) {
                const { scheme, keys } = clicked;
                if (scheme === 'type') return true;
                return nearTitles.some(t => keys.has(titleDifficulty[t]));
            }
            return false; // can't resolve filter context — hide rather than show
        });
    }

    updateMarkersFn(filtered);
}

// Collect the active checkbox values and fire the filter-change callback. 
function _handleChange() {
    const active = new Set();
    for (const cb of _container.querySelectorAll('.type-checkbox:checked')) {
        active.add(cb.value);
    }
    _onFilterChange(active);
}
