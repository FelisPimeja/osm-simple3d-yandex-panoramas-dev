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

/**
 * Each user enters their own Yandex Maps JS API key: the free plan gives 100 panorama requests a day per key,
 * so one shared key would run out at once. The key is kept only in this browser (localStorage).
 */
const KEY_STORE = 'osm3d.yandex-panoramas.key';
const getKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
const setKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* until reload */ } };
const KEYS_URL = 'https://developer.tech.yandex.ru/services';

const TEXT = {
  ru: {
    label: 'Яндекс Панорамы',
    title: 'Панорамы улиц Яндекса: включите и кликните по улице на карте',
    window: 'Яндекс Панорамы',
    loading: 'Ищу панораму…',
    none: 'Рядом нет панорамы. Кликните ближе к улице.',
    unsupported: 'Этот браузер не поддерживает плеер панорам Яндекса.',
    failed: 'Не удалось загрузить API Яндекс Карт.',
    keyIntro: 'Для панорам нужен ваш ключ API Яндекс Карт (бесплатно: 100 панорам в сутки). Ключ хранится только в этом браузере.',
    keySteps: ['Откройте кабинет разработчика Яндекса и войдите.', 'Подключите «JavaScript API и HTTP Геокодер» и получите ключ.', 'В настройках ключа ограничьте HTTP Referer: {origin}', 'Вставьте ключ сюда.'],
    keyLink: 'Кабинет разработчика',
    keyPlaceholder: 'Ключ API',
    keySave: 'Сохранить',
    keyChange: 'Сменить ключ',
    keyReload: 'Ключ сохранён. Чтобы применить новый ключ, перезагрузите страницу.',
    badKey: 'Яндекс не принял ключ или лимит на сегодня исчерпан.',
  },
  en: {
    label: 'Yandex Panoramas',
    title: 'Yandex street panoramas: enable and click a street on the map',
    window: 'Yandex Panoramas',
    loading: 'Looking for a panorama…',
    none: 'No panorama nearby. Click closer to a street.',
    unsupported: 'This browser does not support the Yandex panorama player.',
    failed: 'Could not load the Yandex Maps API.',
    keyIntro: 'Panoramas need your own Yandex Maps API key (free: 100 panoramas a day). The key is kept only in this browser.',
    keySteps: ['Open the Yandex developer console and sign in.', 'Connect “JavaScript API and HTTP Geocoder” and get a key.', 'In the key settings, restrict HTTP Referer to: {origin}', 'Paste the key here.'],
    keyLink: 'Developer console',
    keyPlaceholder: 'API key',
    keySave: 'Save',
    keyChange: 'Change key',
    keyReload: 'Key saved. Reload the page to use the new key.',
    badKey: 'Yandex rejected the key, or today’s limit is used up.',
  },
};

let ymapsPromise;
/** Key the API was loaded with: the script takes the key once, a new key needs a page reload. */
let loadedKey;
/** Load the Yandex Maps JS API 2.1 once (it is a classic script exposing window.ymaps). */
function loadYmaps(lang, key) {
  if (ymapsPromise && loadedKey !== key) return Promise.reject(new Error('reload'));
  loadedKey = key;
  if (!ymapsPromise) {
    ymapsPromise = new Promise((resolve, reject) => {
      if (window.ymaps) { window.ymaps.ready(() => resolve(window.ymaps)); return; }
      const s = document.createElement('script');
      const params = new URLSearchParams({ lang: lang === 'ru' ? 'ru_RU' : 'en_US', load: 'panorama.locate,panorama.Player,panorama.isSupported' });
      params.set('apikey', key);
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

  /** Key form in the window: steps, link, field. done() — key saved. */
  const keyForm = (done) => {
    if (!panel) return;
    say('');
    const box = document.createElement('div');
    box.className = 'yp-key';
    box.style.cssText = 'position:absolute;inset:0;overflow:auto;padding:12px 14px;background:#fff;z-index:2;font-size:12px;line-height:1.45';
    const p = document.createElement('p');
    p.style.margin = '0 0 6px';
    p.textContent = t.keyIntro;
    const ol = document.createElement('ol');
    ol.style.cssText = 'margin:0 0 8px;padding-left:18px';
    for (const step of t.keySteps) {
      const li = document.createElement('li');
      li.textContent = step.replace('{origin}', `${location.origin}/*`);
      ol.append(li);
    }
    const a = document.createElement('a');
    a.href = KEYS_URL; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = t.keyLink;
    a.style.color = '#2563eb';
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;gap:6px;margin-top:8px';
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = t.keyPlaceholder; input.value = getKey(); input.spellcheck = false;
    input.autocomplete = 'off';
    input.style.cssText = 'flex:1;min-width:0;font:inherit;padding:3px 6px';
    const btn = document.createElement('button');
    btn.type = 'submit'; btn.textContent = t.keySave;
    form.append(input, btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const k = input.value.trim();
      if (!/^[\w-]{20,64}$/.test(k)) { input.focus(); return; }
      setKey(k);
      box.remove();
      done(k);
    });
    box.append(p, ol, a, form);
    panel.body.append(box);
    input.focus();
  };

  /** Link in the corner of the window to change the key. */
  const keyButton = () => {
    if (!panel || panel.body.querySelector('.yp-change-key')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'yp-change-key'; b.textContent = t.keyChange;
    b.style.cssText = 'position:absolute;right:6px;bottom:6px;z-index:3;font-size:11px;padding:2px 6px;border:0;border-radius:4px;background:rgba(255,255,255,.85);cursor:pointer';
    b.addEventListener('click', () => keyForm(() => say(t.keyReload)));
    panel.body.append(b);
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
    const key = getKey();
    if (!key) { keyForm(() => void open(lngLat)); return; }
    keyButton();
    say(t.loading);
    let ymaps;
    try { ymaps = await loadYmaps(api.lang, key); } catch (err) { if (id === request) say(err?.message === 'reload' ? t.keyReload : t.failed); return; }
    if (id !== request) return;
    if (!ymaps.panorama.isSupported()) { say(t.unsupported); return; }
    let found;
    try { found = await ymaps.panorama.locate([lngLat[1], lngLat[0]]); } catch { if (id === request) say(t.badKey); return; }
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
