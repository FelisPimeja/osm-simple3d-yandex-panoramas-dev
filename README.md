# Yandex Panoramas DEV

Experimental local fork of osm-simple3d-yandex-panoramas. Uses the internal Yandex panorama metadata and tile endpoints directly, without an API key or the Yandex JS API player. No Python or build step required.

## Run independently

```sh
cd /Users/felispimeja/github/osm-simple3d-yandex-panoramas-dev
python3 -m http.server 8766 --bind 127.0.0.1
```

Open http://127.0.0.1:8766/. Enter longitude and latitude. Drag to rotate, scroll to zoom. Arrows over the photo navigate to linked panoramas and rotate with the view, using the same perspective ground and layered SVG design as Mapillary/Panoramax in the editor. The date dropdown in the lower-right corner shows the currently displayed capture and selects historical captures. The page displays the view cone values that the plugin sends to the editor.

## Editor integration

`plugin.js` exports the same `activate(api)` interface as the original. Serve `coverage.js` and `navigation.js` alongside it (relative ES module imports). For local testing, import it from the local server using the editor's plugin API; custom JSON plugins cannot execute JS modules. The production editor catalog is intentionally unchanged. The standalone page provides a small mock of that API and tests the viewer only. Map coverage requires the editor update below.

## Implementation

- Metadata: `api-maps.yandex.ru/services/panoramas/1.x/`, `ll=longitude,latitude` or `oid=panoramaId`.
- Tiles: `pano.maps.yandex.net/{imageId}/{level}.{x}.{y}`.
- WebGL perspective viewer, maximum texture width 4096 or device limit. Cropped bottoms are padded rather than stretched.
- Six concurrent tile requests; navigation/close aborts pending downloads.
- Attribution and link to Yandex Maps remain visible. View direction and source marking use the editor API.

For development experiments only. Internal endpoints can change or refuse requests; browser access requires CORS on metadata and imagery. No proxy or credentials are used. The MIT license of streetlevel covers its code, not permission to use Yandex imagery outside the official API. See the Yandex service terms before distribution.

Original plugin: ISC. Protocol reference: streetlevel, MIT; see THIRD_PARTY_NOTICES.md.

## Map coverage (editor update required)

The editor must provide the additive `PluginApi.addRasterOverlay({ attribution, minzoom, maxzoom, loadTile })` method, returning `{ setVisible(on) }`. Its implementation is in `src/view/plugin-raster.ts`; wiring is in `src/plugins.ts`. Older editor builds continue to show the viewer, with a console warning that coverage is unavailable.

One Yandex Panoramas DEV checkbox controls both street lines and aerial balloon icons (`l=stv,sta`). A click inside a balloon opens that exact aerial panorama (`l=sta`, `oid`); other map clicks search the nearest street panorama (`l=stv`). There are no navigation arrows between aerial panoramas. Their initial camera pitch follows Yandex's metadata. Buildings retain normal selection unless a balloon icon is explicitly clicked over them.

The editor's `onMapClick` context must include `zoom: map.getZoom()` (implemented in `src/plugins.ts`) to match icon footprints at the correct scale. The standalone test page uses map zoom 14 for its coordinate input. Exact aerial picking is unavailable in older hosts that do not supply a zoom.

Yandex's JS API 2.1 configuration publishes raster coverage tiles (`l=stv` and `l=sta`). The modern website also has vector coverage in Yandex's own protobuf format, which is not MVT; see [RESEARCH.md](RESEARCH.md) for verified endpoints and sample results. The plugin currently uses the raster overlay. `coverage.js` reads the current tile version from the bootstrap configuration **as text**, without executing it, caches the version for an hour and retries once on an expired version. It fetches coverage tiles with CORS and without credentials or an API key. The server's ellipsoidal Mercator (EPSG:3395) tiles are resampled into Web Mercator (EPSG:3857) before MapLibre displays them. Zooms above 19 overzoom the coverage. This is the provider's raster coverage, not an exhaustive vector point layer: it has no per-panorama date/type filtering or point attributes.

The overlay is restored after map style changes and removed, including its protocol handler, when the plugin is disabled. The current panorama's view cone still uses the existing editor API.

Verified: real metadata/imagery/coverage requests in browser; navigation by overlay arrow and map click; arrow rotation on dragging; coverage toggle; map style reload; TypeScript check and editor production build.

## Junction navigation

The navigation overlay supports any number of actual links, including side streets at junctions. It combines `Thoroughfares`, positioned `Connections`, and immediate neighbours from `Graph.Edges`, deduplicated by target panorama ID. Nearby graph nodes without a direct edge are excluded. Link names and bearings appear in tooltips; close directions are staggered on separate radii. No additional metadata requests are needed to find side links.

Test a real four-way junction in the standalone viewer at longitude `37.605167925`, latitude `55.7647611288`. Run regression tests with `node --test tests/navigation.test.mjs`.

## Orientation regression

The texture's left edge has azimuth `Data.EquirectangularProjection.Origin[0]` (`phiLeft` in the official player). Horizontal texture coordinates are `wrap((viewAzimuth - phiLeft) / 360)`. The view cone and navigation bearings remain north-based compass angles. Converting Origin into a centre heading introduces a capture-dependent rotation error.

With the local server running, open `/tests/orientation.html`. It exercises the actual WebGL renderer through `activate()` with a synthetic eight-sector panorama and eight different Origin values, reads GPU pixels and verifies that the cone stays north. The test uses local mock responses and makes no panorama requests.

## Balloon hit testing and dates

`coverage.js` loads the official `stj` hotspot JSON alongside visible coverage tiles. `HotspotMetaData.id` identifies the aerial panorama, and `RenderedGeometry` contains its clickable polygon in the provider's tile pixels. Hit testing uses the same ellipsoidal projection and rounded raster source zoom as the visible icons. A bounded cache allows balloon clicks to take priority over a building below the symbol. Responses are parsed as JSON, never executed. Empty image tiles are handled as transparent tiles.

The bottom-right date selector always includes the open panorama, displays its actual date, and sorts other captures from newest to oldest. Dates prefer explicit API timestamps and fall back to the ID's timestamp only when needed. Selecting an older capture keeps its date selected even when a newer image is available. Historical requests preserve the layer and `connectionsTimestamp`. A single available date is displayed with the selector disabled. Empty place names show “Open in Yandex Maps” rather than a raw internal ID.

Run all data-level regression tests with `node --test tests/*.test.mjs`.
