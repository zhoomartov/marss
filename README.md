# ARES — Exploration Atlas

English, static Three.js application. Run `npm start`, open http://127.0.0.1:4173. Run `npm run check` for JavaScript syntax checks. Static publishing root: `dist`.

## Current release

- A persistent WebGL renderer, scene and camera connect the galaxy, solar system, Mars arrival and surface atlas. No replacement canvas or second Mars model on arrival.
- The Milky Way uses NASA/JPL-Caltech PIA10748 as the density/color guide for a volumetric star field and diffuse gas particles, with a thicker central bulge and warped outer disc. No flat image plane is rendered. The camera enters an illustrative Orion Spur position away from the nucleus. It is an artist’s concept. The scene changes scale illustratively; it is not a physically scaled universe or an ephemeris.
- Textured Sun, Mercury, Venus, Earth with a cloud layer, Mars, Jupiter and Saturn with rings. Assets are local and uploaded to the GPU before the journey starts. Rendering pauses in hidden tabs; device pixel ratio is capped and reduced on slow frames.
- One UV mesh morphs between a sphere and an equirectangular plane. The flat map supports pan, deep zoom, coordinate picking, region navigation, grid toggle, NASA Trek WMTS imagery and route pixel inspection.
- NASA image archive is fetched on demand, independently of the animation. Errors expose a retry option.

## Controls

Begin the journey with the button, a key outside navigation controls or a click on the galaxy. Timeline stops navigate between chapters. Pause, Skip to Mars and Replay control the flight. Reduced-motion preferences make transitions immediate.

At Mars, drag to orbit and use the wheel or +/− to zoom. The pivot is the physical center of Mars; an off-axis camera projection positions the globe beside the menu. Manual interaction pauses automatic spin. Open surface atlas / 2D MAP unfolds the globe. In the atlas drag to pan, click a location, or select a region in the side panel (mobile: destination selector). Use 3D GLOBE or Escape to return. Copy coordinates is user-initiated and uses the browser clipboard API; coordinates remain displayed if clipboard access is unavailable.

## Code

- `dist/journey.js`: graphics resources, camera travel, UV sphere/plane interpolation and map interaction.
- `dist/app.js`: interface state, dialogs, region selection and NASA archive.
- `dist/style.css`: responsive cinematic interface and atlas panel.
- `server.mjs`: loopback-only local static preview.

## Sources and licenses

- Galaxy: NASA/JPL-Caltech, https://science.nasa.gov/photojournal/our-milky-way-gets-a-makeover-artist-concept/ . Downloaded at 2560px for graphics memory efficiency.
- Enhanced 8192 × 4096 Mars mosaic and other planet/sky textures: Solar System Scope, https://edu.solarsystemscope.com/textures/ , CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . NASA-based, color-adjusted visual maps; some unmapped areas are filled illustratively. Display shaders adjust saturation and lighting.
- Viking layer: NASA/JPL-Caltech/USGS, https://science.nasa.gov/3d-resources/mars/ . Global equirectangular imagery.
- NASA archive: https://images-api.nasa.gov/search . No API key required.
- Three.js 0.170.0 and OrbitControls: MIT; license in `dist/assets/THREE-LICENSE.txt`.
- Fonts: Google Fonts, DM Sans and Instrument Serif, with system fallbacks.

## Verification and boundaries

Browser-checked: full flight, arrival, atlas unfolding, coordinate click, Jezero region navigation, imagery switch, grid toggle, return to globe and reverse navigation. Desktop and 390 × 844 mobile layouts checked. Confirmed a single canvas throughout.

Coordinates are visual equirectangular locations, not navigation-grade terrain measurements. Route pixel coverage is implemented. No calibrated slope analysis, safe-route optimization, current weather or astronaut/rover operational guidance is implemented. These are separate future phases requiring appropriate terrain products and validation. Independent project; not affiliated with NASA.

## Latest correction verification

