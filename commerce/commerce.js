(() => {
  'use strict';

  const REGISTRY_URL = '/commerce/products.json';
  const SAFE_CHECKOUT_HOSTS = new Set([
    'chromewebstore.google.com',
    'buy.polar.sh',
    'polar.sh',
    'www.polar.sh',
    'www.amazon.co.jp',
    'amazon.co.jp',
    'www.amazon.com',
    'amazon.com'
  ]);

  const GROUPS = ['available', 'coming', 'development'];

  function getLang() {
    const switcher = document.getElementById('langSwitch');
    return switcher && switcher.checked ? 'en' : 'ja';
  }

  function groupLabel(group, lang) {
    const labels = {
      available: { ja: '今買える', en: 'Available now' },
      coming: { ja: '近日', en: 'Coming soon' },
      development: { ja: '開発中', en: 'In development' }
    };
    return labels[group]?.[lang] || group;
  }

  function statusLabel(group, lang) {
    const labels = {
      available: { ja: '販売中', en: 'Available' },
      coming: { ja: '近日公開', en: 'Coming soon' },
      development: { ja: '開発中', en: 'In development' }
    };
    return labels[group]?.[lang] || '';
  }

  function isSafeCheckoutUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && SAFE_CHECKOUT_HOSTS.has(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function checkoutUrl(product, lang) {
    return lang === 'en'
      ? (product.checkout_url_en || product.checkout_url_ja || null)
      : (product.checkout_url_ja || product.checkout_url_en || null);
  }

  function localizedDetailUrl(value, lang) {
    if (!value) return null;
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return value;
    url.searchParams.set('lang', lang);
    return url.pathname + url.search + url.hash;
  }

  function createActions(product, lang) {
    const actions = document.createElement('div');
    actions.className = 'commerce-actions';

    if (product.group === 'available' && product.enabled === true) {
      const checkout = checkoutUrl(product, lang);
      if (isSafeCheckoutUrl(checkout)) {
        const buy = document.createElement('a');
        buy.className = 'commerce-cta';
        buy.href = checkout;
        buy.target = '_blank';
        buy.rel = 'noopener noreferrer';
        buy.textContent = lang === 'en' ? product.cta_en : product.cta_ja;
        actions.appendChild(buy);
      }
    }

    const detailUrl = localizedDetailUrl(product.detail_url, lang);
    if (detailUrl) {
      const details = document.createElement('a');
      details.className = 'commerce-secondary';
      details.href = detailUrl;
      details.textContent = lang === 'en' ? 'Details' : '詳しく見る';
      actions.appendChild(details);
    }

    if (!actions.childElementCount) {
      const pending = document.createElement('span');
      pending.className = 'commerce-cta commerce-cta-disabled';
      pending.setAttribute('aria-disabled', 'true');
      pending.textContent = statusLabel(product.group, lang);
      actions.appendChild(pending);
    }

    return actions;
  }

  function createCard(product, lang) {
    const card = document.createElement('article');
    card.className = 'commerce-card';

    const status = document.createElement('div');
    status.className = 'commerce-status';
    status.textContent = statusLabel(product.group, lang);

    const title = document.createElement('h3');
    title.textContent = product.name;

    const tagline = document.createElement('p');
    tagline.className = 'commerce-tagline';
    tagline.textContent = lang === 'en' ? product.tagline_en : product.tagline_ja;

    const price = document.createElement('div');
    price.className = 'commerce-price';
    price.textContent = lang === 'en' ? product.price_label_en : product.price_label_ja;

    card.append(status, title, tagline, price, createActions(product, lang));
    return card;
  }

  function render(registry) {
    const root = document.querySelector('[data-commerce-store]');
    if (!root) return;

    const lang = getLang();
    root.innerHTML = '';

    GROUPS.forEach((group) => {
      const products = registry.products.filter((product) => product.group === group);
      if (!products.length) return;

      const section = document.createElement('section');
      section.className = 'shelf-group';

      const heading = document.createElement('div');
      heading.className = 'shelf-heading';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = group.toUpperCase();

      const h2 = document.createElement('h2');
      h2.textContent = groupLabel(group, lang);

      heading.append(eyebrow, h2);

      const grid = document.createElement('div');
      grid.className = 'commerce-grid';
      products.forEach((product) => grid.appendChild(createCard(product, lang)));

      section.append(heading, grid);
      root.appendChild(section);
    });
  }

  let registryCache = null;

  async function load() {
    const root = document.querySelector('[data-commerce-store]');
    if (!root) return;

    try {
      if (!registryCache) {
        const response = await fetch(REGISTRY_URL, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('registry_http_' + response.status);
        registryCache = await response.json();
        if (!registryCache || !Array.isArray(registryCache.products)) throw new Error('registry_invalid');
      }
      render(registryCache);
    } catch (_) {
      root.innerHTML = '<p class="commerce-error">商品情報を確認できません。時間をおいて再度お試しください。 / Product information is temporarily unavailable.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  document.addEventListener('sca-language-change', load);
})();
