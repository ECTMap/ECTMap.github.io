import * as d3 from 'd3';

const BASE = "/data";


// --- COLOR CONSTANTS ---

export const WAYPOINT_FILTERS = {
    category: {
        trailhead:  {label: 'Trailheads',       color: '#ffffff'}, // Fallback color as trailhead marker colors determined by colorby state
        campsite:   {label: 'Campsites',        color: '#9b59b6'}, // Fallback purple, but actual campsite marker colors are determined by campsite quality when that dropdown is open (see categoryColor function in filterPanel.js)
        water:      {label: 'Water Sources',    color: '#3498db'},
        camera:     {label: 'Scenic Spots',     color: '#f1c40f'},
    }
};

export const ROUTE_FILTERS: { [key: string]: any } = {
    type_difficulty: [
        {label: 'Easy',         key: 'Easy',        color: '#16dd52'}, 
        {label: 'Moderate',     key: 'Moderate',    color: '#bbc93a'},
        {label: 'Difficult',    key: 'Difficult',   color: '#FB8C00'},
        {label: 'Strenuous',    key: 'Strenuous',   color: '#D32F2F'},
    ],
    type: [
        {label: 'Coastal Path',    key: 'COASTAL PATH',    color: '#16dd52'},
        {label: 'Community Walk',  key: 'COMMUNITY WALK',  color: '#4d90c0'},
    ],

    // `title` -> populated dynamically after data loads (see below)
};


// 12 vibrant hues ordered so adjacent palette entries are maximally perceptually different. Similar-looking colors sit 6 slots apart (diametrically opposite), so they never land on neighboring routes when assigned sequentially (i % 12)
const CATEGORICAL_PALETTE = [
    '#e6194b',
    '#4363d8', 
    '#f032e6',
    '#f58231', 
    '#3cb44b',
    '#6a3d9a', 
    '#ffe119',
    '#800000',
    '#469990',
    '#808000',
    '#911eb4', 
    '#9a6324',
    '#008080',
];


// Populated after data loads in `const data` -> export, used by filterPanel.js to color based on filters =D
    // ROUTE_TITLE_COLORS -> array matching each colorBy option
        // Populated with route title (key) and color (value) pairs after data loads
    // ROUTE_TITLE_WALK_COLORS -> only for `colorBy: 'type'` -> lightened variant for COMMUNITY WALK segments of the same route 
export let ROUTE_TITLE_COLORS: Record<string, string> = {};
export let ROUTE_TITLE_WALK_COLORS: Record<string, string> = {};

// north-end waypoint coords for each route title: { lat, lon }
export let ROUTE_NORTH_ENDS = {};


// --- INIT GEOJSON DATA ---
    // Waits for all the data to load -> `await` is blocking
