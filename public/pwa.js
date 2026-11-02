// Registers the service worker and offers "Install app" (Android / desktop) or the Add to Home Screen hint (iPhone).
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
(() => {
  const box = document.getElementById('pwa');
  if (!box) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const TEXT = {
    en: { install: 'Install this app', ios: 'To install: tap the Share button, then "Add to Home Screen".', done: 'Installed. Open it from your home screen.' },
    ur: { install: 'یہ ایپ انسٹال کریں', ios: 'انسٹال کرنے کے لیے: شیئر کا بٹن دبائیں، پھر «Add to Home Screen» چنیں۔', done: 'انسٹال ہو گئی۔ اسے ہوم اسکرین سے کھولیں۔' },
  };
  const lang = () => (document.documentElement.lang === 'ur' ? 'ur' : 'en');
  let deferred = null, installed = false;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const draw = () => {
    box.replaceChildren();
    if (installed) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = TEXT[lang()].done; box.append(p); box.hidden = false; return; }
    if (deferred) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = TEXT[lang()].install;
      b.addEventListener('click', async () => { const d = deferred; deferred = null; d.prompt(); await d.userChoice.catch(() => {}); draw(); });
      box.append(b); box.hidden = false;
    } else if (iOS) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = TEXT[lang()].ios; box.append(p); box.hidden = false; }
    else box.hidden = true;
  };
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; draw(); });
  addEventListener('appinstalled', () => { installed = true; deferred = null; draw(); });
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  draw();
})();
