# ARES — Mars Exploration Atlas

An interactive Mars atlas, mission route planner, and 3D terrain laboratory. ARES brings space visualization, orbital imagery, and NASA / USGS elevation data into a single research interface.

## Features

- **Space journey:** travel from the Milky Way through the Solar System to Mars; explore all eight planets, Phobos, and Deimos.
- **Surface atlas:** switch between a 3D globe and a 2D map, select coordinates, zoom, and explore orbital layers and detailed CTX tiles.
- **Climate scenarios:** explore temperature, pressure, wind, and dust from the Mars Climate Database, alongside archived MEDA and REMS observations.
- **Safe Route Lab:** plan routes through ordered waypoints with exclusion zones and constraints on slope, energy, time, and modeled risks. Compare alternatives, inspect elevation profiles, export JSON reports, and print mission briefs.
- **3D Terrain Lab:** load terrain and imagery for a selected area, browse named Martian features, save custom locations, view routes on the surface, and export GPX.
- **Connected modules:** open atlas coordinates in 3D and send calculated routes from the planner to Terrain Lab.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Interface | HTML5, CSS3, JavaScript with ES Modules |
| 3D graphics | Three.js r170, WebGL, OrbitControls, GLTFLoader |
| Mapping and computation | Canvas 2D, Web Workers, Mars geographic coordinates |
| Server | Node.js, built-in HTTP server, REST API |
| Geospatial data | GeoTIFF.js, DEM / DTM, GeoTIFF / COG, WMTS and ArcGIS services |
| Storage | JSON files and Terrain Lab's filesystem cache |
| Route planning | A*, Dijkstra verification, resource-constrained search |
| Validation | Node.js Test Runner (`node --test`), `node --check` |

The frontend requires no build step. Static application files are stored in `mars-atlas/dist` and `terrain-lab/public`.

## Quick start

Install Git, npm, and Node.js. The project has been tested with **Node.js 22.20.0**. Use a browser with WebGL support. Internet access is required for external map layers and new data downloads.

```bash
git clone https://github.com/zhoomartov/marss.git
cd marss
npm ci --prefix mars-atlas
```

Run both servers in separate terminals from the repository root.

**Terminal 1 — Atlas and route planner:**

```bash
npm start --prefix mars-atlas
```

**Terminal 2 — 3D Terrain Lab:**

```bash
npm start --prefix terrain-lab
```

| Application | URL |
| --- | --- |
| Mars Atlas | http://127.0.0.1:4173/ |
| Safe Route Lab | http://127.0.0.1:4173/rover.html |
| 3D Terrain Lab | http://127.0.0.1:4174/ |
| API health | http://127.0.0.1:4174/api/health |

Terrain Lab uses built-in Node.js modules and libraries bundled in `public/assets`; it does not require a separate npm dependency installation. Press `Ctrl+C` in each terminal to stop its server.

## Using the project

1. Open Atlas, travel to Mars, and switch to the surface map.
2. Select a location and choose **Open 3D Terrain Lab**.
3. To plan a route, open `/rover.html`, select a mission area, and configure mission parameters.
4. Set the start, intermediate stops, and destination, then calculate the route.
5. Review route comparisons and the elevation profile. Use the GPS-to-3D export button to send the route to Terrain Lab, where GPX export is available.

## Repository structure

```text
marss/
├── README.md
├── mars-atlas/
│   ├── dist/                 # Atlas and Safe Route Lab interface
│   │   ├── assets/           # Bundled models, textures, and libraries
│   │   └── data/             # DEM, climate, and mission area datasets
│   ├── scripts/              # Data retrieval and GeoTIFF conversion
│   ├── *.test.mjs            # Mapping, flight, and planner tests
│   ├── server.mjs            # Atlas static server
│   └── README.md             # Module technical guide
└── terrain-lab/
    ├── public/               # 3D interface, worker, and libraries
    ├── data/                 # Feature catalog, locations, and routes
    ├── cache/                # External data cache, created at runtime
    ├── server.mjs            # REST API and interface server
    └── terrain.test.mjs      # Geometry, coordinate, and API tests
```

## Validation

Run from the repository root:

```bash
npm run check --prefix mars-atlas
npm test --prefix mars-atlas
npm run check --prefix terrain-lab
npm test --prefix terrain-lab
```

The module integration passed **62 Atlas tests and 7 Terrain Lab tests**. Terrain Lab integration tests start local HTTP servers; the global terrain test also requests external NASA services and depends on their availability.

## Server configuration

| Variable | Module | Default |
| --- | --- | --- |
| `PORT` | Atlas | `4173` |
| `PORT` | Terrain Lab | `4174` |
| `HOST` | Terrain Lab | `127.0.0.1` |
| `ATLAS_URL` | Terrain Lab | `http://127.0.0.1:4173` |
| `MARS_DIST_DIR` | Terrain Lab | The adjacent `mars-atlas/dist` directory |

If Terrain Lab runs at a different address, set it in the browser console on the Atlas page and reload:

```js
localStorage.setItem('ares-terrain-lab-url', 'http://127.0.0.1:5174');
location.reload();
```

Atlas can be hosted as a static site from `mars-atlas/dist`. Terrain Lab requires a running Node.js server and writable data and cache directories. For a hosted deployment, configure both module addresses: `127.0.0.1` links are intended for local use.

## Data sources and credits

- **NASA / JPL-Caltech / USGS:** orbital imagery, CTX / HiRISE DEM and DTM products, and Mars moon models. Product references and processing details are retained in the project datasets.
- **NASA Mars Trek:** global HRSC / MOLA elevation models and map layers.
- **Caltech Murray Lab / Esri / NASA / JPL / MSSS:** the detailed CTX V01 surface mosaic.
- **Mars Climate Database 6.2 (LMD / OU / IAA / ESA / CNES):** climate scenarios.
- **MEDA / REMS:** archived observations from Mars surface stations.
- **Solar System Scope:** planetary textures, licensed under CC BY 4.0.
- **NASA/JPL-Caltech PIA10748:** the Milky Way artist's concept used for the galaxy visualization.

Third-party library licenses are included alongside the libraries in the `assets` directories. The repository does not currently declare a project-wide source code license; third-party data and asset terms continue to apply.

## Model limitations

ARES is a research and demonstration project. Space scene scales and orbits are illustrative. Climate scenarios are not current weather forecasts. An “optimal route” is a result on the selected finite graph under the configured model parameters, not a certification of real mission safety. Imagery and DEM resolution differ; zooming into an image does not create new terrain measurements.

This is an independent project and is not affiliated with NASA.
