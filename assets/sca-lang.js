(() => {
  'use strict';

  const STORAGE_KEY = 'sca-lang';

  function isSupported(lang) {
    return lang === 'ja' || lang === 'en';
  }

  function readInitialLanguage() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('lang');
    if (isSupported(requested)) return requested;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isSupported(stored)) return stored;
    } catch (_) {}

    return 'ja';
  }

  function isInternalNavigableLink(link) {
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) {
      return false;
    }
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function rewriteInternalLinks(lang) {
    document.querySelectorAll('a[href]').forEach((link) => {
      if (!isInternalNavigableLink(link)) return;
      const url = new URL(link.getAttribute('href'), window.location.href);
      url.searchParams.set('lang', lang);
      link.href = url.pathname + url.search + url.hash;
    });
  }

  function applyLanguage(lang, updateCurrentUrl) {
    const switcher = document.getElementById('langSwitch');
    if (switcher) switcher.checked = lang === 'en';

    document.documentElement.lang = lang;

    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}

    rewriteInternalLinks(lang);

    if (updateCurrentUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    document.dispatchEvent(new CustomEvent('sca-language-change', { detail: { lang } }));
  }

  function init() {
    const switcher = document.getElementById('langSwitch');
    const initial = readInitialLanguage();
    applyLanguage(initial, false);

    if (switcher) {
      switcher.addEventListener('change', () => {
        applyLanguage(switcher.checked ? 'en' : 'ja', true);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
