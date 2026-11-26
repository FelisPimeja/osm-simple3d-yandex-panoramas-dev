/**
 * Yandex Panoramas plugin for OSM Simple 3D Editor (https://github.com/FelisPimeja/osm-simple3d-editor).
 *
 * Shows Yandex street panoramas through the Yandex Maps JS API 2.1 player (the API terms do not allow showing
 * panoramas outside the Yandex Maps API). Yandex permitted using the panorama imagery to improve OSM; this does
 * not cover data Yandex draws over the imagery (e.g. recognised house numbers).
 *
 * Usage: enable "Yandex Panoramas" in Map layers → Photos and panoramas, then click a street on the map
 * (clicks on buildings still select them). The nearest panorama opens in a floating window; the map shows
 * the viewing direction.
 *
 * Plugin API: docs/plugins.md in the editor repository.
 */

/** Yandex Maps JS API key. Restrict it by HTTP Referer to the editor domain in the Yandex developer console. */
const API_KEY = '';

const TEXT = {
  ru: {
    label: 'Яндекс Панорамы',
    title: 'Панорамы улиц Яндекса: включите и кликните по улице на карте',
    window: 'Яндекс Панорамы',
    loading: 'Ищу панораму…',
    none: 'Рядом нет панорамы. Кликните ближе к улице.',
    unsupported: 'Этот браузер не поддерживает плеер панорам Яндекса.',
    failed: 'Не удалось загрузить API Яндекс Карт.',
    noKey: 'В плагине не задан ключ API Яндекс Карт — панорамы недоступны.',
  },
  en: {
    label: 'Yandex Panoramas',
    title: 'Yandex street panoramas: enable and click a street on the map',
    window: 'Yandex Panoramas',
    loading: 'Looking for a panorama…',
    none: 'No panorama nearby. Click closer to a street.',
    unsupported: 'This browser does not support the Yandex panorama player.',
    failed: 'Could not load the Yandex Maps API.',
    noKey: 'The plugin has no Yandex Maps API key, so panoramas are unavailable.',
  },
};

let ymapsPromise;
/** Load the Yandex Maps JS API 2.1 once (it is a classic script exposing window.ymaps). */
function loadYmaps(lang) {
  if (!ymapsPromise) {
    ymapsPromise = new Promise((resolve, reject) => {
      if (window.ymaps) { window.ymaps.ready(() => resolve(window.ymaps)); return; }
      const s = document.createElement('script');
      const params = new URLSearchParams({ lang: lang === 'ru' ? 'ru_RU' : 'en_US', load: 'panorama.locate,panorama.Player,panorama.isSupported' });
      if (API_KEY) params.set('apikey', API_KEY);
      s.src = `https://api-maps.yandex.ru/2.1/?${params}`;
      s.async = true;
      s.onload = () => window.ymaps.ready(() => resolve(window.ymaps), reject);
      s.onerror = () => { ymapsPromise = undefined; reject(new Error('ymaps')); };
      document.head.append(s);
    });
  }
  return ymapsPromise;
}

export function activate(api) {
  const t = TEXT[api.lang] ?? TEXT.en;
  let on = false;
  let panel, player, message, request = 0;

  const close = () => {
    request++;
    player?.destroy();
    player = undefined;
    panel?.close();
    panel = undefined;
    api.setViewCone();
  };

  const say = (text) => {
    if (!panel) return;
    message ??= Object.assign(document.createElement('div'), { className: 'yp-message' });
    message.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:#555;background:#fff;z-index:1';
    message.textContent = text;
    message.hidden = !text;
    if (!message.isConnected) panel.body.append(message);
  };

  /** Map cone from the player: position, direction and horizontal span. */
  const syncCone = () => {
    if (!player) return;
    const pos = player.getPanorama().getPosition(); // [lat, lon, height]
    const [bearing] = player.getDirection();
    const [span] = player.getSpan();
    api.setViewCone({ lngLat: [pos[1], pos[0]], azimuth: bearing, fov: span });
  };

  async function open(lngLat) {
    const id = ++request;
    if (!panel) {
      panel = api.openPanel(t.window);
      panel.onClose(() => { if (panel) { panel = undefined; close(); } });
      message = undefined;
    }
    if (!API_KEY) { say(t.noKey); return; }
    say(t.loading);
    let ymaps;
    try { ymaps = await loadYmaps(api.lang); } catch { if (id === request) say(t.failed); return; }
    if (id !== request) return;
    if (!ymaps.panorama.isSupported()) { say(t.unsupported); return; }
    let found;
    try { found = await ymaps.panorama.locate([lngLat[1], lngLat[0]]); } catch { found = []; }
    if (id !== request || !panel) return;
    if (!found.length) { say(t.none); return; }
    say('');
    api.markUsed('street', 'Yandex Panoramas');
    if (player) {
      // Keep the viewing direction when moving to another panorama
      await player.setPanorama(found[0]);
    } else {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0';
      panel.body.append(host);
      player = new ymaps.panorama.Player(host, found[0], { controls: ['zoomControl'], suppressMapOpenBlock: false });
      player.events.add(['directionchange', 'spanchange', 'panoramachange'], syncCone);
    }
    syncCone();
  }

  api.addPhotoToggle('panoramas', t.label, t.title, (v) => {
    on = v;
    if (!v) close();
  });

  api.onMapClick((lngLat, { onObject }) => {
    if (!on || onObject) return false;
    void open(lngLat);
    return true;
  });

  return close;
}