JavaScript syntax and source diff checks passed. Browser interaction QA for this correction was blocked by the Windows Computer Use URL-identification guard; the new recording could not be inspected with the available media tools. Earlier release browser checks above do not verify these latest changes.

## Continuous Orion approach

The solar origin is fixed at the illustrative Orion destination. The camera follows a logarithmic approach in a shared coordinate system; planets no longer grow or move to mask a scene handoff. The galaxy has a warm volumetric bulge, blue-white stellar arms and diffuse emission sampled from the NASA concept. Run `node --test flight.test.mjs` for destination alignment, monotonic approach, handoff continuity and Mars arrival checks. The revised scene was rendered in isolated headless Chrome at desktop size, with screenshots inspected and no runtime exceptions. This does not measure performance on all devices.

## Interactive chapter stops and planetary inspection

The journey waits at the galaxy, at the solar overview (progress 0.53), and at Mars. Continue or a non-modifier key outside editable controls advances one chapter; held-key repeats are ignored. Controls and selectors do not implicitly advance the journey. Galaxy and solar stops support orbit, zoom and reset; galaxy offers top/oblique viewpoints and a location-label toggle. Solar inspection focuses Sun, Mercury, Venus, Earth, Mars, Jupiter or Saturn with a smooth camera move. Orbit paths can be toggled.

Earth, Jupiter, Saturn and Sun now use 8K source imagery from the existing Solar System Scope CC BY 4.0 collection. The renderer downsamples these to 4096 pixels wide to bound GPU memory; Mars retains its existing atlas texture. Earth has a separate moving cloud shell and atmospheric rim; Venus and Sun have atmospheric/coronal rim effects. Saturn uses the collection's alpha ring texture with radial UV mapping. Sizes and lighting remain illustrative.

Validation: desktop browser renders inspected for solar overview, Earth and Saturn closeups; automated browser interaction checked the solar stop, three planet selections without advancing, a key to continue to Mars, the flat atlas, and mobile replay. No runtime exceptions or console errors in that run. Existing flight regression tests pass.

## Mini-simulation

Time Lab controls pause/resume, 0.25x/1x/4x speeds and reset. Galaxy stars and curved emission layers use differential rotation; the solar corona and prominence loops vary with simulation time. Solar bodies follow circular illustrative orbits with radius-dependent rates; the camera tracks the selected body. Animation pauses during travel and inspections; orbital positions smoothly return to the cinematic reference before arrival at Mars. Reduced-motion starts simulation paused. This is not a gravity integrator or an ephemeris.

GitHub destination: https://github.com/ernestST1/NASA_hackaton_2026 . The repository includes the static dist output plus local server and validation scripts. Site hosting identity remains in the private hosting checkout.

## Galaxy rendering correction

