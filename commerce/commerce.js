(() => {
  'use strict';

  const REGISTRY_URL = '/commerce/products.json';
  const SAFE_CHECKOUT_HOSTS = new Set([
    'chromewebstore.google.com',
    'polar.sh',
    'www.polar.sh',
    'buy.polar.sh'
  ]);

  function isSafeCheckoutUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === 'https:' && SAFE_CHECKOUT_HOSTS.has(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function getLang() {
    const switcher = document.getElementById('langSwitch');
    return switcher && switcher.checked ? 'en' : 'ja';
  }

  function buyLabel(lang) {
    return lang === 'en' ? 'Buy now' : '購入する';
  }

  function pendingLabel(lang) {
    return lang === 'en' ? 'Checkout pending' : '販売準備中';
  }

  function externalStoreLabel(lang) {
    return lang === 'en' ? 'Open official store' : '公式ストアで見る';
  }

  function providerDisclosure(product, lang) {
    if (product.checkout_provider === 'POLAR') {
      return lang === 'en'
        ? 'Payment is processed securely by Polar, the Merchant of Record.'
        : '決済はMerchant of RecordであるPolarが安全に処理します。';
    }
    if (product.checkout_provider === 'CHROME_WEB_STORE') {
      return lang === 'en'
        ? 'Installation and purchase are handled through the Chrome Web Store.'
        : '導入・購入はChrome Web Storeで行います。';
    }
    return '';
  }

  function createCta(product, lang) {
    const ready = product.enabled === true && isSafeCheckoutUrl(product.checkout_url);
    if (!ready) {
      const disabled = document.createElement('span');
      disabled.className = 'commerce-cta commerce-cta-disabled';
      disabled.setAttribute('aria-disabled', 'true');
      disabled.textContent = pendingLabel(lang);
      return disabled;
    }

    const link = document.createElement('a');
    link.className = 'commerce-cta';
    link.href = product.checkout_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = product.checkout_provider === 'CHROME_WEB_STORE'
      ? externalStoreLabel(lang)
      : buyLabel(lang);
    return link;
  }

  function renderStore(registry) {
    const root = document.querySelector('[data-commerce-store]');
    if (!root) return;

    const lang = getLang();
    root.innerHTML = '';

    registry.products.forEach((product) => {
      const card = document.createElement('article');
      card.className = 'commerce-card';

      const title = document.createElement('h3');
      title.textContent = product.name;

      const tagline = document.createElement('p');
      tagline.className = 'commerce-tagline';
      tagline.textContent = lang === 'en' ? product.tagline_en : product.tagline_ja;

      const price = document.createElement('div');
      price.className = 'commerce-price';
      price.textContent = lang === 'en' ? product.price_label_en : product.price_label_ja;

      const actions = document.createElement('div');
      actions.className = 'commerce-actions';

      const detail = document.createElement('a');
      detail.className = 'commerce-secondary';
      detail.href = product.detail_url;
      detail.textContent = lang === 'en' ? 'Details' : '詳しく見る';

      actions.appendChild(createCta(product, lang));
      actions.appendChild(detail);

      const disclosureText = providerDisclosure(product, lang);
      if (disclosureText) {
        const disclosure = document.createElement('p');
        disclosure.className = 'commerce-disclosure';
        disclosure.textContent = disclosureText;
        card.append(title, tagline, price, actions, disclosure);
      } else {
        card.append(title, tagline, price, actions);
      }

      root.appendChild(card);
    });
  }

  function hydrateProductPage(registry) {
    const nodes = document.querySelectorAll('[data-commerce-product]');
    if (!nodes.length) return;
    const lang = getLang();

    nodes.forEach((node) => {
      const id = node.getAttribute('data-commerce-product');
      const product = registry.products.find((item) => item.id === id);
      if (!product) return;

      const price = node.querySelector('[data-commerce-price]');
      const cta = node.querySelector('[data-commerce-cta]');
      const disclosure = node.querySelector('[data-commerce-disclosure]');

      if (price) price.textContent = lang === 'en' ? product.price_label_en : product.price_label_ja;
      if (cta) {
        cta.innerHTML = '';
        cta.appendChild(createCta(product, lang));
      }
      if (disclosure) disclosure.textContent = providerDisclosure(product, lang);
    });
  }

  async function load() {
    try {
      const response = await fetch(REGISTRY_URL, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`registry_http_${response.status}`);
      const registry = await response.json();
      if (!registry || !Array.isArray(registry.products)) throw new Error('registry_invalid');
      renderStore(registry);
      hydrateProductPage(registry);
    } catch (_) {
      // Fail closed: never invent or expose a purchase link when the registry cannot be trusted.
      document.querySelectorAll('[data-commerce-cta]').forEach((cta) => {
        cta.innerHTML = '<span class="commerce-cta commerce-cta-disabled" aria-disabled="true">販売準備中 / Checkout pending</span>';
      });
      const root = document.querySelector('[data-commerce-store]');
      if (root) {
        root.innerHTML = '<p class="commerce-error">購入情報を確認できません。時間をおいて再度お試しください。 / Checkout information is temporarily unavailable.</p>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  document.getElementById('langSwitch')?.addEventListener('change', load);
})();
