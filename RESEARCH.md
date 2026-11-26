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