Reference comparison: NASA/JPL PIA10748 (https://science.nasa.gov/photojournal/our-milky-way-gets-a-makeover-artist-concept/) and ESA Gaia illustration (https://www.esa.int/media/the-best-milky-way-map-by-gaia). The implemented imagery remains the credited NASA concept. Removed additive emission shells and the dense glowing particle bulge; a relief-mapped image now preserves dark dust lanes and warm core detail, with a sparse independent 3D star population. Standard alpha compositing and tone mapping bound brightness. Differential winding was replaced by bounded sinusoidal drift, so mesh distortion cannot accumulate with simulated time. This is an illustrative 2.5D reconstruction, not a measured galactic volume.

## Lightweight v6-style animation

The galaxy geometry, particle counts, color and exposure are restored from v6 (cbb9060). Time Lab, the simulation clock, orbital integration, tracking and per-frame simulation UI updates have been removed. Decorative GPU star drift, cloud motion and a subtle solar glow replace simulation; planet positions stay fixed. Axial rotation is 0.075 rad/s for solar planets (25% faster than v8), and 0.032 rad/s for the Mars globe. Background rendering is capped at 30 fps; camera interaction and transitions allow 60 fps. Static maps, paused Mars and reduced-motion views stop drawing after controls settle. Hidden tabs stop the animation loop. CPU savings depend on device/browser; no universal reduction is claimed.

## NASA Trek WMTS and route pixel inspection

The globe and atlas now use CTX and MOLA tiles. The original local Mars images remain cinematic startup assets and the explicit WebGL fallback link. Once WMTS starts, a neutral background represents unavailable data; local imagery is not passed to analysis. No publication or Git commit is part of this change.

- dist/wmts.js reads live GetCapabilities, including ResourceURL, matrix identifiers and tile sizes (CTX: 512; MOLA: 256). Supports the global Mars EQ grid with origin -180,90; rejects incompatible grids. CTX currently advertises an ArcGIS tile resource through its NASA capabilities.
- Distinct global and viewport textures preserve the existing globe/plane mesh. Detail tiles load after interaction settles, with a 24-tile viewport budget, six concurrent requests, timeout, bounded 96-entry cache and stale-result guards. Tile errors leave missing data transparent and expose partial/error state plus retry.
- dist/route.js interpolates a shortest great-circle route on a spherical Mars (radius 3389.5 km), handles the antimeridian and rejects ambiguous antipodal endpoints. It is a candidate line, not an obstacle-avoiding path.
- Select a location, set start, select another and set destination, then Analyze NASA pixels. Analysis uses both products independently of the visible layer at matrix index 7 (or the highest available lower index), with 65 points. JSON export includes each coordinate, RGBA, matrix ID, tile/pixel indices, equatorial pixel spacing and retrieval timestamp. Sampling is independent of visual colour grading.
- The count is opaque-pixel availability, not validated scientific coverage. Opaque no-data values and gaps between samples are not detected. JPEG/colour-shaded relief cannot provide calibrated elevation, slope, rock abundance or current conditions. Safety remains UNKNOWN even with 100% pixel availability. No fabricated RGB-to-height conversion or safety percentage is used. A physical risk model still requires a documented raw DEM/terrain service, its no-data/scale/offset metadata, route-corridor resolution and explicit mobility thresholds.

Sources: [NASA WMTS documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars), [CTX capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml), [MOLA capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml). External imagery is archival, not real-time.

Validation: npm run check; npm test (12 passing cases including flight regressions, tile boundaries, dateline routes, absent data and stale analysis). Live headless Chrome loaded both products, sampled Jezero–Gale (64/65 opaque samples in both layers during the run), switched layers and rendered desktop/mobile layouts without runtime exceptions. Availability is time-dependent.

Additional live browser checks: zoom reached CTX matrix 9 with 20/20 tiles; rapid layer switching retained the newest selection; simulated offline mode showed partial missing coverage without runtime exceptions.

## Restored base map, rotation and expanded layer catalog

The original local 8K Mars mosaic is again the default on both globe and atlas; Viking is also restored. NASA WMTS products are additional selections: MOLA + HRSC shaded relief, MOLA colour hillshade, MOLA roughness, THEMIS night IR, TES plagioclase and CTX. Their identifiers and tile formats are read from the NASA capabilities, not inferred from names. Route analysis continues to sample CTX and MOLA only; the four added visual layers do not silently become numerical risk inputs.

Rotation is no longer disabled by entering the map or starting an orbit drag. The explicit pause/resume setting persists across atlas visits (reduced-motion still determines its initial setting). The selected-location ring scales with camera distance and viewport height to remain 20 CSS pixels across. Its depth offset is zero so it stays visible even at deep zoom.

Validation: live Chrome loaded all six NASA layers, returned to the original map, verified changing rotation uniforms before/after a map visit and verified explicit pause. Screenshots inspected before and after 30 zoom-in steps show the marker retaining its small screen size. No runtime exceptions.

## Transparent WMTS coverage correction

THEMIS and TES PNG tiles contain transparent coverage gaps. The globe shader previously discarded global-tile alpha, displaying these gaps as black. Global and detail WMTS textures now use premultiplied-alpha compositing. For THEMIS and TES, transparent areas show the original visual Mars map, explicitly identified in the layer status as background without observations. At detail level, gaps use that same background rather than misleading coarser scientific imagery. Raw tile RGBA and route sampling are unchanged; no pixel values are invented or masked by brightness. Source swath boundaries remain visible.

Verified live level-0 source alpha (both products had zero opaque-black pixels in the inspected tile), both global/detail map compositions and globe rendering in headless Chrome. Desktop screenshots inspected; no runtime exceptions.

## Standalone science maps (supersedes coverage underlay)

Removed the visual Mars underlay from scientific layers. Transparent source pixels now show a neutral screen-space hatch labelled no source data, both globally and at detail level. Scientific layers bypass the cinematic desaturation; original/local imagery retains its previous appearance. No interpolation, inpainting or replacement measurements are claimed. Native swath boundaries and genuinely missing source coverage remain. Syntax checks and live THEMIS/TES map/globe browser checks passed without runtime exceptions.

## THEMIS switched to USGS COG (2026-11-13)

Only THEMIS Night IR changed provider: official NASA/USGS controlled mosaics from https://registry.opendata.aws/nasa-usgs-themis-mosaics/ (CC0; DOI 10.5066/P96FA04Z). The checked ASU TES Plagioclase PNG has the same missing coverage as Trek, so TES remains unchanged. No visual Mars underlay or inferred values are used.

The bundled GeoTIFF.js 3.0.5 decoder (MIT, assets/GEOTIFF-LICENSE.txt) reads HTTP byte ranges from 28 official COGs and chooses embedded overviews. Full-file fallback is disabled. A local catalog records source URLs and extents derived from the STAC affine transform and shape. Metres are converted using the source Mars sphere radius 3396190 m, central meridian zero, planetocentric/east-positive coordinates. Nearest resampling preserves valid byte values; GDAL NoData stays transparent. Both global and viewport mosaics use this provider, with the existing cache, concurrency and stale-result guards. Source coverage does not include the poles.

Comparison at matching geographic extents using 512-pixel-wide previews: Margaritifer Sinus (MC19) valid coverage 83.01% Trek vs 99.98% USGS; Argyre (MC26) 68.84% vs 95.99%. Shared-pixel brightness correlations 0.878 and 0.858 at these preview scales; these are visual alignment checks, not scientific positional certification. The old internal coverage gap is filled with source observations.

Validation: 16 unit tests including grid orientation, Mars metre conversion, quadrant boundary pixel centres, no-data intersections and existing flight/route tests; browser rendered all global USGS tiles and both scientific layers without runtime exceptions. Source imagery remains qualitative 8-bit, not calibrated temperature or a safe-driving classification.

## Environmental atlas and astronaut planning context (2026-11-13)

Environment adds four independently selectable MCD 6.2 maps: air temperature at 2 m (Celsius), surface pressure (Pa), horizontal wind speed (m/s), and monthly visible column dust optical depth. Eight bundled scenarios cover solar longitudes 0/90/180/270 degrees at local hours 02:00/14:00, with climatological dust and average solar activity. These are seasonal model outputs, not current weather or storm warnings. Every longitude uses the same local hour, so a map is not a simultaneous global snapshot.

The retained source ASCII grids have 64 x 48 samples (~5.7 x 3.8 degrees, hundreds of kilometres). Longitude labels have up to one degree uncertainty. Display and point sampling use the nearest grid cell, expose its coordinates and distance, and never claim detailed local predictions. All eight original ASCII responses, machine-readable values, retrieval timestamps, query URLs and credits are retained in dist/data. Reproduce missing scenarios with node scripts/fetch-climate.mjs; the script reuses cached JSON files to avoid unnecessary service requests. Source: https://www-mars.lmd.jussieu.fr/mcd_python/index.html (MCD, LMD/OU/IAA/ESA/CNES).

Archived observations are separate from the modeled map. MEDA sol 1859 contains calibrated mast sensor 1 temperatures and derived pressure observed May 13-14, 2026; the sensor can be affected by rover heating. REMS provides the latest 30 sols available in the downloaded outreach response, ending August 25, 2026, not an operational product. Missing wind stays null. Source timestamps, age, sample counts, PDS labels, source links and raw-response SHA-256 hashes accompany the snapshot. Navigation uses landing-site references, not the rover position at observation time. node scripts/fetch-observations.mjs rebuilds observations.json from the documented fixed MEDA sol and current REMS response; it does not automatically discover later PDS releases.

Point and route JSON exports include model provenance. A route samples 129 points along the existing great-circle candidate and reports modeled environmental ranges and the number of distinct model cells. User-entered travel speed, autonomy, reserve, stops and return option produce a time budget only. They are not validated spacesuit specifications, an oxygen-consumption model, terrain-aware routing or EVA clearance. The report always retains unknown safety. The original pixel export takes the current environment report at download time.

Radiation is explicitly historical context (RAD Gale benchmark, 2012-2013), not a current dose map. Atmospheric oxygen/pressure and subsurface-water context link to NASA and SWIM. Current radiation, storms, accessible supplies, calibrated local slopes and obstacles remain unknown; rendered relief RGB is never converted into physical heights. Original surface imagery remains a separate selectable map.

Validation: 26 tests cover the existing map/route behavior plus all eight climate grids, units, orientation, dateline, missing data, observation dates, route budgets and unknown safety. Desktop/mobile Chrome checks covered all four fields, rapid scenario changes, station navigation, return to original imagery, invalid budget input and route reporting, with no runtime exceptions.

## Streaming terrain map (2026-11-13)

On the first atlas entry, CTX is selected automatically; the original 8K and Viking maps remain selectable and the globe initially retains its original appearance. The prominent Explore detailed CTX map button returns to streamed imagery. Static maps now explicitly identify their fixed resolution. Climate fields remain coarse model grids and are not sharpened into invented terrain.

Viewport tile selection now uses rendering pixel density, clipped map coverage, a 64-tile budget and the actual GPU texture limit (capped at 4096 pixels per axis), rather than a fixed 24-tile cap and CSS width. Global and viewport textures still share the same Mars coordinate system. The UI reports loading, downloaded matrix, pixel spacing at the equator, partial coverage, memory fallback and source resolution limit. A horizontal ground-scale bar follows latitude and camera zoom. Anisotropic filtering improves texture presentation without creating measurements.

CTX now uses Caltech Murray Lab's V01 semi-controlled mosaic through the Esri CTX1 service, as linked by the official Caltech viewer and ArcGIS item 30c4acfe36284b1784bf07d5d73f9e4d. Source: https://murray-lab.caltech.edu/CTX/V01/TilePages/ ; service: https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer . The old beta service returned truncated PNGs on several high-resolution tiles, causing blank detail. V01 replaces it for both visualization and route pixel inspection. Credits: Esri, Caltech Murray Lab, NASA, JPL, MSSS.

The adapter validates the live service metadata: Mars 2000 sphere (3396190 m), top-left (-180,90), 512-pixel tiles and geographic latitude/longitude. Floating-point resolution rounding is allowed within a small tolerance, incompatible grids are rejected. Levels above 12 are intentionally excluded: the original mosaic is approximately 5 m/pixel, and advertised finer levels cannot create extra measurements. Level 12 provides about 5.09 m/pixel at the equator. A checked tileInfo snapshot is retained for regression tests. This mosaic is not a certified positional terrain model; genuine no-data stays hatched. The ground scale uses the app's existing mean-radius sphere and is approximate, whereas CTX tile pixel spacing uses its source radius.

### Data needed for the next route-planning stage

Keep imagery and numerical terrain independent. The USGS foundational inventory lists the global HRSC/MOLA blended elevation product at 200 m/pixel: https://fdp.astrogeology.usgs.gov/fdp/mars/ . This is a candidate broad-scale DEM source, not yet connected to the app. Local CTX/HiRISE stereo DTMs will be needed where finer slope/obstacle decisions are required; they are not available everywhere. A future DEM adapter must validate coordinate reference, vertical datum, units, scale/offset, no-data mask, pixel spacing and coverage before deriving slopes. Unknown terrain must not become a zero-cost route cell. Route cost-grid resolution must follow the numerical DEM, not screen zoom or image pixel size. The current route tool remains great-circle inspection; no obstacle-avoiding algorithm is claimed in this update.

Validation for this update: 33 tests passed, including the recorded CTX metadata, pyramid selection, source-limit reporting and GPU budgets. Live Chrome loaded levels 5 (15/15), 9 (20/20) and 12 (6/6) while zooming around Jezero; a separate level-12 region request loaded 9/9 tiles. Desktop and mobile screenshots were inspected; original-map selection and return to CTX worked without runtime exceptions.

## Automatic close-ups for overview maps

Original Mars and Viking now retain their overview appearance and automatically request geographically aligned CTX V01 viewport imagery when their native texture would exceed 1.25 render pixels per source pixel. This also works when selecting either overview while already zoomed in. Zooming out removes the CTX detail texture and restores the selected overview; other scientific layers keep their own data. The atlas no longer forcibly selects CTX on entry. An always-visible caption beside the scale identifies the automatic CTX close-up and its pixel spacing; the selected overview radio stays selected. CTX is grayscale source imagery, not a colour reconstruction of Viking. Stale requests are guarded by both layer and viewport epochs.

Validation: 33 tests and syntax checks pass; live browser checks cover Viking automatic close-ups, switching to Original at close range, overview reset and mobile layout.

## Tile-loading performance

Viewport mosaics now stream into a reused GPU texture as tiles arrive, starting at the centre. Progress uploads are throttled to 120 ms and the final state is always published. The interaction debounce is 140 ms instead of 300 ms. Six workers dispatch tiles incrementally; a superseded view stops dispatching remaining work instead of filling the shared request queue with up to 64 obsolete requests. Already running requests may finish and populate the existing bounded LRU cache.

Imagery decoding no longer copies every tile into a numerical RGBA buffer. Pixel readback happens lazily when route analysis samples that tile and is reused for subsequent samples. This removes unnecessary CPU work and duplicate pixel storage during visual navigation. Scientific pixel values and map resolution are unchanged.

Validation: 36 tests pass, including incremental progress, stopping superseded work and lazy numerical readback. Live Chrome exercised automatic Viking/Original detail, zoom levels 5/9/12 and mobile layout. In one region-load measurement after metadata was available, first progress was 344 ms, full mosaic 945 ms, and repeat assembly from memory 0.6 ms (not end-to-end frame latency or a universal speed guarantee).

## Phobos and Deimos (2026-11-13)

Added NASA/JPL-Caltech GLB meshes with their original embedded image textures from https://science.nasa.gov/resource/phobos-mars-moon-3d-model/ and https://science.nasa.gov/resource/deimos-mars-moon-3d-model/ . Assets are bundled locally; no image generation or invented crater geometry. Original model proportions are preserved; material metalness is zero for a matte rocky surface. GLTFLoader and BufferGeometryUtils match the bundled Three.js r170 (MIT).

Both moons orbit Mars in the same scene. Sizes and orbit distances are deliberately illustrative and labelled in the UI. Period ratio uses 7.65/30.3 hours at 0.05 simulated hours per displayed second; phases are illustrative, not ephemerides. Rotation is synchronous. Motion respects reduced-motion and the Mars pause control, and pauses during close-up inspection. Select Phobos/Deimos to orbit and zoom around each model; Mars returns to the planet. Moons hide during the flat atlas and reappear on return.
