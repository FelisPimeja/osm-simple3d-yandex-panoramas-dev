# Coverage and junction research (2026-11-26)

## Vector coverage does exist

The previous investigation only checked the JS API 2.1 raster configuration. The current Yandex Maps website publishes **both** `stvTileRenderer` (2.x) and `vector3StvTiles` (3.x).

Primary sources inspected:

- Configuration in https://yandex.ru/maps/?ll=37.6053%2C55.7646&z=17&l=map%2Cstv
- Client code: https://maps.yastatic.net/s3/front-maps-static/maps-front-maps/build/client/desktop/chunks/base/b88f0bbf06439a6ba337.yandex.ru.js

The client builds the following URLs:

```
https://vec00.core-stv-renderer.maps.yandex.net/2.x/tiles?l=sta,stv&x={x}&y={y}&z={z}&lang=ru_RU&v={version}&format=protobuf
https://vec00.core-stv-renderer.maps.yandex.net/3.x/tiles?l=sta,stv&x={x}&y={y}&z={z}&lang=ru_RU&v={version}&format=protobuf
```

For the actual sample x=19808, y=10252, z=15, version `2026.11.24.22.36-1_26.11.24-2-31630`, **both** returned HTTP 200, `Content-Type: application/x-protobuf`, `Access-Control-Allow-Origin: *`. The 2.x payload was 15,605 bytes, 3.x was 16,376 bytes.

These are Yandex's own vector encodings, not Mapbox Vector Tiles (MVT). A wire-format inspection found top-level fields 1, 2, 3, 8 in 2.x; 3.x starts with field 1 varint value 8 and fields 2–6. Standard MVT instead consists of repeated field 3 Layer messages. The Yandex client uses its own VECTOR3_TILE/vmap renderer. MapLibre cannot directly consume these payloads as an MVT source. Converting geometry into GeoJSON/MVT requires a decoder for the Yandex format and verification of coordinate transforms and attributes. Whether the payload contains selectable panorama IDs has not yet been established.

The current plugin therefore retains the already tested raster overlay; this research **does not establish that vector coverage is unavailable**, only that it is not a drop-in MVT source.

## Junctions

A real example is near Tverskaya / Tverskoy Boulevard, Moscow:

- Panorama `1298065387_673108382_23_1789378279`
- Position `37.605167925, 55.7647611288`
- Four `Annotation.Thoroughfares` with bearings approximately **64°, 315°, 133°, 237°**.
- Names include `Бульварное кольцо` and `Тверская улица`.
- `Annotation.Graph.Edges` contains four edges incident to the current node, each matching one of the four explicit links.

The preceding panorama (`1298066529_673109453_23_1789378279`) has only two direct links, while its larger graph already contains nearby four-way junctions. Thus neither “two arrows everywhere” nor “one arrow for every Graph.Nodes entry” is correct.

`navigation.js` now merges:

1. Explicit `Thoroughfares`, preferring the provided direction/name.
2. Explicit `Connections` with a target position.
3. Only graph edges incident to the node matching the current panorama ID (incoming and outgoing), deriving a bearing from coordinates as fallback.

Targets are deduplicated by panorama ID. Disconnected/indirect nearby nodes do not become arrows. There is no two-arrow limit. Close directions use different radii to keep fork targets clickable; every arrow keeps rotating relative to view yaw.

Regression tests use minimal extracts of real API responses under `tests/fixtures/` plus malformed/missing-field and incoming-edge cases:

```
node --test tests/navigation.test.mjs
```

## Image orientation correction

Inspected the official JS API implementation at https://yastatic.net/s3/front-maps-static/maps-front-jsapi-v2-1/2.1.79-21550599/out/release/full.js. The panorama adapter uses `EquirectangularProjection.Origin[0]` as the left angular bound (`phiLeft`). Its canvas renderer computes the image's horizontal position from the difference between camera direction and that left bound. This agrees with [IPanorama.getAngularBBox](https://yandex.com/dev/jsapi-v2-1/doc/en/v2-1/ref/reference/IPanorama), which describes the bounds as `[thetaTop, phiRight, thetaBottom, phiLeft]`.

The dev renderer had transformed Origin to `180 - Origin` and also added a half-turn in its UV mapping. Combined, these sampled `wrap((yaw + Origin) / 360)` rather than `wrap((yaw - Origin) / 360)`: an orientation-dependent error, appearing roughly 90 degrees for some captures. Removed both transformations; cone and arrow azimuths are unchanged. The GPU regression page verifies eight capture orientations, including negative values and the 360-degree seam.

## Aerial panoramas and precise balloon picking

Verified a real `l=sta` metadata request near `30.3158,59.9391`: panorama `1254584990_626344425_23_1308758582` (“Зимний дворец”), height 200 m. Raster coverage supports `l=stv,sta` and includes the same balloon icons shown on Yandex Maps.

The published JS API uses the separate interactive layer `stj`. A verified request is:

```
https://core-stv-renderer.maps.yandex.net/2.x/tiles?l=stj&x=9571&y=4778&z=14&format=js&v=2026.11.24.22.36-1_26.11.24-2-31630
```

Although the parameter says `format=js`, the response is JSON, with `data.features` holding `HotspotMetaData.id` and a `RenderedGeometry` polygon in tile-pixel coordinates. `geometry.coordinates` are latitude/longitude; the picker instead tests the rendered polygon directly, so it matches the visible icon rather than choosing an arbitrary nearest aerial photo. The fixture `tests/fixtures/air-hotspots.json` is a real response. Source zoom follows MapLibre RasterTileSource's roundZoom=true and 256px tile size.

Aerial navigation arrows are intentionally hidden. The shared street/aerial raster overlay and exact symbol picking replace a separate aerial checkbox. The footer date shows the displayed capture, which is not necessarily the newest capture; raw IDs are only retained in the target URL.
