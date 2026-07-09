# ECTMap.ca

**[ectmap.ca](https://ectmap.ca)** — An interactive map of the [East Coast Trail](https://eastcoasttrail.com), a 336 km hiking trail along the Avalon Peninsula of Newfoundland, Canada.

Built by a hiker, for hikers. I completed a north-to-south through-hike of the ECT in summer 2024 and built this tool to help others plan their own trips.

---

## Features

- **Interactive trail map** — 25 named routes rendered as styled polylines, color-coded by difficulty, type, or route name
- **Elevation profiles** — D3-powered chart for any selected route with gain/loss stats, hover crosshair, and drag-to-select range analysis
- **Waypoints** — Trailheads, backcountry campsites (with quality ratings), water sources, and scenic spots
- **Filtering** — Toggle waypoint categories, filter campsites by quality rating (dual-range slider), and isolate routes via the color legend
- **Multiple basemaps** — Satellite, OpenStreetMap, and Topographic; optional contour lines, place labels, and 3D hillshade overlay
- **Route navigation** — Step through all 25 routes in trail order with Prev/Next, flip N↔S display direction

## Tech Stack

- [MapLibre GL JS](https://maplibre.org/) — WebGL map rendering
- [D3.js](https://d3js.org/) — Elevation chart SVG
- [noUiSlider](https://refreshless.com/nouislider/) — Campsite quality range slider
- [Vite](https://vitejs.dev/) + TypeScript — Build tooling
- [GitHub Pages](https://pages.github.com/) — Hosting (deployed automatically on push to `main`)

## Local Development

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build → dist/
npm run preview  # serve the production build locally
```

## Disclaimer

This is an **unofficial** project and is not affiliated with or endorsed by the [East Coast Trail Association](https://eastcoasttrail.com). Trail data was collected in 2024 and likely doesn't reflect current conditions — always verify conditions with the ECTA before heading out.

Consider [supporting the ECTA](https://eastcoasttrail.com/ways-to-give/) — they maintain the trail.

---

# Attributions

UI SVG Elements via svgrepo.com:
- [Chunk 16px Thick Interface Icons](https://www.svgrepo.com/collection/chunk-16px-thick-interface-icons/) 
  - [PD License](https://creativecommons.org/publicdomain/zero/1.0/deed.en)
- [GIS Mapping Icons](https://www.svgrepo.com/collection/gis-mapping-icons/) 
  - [GNU GPL License](https://choosealicense.com/licenses/gpl-3.0/)

## Map Tile Attributions

| Layer | Source | Tile URL |
|-------|--------|----------|
| Satellite | Tiles © Esri (World Imagery) | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| OpenStreetMap | Tiles © OpenStreetMap contributors, © CARTO (CartoDB Dark) | `https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png` |
| Topographic | Tiles © OpenTopoMap (CC-BY-SA) | `https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png` |
| Labels | © Esri (World Boundaries and Places) | `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}` |
| Contour Lines | © Natural Resources Canada | `https://maps.geogratis.gc.ca/wms/canvec_en?SERVICE=WMS&REQUEST=GetMap&...` |
| Terrain / Hillshade | © Mapzen / AWS | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` |