export const data: any = await Promise.all([
    d3.json(`${BASE}/waypoints/other_waypoints.geojson`),
    d3.json(`${BASE}/waypoints/site_waypoints.geojson`),
    d3.json(`${BASE}/waypoints/ect_waypoints.geojson`),
    d3.json(`${BASE}/routes/ect_routes.geojson`)
    
    
    ]).then(([other_waypoints, site_waypoints, ect_waypoints, routes]: any[]) => {

        // Tag sources that don't already have a category
        ect_waypoints.features.forEach(f => f.properties.category = 'trailhead');

        // Merge all waypoint features into one FeatureCollection
        const all_waypoints = {
            type: "FeatureCollection",
            features: [
                ...other_waypoints.features,
                ...site_waypoints.features,
                ...ect_waypoints.features,
            ]
        };

        // Assign stable integer IDs used by MapLibre feature state
        routes.features.forEach((f, i) => { f.id = i; });

        // Pre-compute route length from elevation profile coordinates
        routes.features.forEach(f => {
            const profile = buildElevationProfile(f);

            f.properties.length_km_calc = profile.length > 0
                ? +(profile.at(-1).distanceKm.toFixed(1)) // cum dist is in the last point of the profile, round to 1 decimal place
                : null;
        });

        // Build routeTitleMeta -> waypoint display name + ECT number + north endpoint from trailhead waypoints
        // e.g. "Long Shore" -> { display: "01. Long Shore Path", num: 1 }
        const routeTitleMeta = {};

        ect_waypoints.features.forEach(f => {
            const cleaned = f.properties.title.replace(/^\d+\.\s+/, '').replace(/ Path$/, '');

            if (!routeTitleMeta[cleaned]) {
                routeTitleMeta[cleaned] = {
                    display: f.properties.title, // Use the trailhead waypoint title as the display name for the route/trail
                    num: parseInt(f.properties.title.match(/^(\d+)\./)?.[1] ?? '999'), // Extracted ECT trail number for sorting later
                };
            }

            // Make list of "north_end" waypoints lat/lon for direction detection/sorting later on
            if (f.properties.route_end === 'north_end') {
                const [lon, lat] = f.geometry.coordinates;
                
                ROUTE_NORTH_ENDS[cleaned] = { lat, lon };
            }
        });

        // Signal Hill has no trailhead waypoint — insert it as "09b" between routes 9 and 10
        routeTitleMeta['Signal Hill'] = { display: '09b. Signal Hill Path', num: 9.5 };

        // Build categorical color map: route title -> color, sorted by ECT number then alpha
        const titles = [...new Set(routes.features.map(f => f.properties.title))];
        
        // Sort titles by ECT number (extracted from title string)
        titles.sort((a: string, b: string) => routeTitleMeta[a].num - routeTitleMeta[b].num);

        // Map colors to sorted route titles -> loops back through upon reaching end
        ROUTE_TITLE_COLORS = Object.fromEntries(
            titles.map((t, i) => [t, CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]])
        );

        // Community walk variant: same hue, lighter + less saturated
        for (const [t, hex] of Object.entries(ROUTE_TITLE_COLORS)) {
            const c = d3.hsl(hex);
            c.l = Math.min(0.75, c.l + 0.28); // Ligthen -> cap at 75%
            c.s = c.s * 0.65;                 // Desaturate a bit -> distinct; but still clearly related
            ROUTE_TITLE_WALK_COLORS[t] = c.formatHex();
        }

        // Generate the titles filter option based on the route titles & sorted by ECT trail number
        ROUTE_FILTERS.title = titles.map((t: string) => ({
            label: routeTitleMeta[t]?.display ?? t,
            key: t,
            color: ROUTE_TITLE_COLORS[t],
        }));

        return { other_waypoints, site_waypoints, ect_waypoints, routes, all_waypoints,
                 routeById: new Map(routes.features.map(f => [f.id, f])) };

    }).catch(error => {
        console.error("Error loading GeoJSON Data -> data.ts", error);
        throw error;
    }
);

// --- ROUTE STATISTICS FUNCTIONS ---

// Count of each waypoint type in the Gaia dataset (for filter panel labels)
export const waypointCounts = data.all_waypoints.features.reduce((acc, f) => {
    const c = f.properties.category;
    // Sum waypoints by category
    if (acc[c] == null) { 
        acc[c] = 1;
    } else {
        acc[c] += 1;
    }
    return acc;
    }, {}
);


// Calculate distance between two lat/lon points (km)
    // Source: https://stackoverflow.com/questions/14560999/using-the-haversine-formula-in-javascript
export function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;  
    var dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return dist; 
}



// --- Build elevation profile from route geometry ---
    // Converts LineString or MultiLineString geometry with elevation (Z) into an array of { distanceKm, elevation, lat, lon } points

export function buildElevationProfile(feature) {

    // Normalize linestrings & multiline strings into arrays of coords
    const rawRings = feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    // Filter out invalid rings -> mostly failsafe for earlier iterations where the data was less cleaned, but left it in case of any future data issues.
    const validRings = rawRings.filter(r => {
        if (r.length <= 2) return false; // Drop artifacts with too few points -> failsafe

        // Drop any routes that have all points at the exact same lat/lon -> failsafe
        const [firstLon, firstLat] = r[0];
        const allPointsSameLocation = r.every(([lon, lat]) =>
                lon === firstLon && lat === firstLat
            );
            if (allPointsSameLocation) return false;
        
        return true;
    });

    const points = [];
    let cumDist = 0;

    // Build profile rows and cumulative distance for each valid segment (i.e., ring/route)
    for (const coords of validRings) {
        for (let i = 0; i < coords.length; i++) {

            const [lon, lat, elev] = coords[i];
            const ringStart = i === 0 && points.length > 0; // True at the first point of each additional segment

            if (i > 0) { // Add step distance only within the current segment
                const prev = coords[i - 1];
                cumDist += haversineKm(prev[1], prev[0], lat, lon);
            }

            points.push({ distanceKm: cumDist, elevation: elev, lon, lat, ringStart });
        }
    }

    return points; // Flat list of profile points with cumulative distance, elevation
}
