# Yandex Panoramas DEV

Experimental local fork of osm-simple3d-yandex-panoramas. Uses the internal Yandex panorama metadata and tile endpoints directly, without an API key or the Yandex JS API player. No Python or build step required.

## Run independently

```sh
cd /Users/felispimeja/github/osm-simple3d-yandex-panoramas-dev
python3 -m http.server 8766 --bind 127.0.0.1
```

Open http://127.0.0.1:8766/. Enter longitude and latitude. Drag to rotate, scroll to zoom. Buttons navigate to linked/nearby panoramas and historical captures. The page displays the view cone values that the plugin sends to the editor.

## Editor integration

`plugin.js` exports the same `activate(api)` interface as the original. For local testing, import it from the local server using the editor's plugin API; custom JSON plugins cannot execute JS modules. The production editor catalog is intentionally unchanged. The standalone page provides a small mock of that API.

## Implementation

- Metadata: `api-maps.yandex.ru/services/panoramas/1.x/`, `ll=longitude,latitude` or `oid=panoramaId`.
- Tiles: `pano.maps.yandex.net/{imageId}/{level}.{x}.{y}`.
- WebGL perspective viewer, maximum texture width 4096 or device limit. Cropped bottoms are padded rather than stretched.
- Six concurrent tile requests; navigation/close aborts pending downloads.
- Attribution and link to Yandex Maps remain visible. View direction and source marking use the editor API.

For development experiments only. Internal endpoints can change or refuse requests; browser access requires CORS on metadata and imagery. No proxy or credentials are used. The MIT license of streetlevel covers its code, not permission to use Yandex imagery outside the official API. See the Yandex service terms before distribution.

Original plugin: ISC. Protocol reference: streetlevel, MIT; see THIRD_PARTY_NOTICES.md.
