# Mars Atlas and Safe Route Lab

The visualization and route-planning module of **ARES**. See the [main README](../README.md) for the project overview, technology stack, and instructions for running both modules.

## Running locally

From this directory:

```bash
npm ci
npm start
```

- Atlas: http://127.0.0.1:4173/
- Route planner: http://127.0.0.1:4173/rover.html

The server serves `dist`. No build step is required. To send routes to the 3D viewer, also start `terrain-lab` as described in the main README.

## Key files

| File | Purpose |
| --- | --- |
| `dist/app.js` | Atlas interface state, location selection, and Terrain Lab links |
| `dist/journey.js`, `dist/flight.js` | Space scene and camera transitions |
| `dist/wmts.js`, `dist/usgs-themis.js` | Map layer integration |
| `dist/environment.js`, `dist/environment-ui.js` | Climate scenarios and interface |
| `dist/rover-core.js` | Terrain model, resources, route search, and verification |
| `dist/rover-worker.js` | Planner computations in a Web Worker |
| `dist/rover-ui.js`, `dist/rover-map.js` | Mission waypoints, map, reports, and export |
| `dist/data/mission-regions.json` | Mission areas and data provenance |
| `server.mjs` | Local static HTTP server |

## Working with data

Run the following commands from `mars-atlas`. Source data retrieval requires internet access and may take time; normal startup uses the files already included in the repository.

```bash
# Prepare HiRISE imagery and DEMs for mission areas
npm run fetch:regions

# Retrieve the regional CTX DEM
node scripts/fetch-rover-dem.mjs

# Prepare climate scenarios and archived observations
node scripts/fetch-climate.mjs
node scripts/fetch-observations.mjs
```

Sources, resolution, and processing details are recorded in the dataset JSON files and scripts. The observation archive is not an automated live weather feed.

### GeoTIFF conversion

Place a single-band Float32 HiRISE DTM at `raw_data/jezero_dtm.tif`:

```bash
npm run convert:terrain

# Or specify the input, output, and grid size explicitly:
node scripts/convert-hirise-dtm.mjs ./raw_data/jezero_dtm.tif ./public/data/mars_terrain.json 1024
```

The converter preserves the projected footprint and metadata, and validates units and raster orientation. Output contains `metadata` and a row-major `elevation` array; bounds use the source projection rather than latitude and longitude.

Conversion fills NoData with the minimum valid elevation before applying bilinear interpolation. The resulting dataset contains synthetic fills and does not replace the planner's strict treatment of unknown terrain. Files exported to `public/data` are not connected automatically: the current server serves `dist`.

## Validation

```bash
npm run check
npm test
```

Tests cover camera transitions, tiles, climate, georeferencing, GeoTIFF conversion, route constraints, and missions with intermediate stops. Check the interface separately in a browser to assess visual behavior.
