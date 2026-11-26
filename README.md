# Yandex Panoramas plugin for OSM Simple 3D Editor

An official plugin for [OSM Simple 3D Editor](https://github.com/FelisPimeja/osm-simple3d-editor). It shows Yandex street panoramas while you edit.

## Use

1. In the editor, open Personal settings → Plugins… and enable **Yandex Panoramas**.
2. In Map layers → Photos and panoramas, tick **Yandex Panoramas**.
3. Click a street on the map. Clicks on buildings still select them. The nearest panorama opens in a floating window, and the map shows the viewing direction.

## Licence and permission

- Yandex permitted using the panorama imagery to improve OpenStreetMap. The permission covers the photos only. It does not cover data Yandex draws over them, such as recognised house numbers. Map from what you see in the photos, not from Yandex labels.
- The Yandex Maps API terms do not allow showing panoramas outside the Yandex Maps API. That is why the plugin uses the official API 2.1 player and is not part of the editor core.
- When you open a panorama, the editor adds `streetlevel imagery` to `source` in the changeset.

## API key

The panorama service needs a Yandex Maps JS API key (`API_KEY` in `plugin.js`). Without one the plugin says so and shows nothing. Restrict the key by HTTP Referer to the editor domain in the Yandex developer console.

## Development

`plugin.js` is a plain ES module with no build step. It exports `activate(api)`. The plugin API is described in [docs/plugins.md](https://github.com/FelisPimeja/osm-simple3d-editor/blob/main/docs/plugins.md) of the editor.

The editor loads this module from jsDelivr, pinned to a full commit SHA in its official list (`src/plugins/catalog.json`). A new version reaches users only after the editor's catalog is updated to the new commit.

Licence: ISC, see [LICENSE](LICENSE).
