/*
 * Embroidery Studio - storefront block
 * Original implementation. No framework, no theme-specific DOM assumptions.
 *
 * Structure:
 *   Core  - pure functions (pricing, validation, cart properties). Exported for tests.
 *   UI    - one controller per [data-es-root] block.
 */
(function (global) {
  'use strict';

  /* ======================================================================
   * Core (pure)
   * ==================================================================== */

  var CONFIG_VERSION = '3';
  var UPLOAD_TYPES = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp'};
  var MAX_UPLOAD_MB = 20;
  var ALLOWED_TEXT = /^[\p{L}\p{M}\p{N} .,'&()\-/]*$/u;

  function num(value, fallback) {
    var n = Number(value);
    return value === null || value === undefined || value === '' || !isFinite(n) || n < 0 ? fallback : n;
  }

  function option(config, key) {
    var o = (config && config.options && config.options[key]) || {};
    return {enabled: o.enabled === true, price: num(o.price, 0), compareAt: num(o.compareAt, 0)};
  }

  /** Which choices the customer can pick for this product. */
  function availableTypes(config) {
    return ['bundle', 'top', 'bottom'].filter(function (t) { return option(config, t).enabled; });
  }

  function logoAvailable(config) {
    return option(config, 'logo').enabled;
  }

  /** Display price for a configuration (the Cart Transform is authoritative). */
  function priceFor(state, config) {
    if (!state || !state.type) return 0;
    if (state.type === 'bundle') return option(config, 'bundle').price;
    if (state.type === 'bottom') return option(config, 'bottom').price;
    if (state.type === 'top') {
      var extra = logoAvailable(config) && (state.iconId || hasLogo(state)) ? option(config, 'logo').price : 0;
      return option(config, 'top').price + extra;
    }
    return 0;
  }

  function startingPrice(config) {
    var prices = availableTypes(config).map(function (t) { return option(config, t).price; });
    return prices.length ? Math.min.apply(null, prices) : 0;
  }

  function hasLogo(state) {
    return Boolean(state && state.logo && state.logo.url);
  }

  function makeMoney(currency, rate, locale) {
    var formatter = null;
    try {
      formatter = new Intl.NumberFormat(locale || undefined, {style: 'currency', currency: currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2});
    } catch (e) { formatter = null; }
    var r = Number(rate) > 0 ? Number(rate) : 1;
    return function (amount) {
      var value = Math.round(Number(amount || 0) * r * 100) / 100;
      return formatter ? formatter.format(value) : (currency || '') + ' ' + value.toFixed(2);
    };
  }

  function extensionOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /** Client-side file checks (the server re-validates, including magic bytes). */
  function validateFile(file, maxMb) {
    if (!file || !file.name) return 'Please choose a file.';
    if (!(file.size > 0)) return 'The file is empty.';
    var ext = extensionOf(file.name);
    var expected = UPLOAD_TYPES[ext];
    if (!expected) return 'Please upload a PNG, JPG, JPEG or WebP image.';
    var type = String(file.type || '').toLowerCase();
    if (type !== expected && !(expected === 'image/jpeg' && type === 'image/jpg')) return 'This file does not look like a valid ' + ext.toUpperCase() + ' image.';
    var limit = Math.min(MAX_UPLOAD_MB, Math.max(1, num(maxMb, 5)));
    if (file.size > limit * 1024 * 1024) return 'The logo must be ' + limit + ' MB or smaller.';
    return '';
  }

  function validateText(value, label, required, maxChars) {
    var text = String(value || '').trim();
    if (!text) return required ? 'Please enter ' + label.toLowerCase() + '.' : '';
    if (Array.from(text).length > maxChars) return label + ' must be ' + maxChars + ' characters or fewer.';
    if (!ALLOWED_TEXT.test(text)) return label + ' can only use letters, numbers, spaces and . , \' & ( ) - /';
    return '';
  }

  /** Returns {field: message} for everything that blocks confirmation. */
  function validateState(state, config, library) {
    var errors = {};
    if (!state || availableTypes(config).indexOf(state.type) === -1) {
      errors.type = 'Please choose an embroidery option.';
      return errors;
    }
    var required = config.requireName !== false;
    var max = Math.max(4, Math.min(40, num(config.maxChars, 22)));
    var top = state.type === 'top' || state.type === 'bundle';
    var bottom = state.type === 'bottom' || state.type === 'bundle';
    var e;
    if (top) {
      e = validateText(state.firstName, 'First name', required, max); if (e) errors.firstName = e;
      e = validateText(state.secondName, 'Second name / designation', false, max); if (e) errors.secondName = e;
    }
    if (bottom) {
      e = validateText(state.bottomName, 'Bottom name', required, max); if (e) errors.bottomName = e;
    }
    var colors = (library && library.colors) || [];
    if (colors.length && !colors.some(function (c) { return c.id === state.colorId; })) errors.color = 'Please choose a thread colour.';
    var fonts = (library && library.fonts) || [];
    if (fonts.length && !fonts.some(function (f) { return f.id === state.fontId; })) errors.font = 'Please choose a font.';
    if (top && state.iconId) {
      var icons = (library && library.icons) || [];
      if (!icons.some(function (i) { return i.id === state.iconId; })) errors.icon = 'Please choose an icon from the list.';
    }
    if (state.logo && state.logo.status === 'uploading') errors.logo = 'Please wait for your logo to finish uploading.';
    if (state.logo && state.logo.status === 'error') errors.logo = state.logo.error || 'Your logo could not be uploaded. Remove it or try again.';
    return errors;
  }

  function findById(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function typeLabel(type, library) {
    var o = library && library.options && library.options[type];
    return (o && o.label) || {bundle: 'Embroidery Bundle', top: 'Top Embroidery', bottom: 'Bottom Embroidery'}[type] || '';
  }

  /** Human-readable one-line summary (shown in cart/order as "Embroidery"). */
  function summaryText(state, library) {
    if (!state || !state.type) return '';
    var parts = [typeLabel(state.type, library)];
    var top = state.type !== 'bottom';
    var bottom = state.type !== 'top';
    if (top) {
      var topText = [state.firstName, state.secondName].map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' / ');
      if (topText) parts.push('Top: ' + topText);
    }
    if (bottom && String(state.bottomName || '').trim()) parts.push('Bottom: ' + String(state.bottomName).trim());
    var color = findById(library && library.colors, state.colorId);
    if (color) parts.push('Colour: ' + color.name);
    var font = findById(library && library.fonts, state.fontId);
    if (font) parts.push('Font: ' + font.name);
    if (top && hasLogo(state)) parts.push('Custom logo');
    else if (top && state.iconId) {
      var icon = findById(library && library.icons, state.iconId);
      if (icon) parts.push('Icon: ' + icon.name);
    }
    return parts.join(' \u00b7 ');
  }

  /**
   * Line-item properties for a confirmed configuration. Keys starting with
   * "_" are hidden by most themes and read by the Cart Transform; "Embroidery"
   * and "Embroidery logo" are shown to the customer in cart and order.
   * Empty values are omitted.
   */
  function buildProperties(state, config, library, variantId) {
    if (!state || !state.type) return {};
    var top = state.type !== 'bottom';
    var bottom = state.type !== 'top';
    var color = findById(library && library.colors, state.colorId);
    var font = findById(library && library.fonts, state.fontId);
    var icon = top && !hasLogo(state) ? findById(library && library.icons, state.iconId) : null;
    var firstName = top ? String(state.firstName || '').trim() : '';
    var secondName = top ? String(state.secondName || '').trim() : '';
    var props = {
      'Embroidery': summaryText(state, library),
      'Embroidery logo': top && hasLogo(state) ? state.logo.url : '',
      '_embroidery_enabled': 'true',
      '_embroidery_type': state.type,
      '_embroidery_top': top ? [firstName, secondName].filter(Boolean).join(' | ') : '',
      '_embroidery_bottom': bottom ? String(state.bottomName || '').trim() : '',
      '_embroidery_first_name': firstName,
      '_embroidery_second_name': secondName,
      '_embroidery_color': color ? color.name + ' (' + color.hex + ')' : '',
      '_embroidery_font': font ? font.name : '',
      '_embroidery_icon': icon ? icon.name : '',
      '_embroidery_logo': top && hasLogo(state) ? state.logo.url : '',
      '_embroidery_upload_id': top && hasLogo(state) ? String(state.logo.uploadId || '') : '',
      '_embroidery_positions': [top ? 'top:' + ((config.positions && config.positions.top) || '') : '', top && (icon || hasLogo(state)) ? 'icon:' + ((config.positions && config.positions.icon) || '') : '', bottom ? 'bottom:' + ((config.positions && config.positions.bottom) || '') : ''].filter(Boolean).join(','),
      '_embroidery_variant_id': variantId ? String(variantId) : '',
      '_embroidery_config_version': CONFIG_VERSION
    };
    Object.keys(props).forEach(function (k) { if (props[k] === '') delete props[k]; });
    return props;
  }

  /** Placement for a key, with per-product overrides. */
  function resolvePosition(key, config, library) {
    var o = config && config.positionOverrides && config.positionOverrides[key];
    var p = o || (library && library.positions && library.positions[key]);
    if (!p) return {x: 0.5, y: 0.35, width: 0.2, rotation: 0};
    return {x: num(p.x, 0.5), y: num(p.y, 0.35), width: Math.max(0.02, num(p.width, 0.2)), rotation: Number(p.rotation) || 0};
  }

  var Core = {
    availableTypes: availableTypes, priceFor: priceFor, startingPrice: startingPrice, makeMoney: makeMoney,
    validateFile: validateFile, validateText: validateText, validateState: validateState,
    buildProperties: buildProperties, summaryText: summaryText, resolvePosition: resolvePosition,
    CONFIG_VERSION: CONFIG_VERSION
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  /* ======================================================================
   * UI
   * ==================================================================== */

  // Several blocks on one page load this file more than once: run it once.
  if (global.EmbroideryStudio && global.EmbroideryStudio.init) {
    global.EmbroideryStudio.init();
    return;
  }

  var doc = global.document;
  var uid = 0;

  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === false || value === null || value === undefined) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (key === 'style') node.setAttribute('style', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    });
    return node;
  }

  function parseJson(node) {
    try { return JSON.parse(node.textContent || '{}') || {}; } catch (e) { return {}; }
  }

  function assetUrl(url, data) {
    if (typeof url !== 'string') return '';
    if (url.indexOf('asset:') === 0) return (data.assets && data.assets[url.slice(6)]) || '';
    return /^https:\/\//.test(url) || /^\/\//.test(url) ? url : '';
  }

  var loadedStylesheets = {};
  function loadFontStylesheet(href) {
    if (!href || loadedStylesheets[href] || !/^https:\/\//.test(href)) return;
    loadedStylesheets[href] = true;
    doc.head.appendChild(el('link', {rel: 'stylesheet', href: href}));
  }

  /** Finds the add-to-cart form this block belongs to, whatever the theme. */
  function findProductForm(root) {
    var scope = root.closest('.shopify-section, [id^="shopify-section"], section, main') || doc;
    var isCart = function (f) {
      return f instanceof HTMLFormElement &&
        ((f.getAttribute('action') || '').indexOf('/cart/add') !== -1 || Boolean(f.elements && f.elements.namedItem('id')));
    };
    var list = [root.closest('form')];
    var pf = root.closest('product-form');
    if (pf) list.push(pf.querySelector('form'));
    list = list.concat(Array.prototype.slice.call(scope.querySelectorAll('form[action*="/cart/add"]')));
    list = list.concat(Array.prototype.slice.call(scope.querySelectorAll('form')));
    list = list.concat(Array.prototype.slice.call(doc.querySelectorAll('form[action*="/cart/add"]')));
    var withId = list.filter(function (f) { return isCart(f) && f.elements.namedItem('id'); });
    return withId[0] || list.filter(isCart)[0] || null;
  }

  function currentVariantId(form) {
    if (!form) return '';
    var field = form.elements.namedItem('id');
    return field && field.value ? String(field.value) : '';
  }

  function Studio(root) {
    this.root = root;
    this.data = parseJson(root.querySelector('script[data-es-data]'));
    this.config = this.data.config || {};
    this.library = this.data.library || {};
    this.text = this.data.text || {};
    this.types = availableTypes(this.config);
    if (!this.types.length) return;

    var cur = global.Shopify && global.Shopify.currency;
    var currency = (cur && cur.active) || this.data.currency || 'USD';
    this.rate = Number(cur && cur.rate) > 0 ? Number(cur.rate) : 1;
    // money(): shop-currency amounts (embroidery prices) converted to the customer's currency.
    this.money = makeMoney(currency, this.rate, doc.documentElement.lang);
    // moneyRaw(): amounts already in the customer's currency (variant prices, cart totals).
    this.moneyRaw = makeMoney(currency, 1, doc.documentElement.lang);
    this.cartNote = null;
    this.maxMb = Math.min(MAX_UPLOAD_MB, Math.max(1, num(this.config.uploadMaxMb, num(this.library.uploadMaxMb, 5))));
    this.id = 'es' + (++uid);
    this.confirmed = null;
    this.skipped = false;
    this.step = 'choose';
    this.errors = {};
    this.draft = this.freshState('');
    this.opener = null;

    (this.library.fonts || []).forEach(function (f) { loadFontStylesheet(f.stylesheet); });
    this.renderCard();
    this.bindForm();
    root.setAttribute('data-es-ready', 'true');
  }

  /* ---------- Prices ---------- */

  /** Price of the currently selected variant, in the customer's currency, or null. */
  Studio.prototype.variantPrice = function () {
    var id = currentVariantId(findProductForm(this.root));
    var variants = this.data.variants || [];
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === id && variants[i].price !== null && variants[i].price !== undefined) return Number(variants[i].price) / 100;
    }
    return null;
  };

  /** Embroidery price converted to the customer's currency (same rounding as the Cart Transform). */
  Studio.prototype.embroideryAmount = function (state) {
    return Math.round(priceFor(state, this.config) * this.rate * 100) / 100;
  };

  /** Theme price elements for this product (Dawn-style first, then common patterns). */
  Studio.prototype.priceTargets = function () {
    var scope = this.root.closest('.shopify-section, [id^="shopify-section"], section, main') || doc;
    var custom = String(this.text.priceSelector || '').trim();
    var groups = custom ? [custom] : [
      '.price__regular .price-item--regular, .price__sale .price-item--sale',
      '[data-product-price]', '[data-price]', '.product__price .money', '.product__price',
      '.product-single__price', '.product-price', '.price .money', '.price-item--regular'
    ];
    var root = this.root;
    for (var g = 0; g < groups.length; g++) {
      var found;
      try { found = Array.prototype.slice.call(scope.querySelectorAll(groups[g])); } catch (e) { found = []; }
      found = found.filter(function (n) {
        return !root.contains(n) && !n.closest('s, del, .price__compare, [class*="compare"], .card, product-recommendations, [class*="recommend"], cart-drawer, .cart-drawer, .es-modal');
      });
      if (found.length) return found.slice(0, 4);
    }
    return [];
  };

  /**
   * Shows garment + embroidery on the theme's price while embroidery is
   * confirmed, and restores the theme's own price otherwise. Themes that
   * re-render the price on variant change are handled by calling this again.
   */
  Studio.prototype.updatePagePrice = function () {
    if (this.text.updatePrice === false) return;
    var self = this;
    var garment = this.variantPrice();
    var targets = this.priceTargets();
    targets.forEach(function (node) {
      var ours = node.getAttribute('data-es-price');
      if (!self.confirmed || garment === null) {
        if (ours !== null && node.textContent === ours) node.textContent = node.getAttribute('data-es-original') || '';
        node.removeAttribute('data-es-price');
        node.classList.remove('es-price-updated');
        return;
      }
      var text = self.moneyRaw(garment + self.embroideryAmount(self.confirmed));
      if (node.textContent === text) return;
      // Remember the theme's text only when it is the theme's (not ours).
      if (ours === null || node.textContent !== ours) node.setAttribute('data-es-original', node.textContent);
      node.setAttribute('data-es-price', text);
      node.textContent = text;
      node.classList.add('es-price-updated');
    });
  };

  /** After add to cart: read the cart, confirm the embroidery line, refresh the mini cart. */
  Studio.prototype.checkCart = function (variantId, attempt) {
    var self = this;
    var root = (global.Shopify && global.Shopify.routes && global.Shopify.routes.root) || '/';
    fetch(root + 'cart.js', {credentials: 'same-origin', headers: {Accept: 'application/json'}})
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = (cart && cart.items) || [];
        var item = null;
        for (var i = items.length - 1; i >= 0; i--) {
          var p = items[i].properties || {};
          if (p._embroidery_enabled === 'true' && String(items[i].variant_id || items[i].id) === String(variantId)) { item = items[i]; break; }
        }
        if (!item) {
          if (attempt < 2) setTimeout(function () { self.checkCart(variantId, attempt + 1); }, 1500);
          return;
        }
        var unit = Number(item.final_price) / 100;
        var garment = self.variantPrice();
        var expected = garment === null ? null : garment + self.embroideryAmount(self.confirmed || {type: (item.properties || {})._embroidery_type});
        self.cartNote = (self.text.addedMessage || 'Added to cart with embroidery') + ' \u00b7 ' + self.moneyRaw(unit) + ' each';
        self.renderCard();
        if (expected !== null && unit + 0.01 < expected) {
          console.warn('[Embroidery Studio] The cart line has no embroidery charge. Check that embroidery pricing (Cart Transform) is Active in the app and the add-on products are Active on the Online Store channel.');
        }
        // Ask themes that listen for these events to refresh their mini cart.
        ['cart:refresh', 'cart:build', 'cart:updated', 'theme:cart:reload'].forEach(function (name) {
          doc.dispatchEvent(new CustomEvent(name, {bubbles: true, detail: {source: 'embroidery-studio', cart: cart}}));
        });
      })
      .catch(function () { /* the theme still handles the add; nothing to show */ });
  };

  Studio.prototype.freshState = function (type) {
    var colors = this.library.colors || [];
    var fonts = this.library.fonts || [];
    return {type: type, firstName: '', secondName: '', bottomName: '', sameBottom: true,
      colorId: colors[0] ? colors[0].id : '', fontId: fonts[0] ? fonts[0].id : '', iconId: '', logo: null};
  };

  Studio.prototype.icons = function () {
    return (this.library.icons || []).filter(function (i) { return i.placement !== 'bottom'; });
  };

  /* ---------- Card ---------- */

  Studio.prototype.renderCard = function () {
    var self = this;
    var card = this.root.querySelector('[data-es-card]');
    card.innerHTML = '';
    var t = this.text;
    var desc = String(t.description || '').replace('[price]', this.money(startingPrice(this.config)));
    card.appendChild(el('div', {class: 'es-card__head'}, [
      el('span', {class: 'es-card__badge', 'aria-hidden': 'true'}, ['\u2726']),
      el('div', {}, [el('h3', {class: 'es-card__title', text: t.heading || 'Custom embroidery'}), el('p', {class: 'es-card__desc', text: desc})])
    ]));

    if (this.confirmed) {
      var c = this.confirmed;
      card.appendChild(el('div', {class: 'es-card__summary', role: 'status'}, [
        el('div', {class: 'es-card__summary-text'}, [
          el('strong', {text: typeLabel(c.type, this.library)}),
          el('span', {text: summaryText(c, this.library).split(' \u00b7 ').slice(1).join(' \u00b7 ')})
        ]),
        el('strong', {class: 'es-card__price', text: this.money(priceFor(c, this.config))})
      ]));
      var garment = this.variantPrice();
      if (garment !== null) {
        card.appendChild(el('p', {class: 'es-card__total', 'data-es-total': true}, [
          el('span', {text: (t.totalLabel || 'Total with embroidery') + ': '}),
          el('strong', {text: this.moneyRaw(garment + this.embroideryAmount(c))}),
          el('span', {class: 'es-card__total-split', text: ' (' + this.moneyRaw(garment) + ' + ' + this.moneyRaw(this.embroideryAmount(c)) + ')'})
        ]));
      }
      if (this.cartNote) card.appendChild(el('p', {class: 'es-card__added', role: 'status', text: '\u2713 ' + this.cartNote}));
      card.appendChild(el('div', {class: 'es-card__actions'}, [
        el('button', {type: 'button', class: 'es-btn es-btn--primary', onclick: function (e) { self.open(c.type, e.currentTarget); }}, [t.edit || 'Edit']),
        el('button', {type: 'button', class: 'es-btn es-btn--ghost', onclick: function () { self.remove(); }}, [t.remove || 'Remove'])
      ]));
    } else {
      card.appendChild(el('div', {class: 'es-card__actions'}, [
        el('button', {type: 'button', class: 'es-btn es-btn--primary', 'aria-haspopup': 'dialog', onclick: function (e) { self.open('', e.currentTarget); }}, [t.add || 'Add Embroidery']),
        el('button', {type: 'button', class: 'es-btn es-btn--ghost', 'aria-pressed': this.skipped ? 'true' : 'false', onclick: function () { self.skip(); }}, [t.skip || 'Skip for Now'])
      ]));
      if (this.skipped) card.appendChild(el('p', {class: 'es-card__note', role: 'status', text: t.skipped || 'No embroidery will be added.'}));
    }
  };

  /* ---------- Modal ---------- */

  Studio.prototype.open = function (type, opener) {
    this.opener = opener || doc.activeElement;
    this.errors = {};
    if (this.confirmed && (!type || type === this.confirmed.type)) {
      this.draft = JSON.parse(JSON.stringify(this.confirmed));
      this.step = 'edit';
    } else {
      this.draft = this.freshState(type || '');
      this.step = type ? 'edit' : (this.types.length === 1 ? 'edit' : 'choose');
      if (!this.draft.type && this.types.length === 1) this.draft.type = this.types[0];
    }
    this.buildModal();
    doc.documentElement.classList.add('es-lock');
    this.renderStep();
  };

  Studio.prototype.buildModal = function () {
    var self = this;
    if (this.modal) this.modal.remove();
    this.modal = el('div', {class: 'es-modal', style: this.root.getAttribute('style') || ''}, [
      el('div', {class: 'es-modal__backdrop', onclick: function () { self.close(); }}),
      el('div', {class: 'es-modal__dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': this.id + '-title', tabindex: '-1'})
    ]);
    this.dialog = this.modal.querySelector('.es-modal__dialog');
    this.modal.addEventListener('keydown', function (e) { self.onKeydown(e); });
    doc.body.appendChild(this.modal);
  };

  Studio.prototype.close = function () {
    if (!this.modal) return;
    this.revokeDraftLogo();
    this.modal.remove();
    this.modal = null;
    doc.documentElement.classList.remove('es-lock');
    if (this.opener && this.opener.isConnected) this.opener.focus();
    else {
      var btn = this.root.querySelector('.es-btn');
      if (btn) btn.focus();
    }
  };

  Studio.prototype.onKeydown = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.filter.call(
      this.dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; }
    );
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  Studio.prototype.renderStep = function (focusSelector) {
    var dialog = this.dialog;
    dialog.innerHTML = '';
    dialog.setAttribute('data-step', this.step);
    if (this.step === 'choose') this.renderChoose(dialog);
    else if (this.step === 'edit') this.renderEdit(dialog);
    else this.renderConfirm(dialog);
    var target = (focusSelector && dialog.querySelector(focusSelector)) || dialog.querySelector('[data-es-autofocus]') || dialog;
    target.focus();
  };

  Studio.prototype.header = function (title, backAction) {
    var self = this;
    return el('div', {class: 'es-head'}, [
      backAction ? el('button', {type: 'button', class: 'es-icon-btn', 'aria-label': 'Back', onclick: backAction}, ['\u2039']) : el('span'),
      el('h2', {id: this.id + '-title', class: 'es-head__title', text: title}),
      el('button', {type: 'button', class: 'es-icon-btn', 'aria-label': 'Close', onclick: function () { self.close(); }}, ['\u00d7'])
    ]);
  };

  /* Step 1: choose option */
  Studio.prototype.renderChoose = function (dialog) {
    var self = this;
    var lib = this.library;
    var list = el('div', {class: 'es-options', role: 'radiogroup', 'aria-label': 'Embroidery options'});
    this.types.forEach(function (type, index) {
      var o = option(self.config, type);
      var info = (lib.options && lib.options[type]) || {};
      var checked = self.draft.type === type;
      var extra = null;
      if (type === 'bundle') {
        var parts = [['top', 'Name + designation'], ['logo', 'Icon / logo'], ['bottom', 'Name on bottom']];
        var total = 0;
        var rows = parts.map(function (p) {
          var price = option(self.config, p[0]).price;
          total += price;
          return el('li', {}, [el('span', {text: p[1]}), el('span', {text: self.money(price)})]);
        });
        var compare = o.compareAt > o.price ? o.compareAt : total;
        extra = el('div', {class: 'es-bundle'}, [
          el('ul', {class: 'es-bundle__list'}, rows),
          compare > o.price ? el('p', {class: 'es-bundle__save'}, [
            el('s', {text: self.money(compare)}), ' ', el('strong', {text: self.money(o.price)}), ' ',
            el('span', {class: 'es-tag', text: 'Save ' + self.money(compare - o.price)})
          ]) : null
        ]);
      }
      var inputId = self.id + '-opt-' + type;
      list.appendChild(el('label', {class: 'es-option' + (checked ? ' is-selected' : ''), for: inputId}, [
        el('input', {type: 'radio', name: self.id + '-type', id: inputId, value: type, checked: checked, 'data-es-autofocus': index === 0 ? true : null,
          onchange: function () { self.draft.type = type; self.errors = {}; self.renderStep('#' + inputId); }}),
        el('span', {class: 'es-option__body'}, [
          el('span', {class: 'es-option__title'}, [el('strong', {text: info.label || typeLabel(type, lib)}), el('span', {class: 'es-option__price', text: self.money(o.price)})]),
          el('span', {class: 'es-option__desc', text: info.description || ''}),
          extra
        ])
      ]));
    });
    dialog.appendChild(this.header(this.text.chooseTitle || 'Choose your embroidery'));
    dialog.appendChild(el('div', {class: 'es-body es-body--narrow'}, [
      list,
      this.errors.type ? el('p', {class: 'es-error', role: 'alert', text: this.errors.type}) : null
    ]));
    dialog.appendChild(el('div', {class: 'es-foot'}, [
      el('button', {type: 'button', class: 'es-btn es-btn--ghost', onclick: function () { self.close(); }}, ['Cancel']),
      el('button', {type: 'button', class: 'es-btn es-btn--primary', onclick: function () {
        if (!self.draft.type) { self.errors = {type: 'Please choose an embroidery option.'}; self.renderStep(); return; }
        self.step = 'edit'; self.renderStep();
      }}, ['Continue'])
    ]));
  };

  /* Step 2: edit */
  Studio.prototype.renderEdit = function (dialog) {
    var self = this;
    var s = this.draft;
    var top = s.type !== 'bottom';
    var bottom = s.type !== 'top';
    var max = Math.max(4, Math.min(40, num(this.config.maxChars, 22)));
    var required = this.config.requireName !== false;
    var back = this.types.length > 1 && !this.confirmed ? function () { self.step = 'choose'; self.renderStep(); } : null;

    dialog.appendChild(this.header(typeLabel(s.type, this.library), back));
    var preview = el('div', {class: 'es-preview', 'aria-label': 'Live preview', role: 'img'});
    this.previewNode = preview;
    var form = el('div', {class: 'es-form'});

    function field(key, label, help, attrs) {
      var id = self.id + '-' + key;
      var error = self.errors[key];
      return el('div', {class: 'es-field' + (error ? ' has-error' : '')}, [
        el('label', {for: id, class: 'es-label'}, [label, required && attrs.required ? el('span', {class: 'es-req', 'aria-hidden': 'true'}, [' *']) : null]),
        el('input', {
          id: id, type: 'text', class: 'es-input', value: s[key] || '', maxlength: String(max), autocomplete: 'off', autocapitalize: 'words',
          'aria-invalid': error ? 'true' : 'false', 'aria-describedby': id + '-help' + (error ? ' ' + id + '-err' : ''),
          'data-es-autofocus': attrs.autofocus ? true : null, required: required && attrs.required ? true : null,
          oninput: function (e) {
            s[key] = e.target.value;
            if (key === 'firstName' && s.type === 'bundle' && s.sameBottom) s.bottomName = e.target.value;
            var counter = doc.getElementById(id + '-count');
            if (counter) counter.textContent = Array.from(e.target.value).length + '/' + max;
            self.updateLive();
          }
        }),
        el('div', {class: 'es-help', id: id + '-help'}, [el('span', {text: help}), el('span', {id: id + '-count', 'aria-live': 'polite', text: Array.from(s[key] || '').length + '/' + max})]),
        error ? el('p', {class: 'es-error', id: id + '-err', role: 'alert', text: error}) : null
      ]);
    }

    if (top) {
      form.appendChild(el('fieldset', {class: 'es-group'}, [
        el('legend', {text: 'Top embroidery text'}),
        field('firstName', 'First name', 'Line 1 on your top', {required: true, autofocus: true}),
        field('secondName', 'Second name / designation', 'Optional line 2, e.g. RN or Surgeon', {})
      ]));
    }
    if (bottom) {
      var group = el('fieldset', {class: 'es-group'}, [el('legend', {text: 'Bottom embroidery text'})]);
      if (s.type === 'bundle') {
        var sameId = this.id + '-same';
        group.appendChild(el('label', {class: 'es-check', for: sameId}, [
          el('input', {type: 'checkbox', id: sameId, checked: s.sameBottom, onchange: function (e) {
            s.sameBottom = e.target.checked;
            if (s.sameBottom) s.bottomName = s.firstName;
            self.renderStep('#' + sameId);
          }}),
          ' Same as first name'
        ]));
      }
      if (s.type !== 'bundle' || !s.sameBottom) group.appendChild(field('bottomName', 'Bottom name', 'Stitched on your bottom', {required: true, autofocus: !top}));
      else if (this.errors.bottomName) group.appendChild(el('p', {class: 'es-error', role: 'alert', text: this.errors.bottomName}));
      form.appendChild(group);
    }

    // Thread colour
    var colors = this.library.colors || [];
    if (colors.length) {
      var current = findById(colors, s.colorId);
      var swatches = el('div', {class: 'es-swatches', role: 'radiogroup', 'aria-label': 'Thread colour'});
      colors.forEach(function (c) {
        var id = self.id + '-color-' + c.id;
        swatches.appendChild(el('label', {class: 'es-swatch', for: id, title: c.name}, [
          el('input', {type: 'radio', name: self.id + '-color', id: id, checked: s.colorId === c.id, onchange: function () { s.colorId = c.id; self.renderStep('#' + id); }}),
          el('span', {class: 'es-swatch__dot', style: 'background:' + c.hex, 'aria-hidden': 'true'}),
          el('span', {class: 'es-sr', text: c.name})
        ]));
      });
      form.appendChild(el('fieldset', {class: 'es-group'}, [
        el('legend', {}, ['Thread colour ', el('span', {class: 'es-muted', text: current ? current.name : ''})]),
        swatches,
        this.errors.color ? el('p', {class: 'es-error', role: 'alert', text: this.errors.color}) : null
      ]));
    }

    // Font
    var fonts = this.library.fonts || [];
    if (fonts.length) {
      var fontList = el('div', {class: 'es-fonts', role: 'radiogroup', 'aria-label': 'Font'});
      fonts.forEach(function (f) {
        var id = self.id + '-font-' + f.id;
        fontList.appendChild(el('label', {class: 'es-chip' + (s.fontId === f.id ? ' is-selected' : ''), for: id}, [
          el('input', {type: 'radio', name: self.id + '-font', id: id, checked: s.fontId === f.id, onchange: function () { s.fontId = f.id; self.renderStep('#' + id); }}),
          el('span', {style: 'font-family:' + f.family, text: f.name})
        ]));
      });
      form.appendChild(el('fieldset', {class: 'es-group'}, [el('legend', {text: 'Font'}), fontList,
        this.errors.font ? el('p', {class: 'es-error', role: 'alert', text: this.errors.font}) : null]));
    }

    // Icon / logo
    if (top && logoAvailable(this.config)) {
      var icons = this.icons();
      var logoPrice = option(this.config, 'logo').price;
      var grid = el('div', {class: 'es-icons', role: 'radiogroup', 'aria-label': 'Icon'});
      var noneId = this.id + '-icon-none';
      grid.appendChild(el('label', {class: 'es-icon-tile' + (!s.iconId && !hasLogo(s) ? ' is-selected' : ''), for: noneId}, [
        el('input', {type: 'radio', name: this.id + '-icon', id: noneId, checked: !s.iconId && !s.logo, onchange: function () { s.iconId = ''; self.clearLogo(); self.renderStep('#' + noneId); }}),
        el('span', {class: 'es-icon-tile__none', text: 'None'})
      ]));
      icons.forEach(function (icon) {
        var id = self.id + '-icon-' + icon.id;
        var src = assetUrl(icon.image, self.data);
        grid.appendChild(el('label', {class: 'es-icon-tile' + (s.iconId === icon.id && !s.logo ? ' is-selected' : ''), for: id, title: icon.name}, [
          el('input', {type: 'radio', name: self.id + '-icon', id: id, checked: s.iconId === icon.id && !s.logo, onchange: function () { s.iconId = icon.id; self.clearLogo(); self.renderStep('#' + id); }}),
          el('span', {class: 'es-mask', style: '--es-mask:url("' + src.replace(/"/g, '') + '")', 'aria-hidden': 'true'}),
          el('span', {class: 'es-sr', text: icon.name})
        ]));
      });
      var priceNote = s.type === 'bundle' ? 'Included in bundle' : '+ ' + this.money(logoPrice);
      var fileId = this.id + '-logo';
      var logoBox = el('div', {class: 'es-logo'});
      if (s.logo) {
        logoBox.appendChild(el('div', {class: 'es-logo__row'}, [
          s.logo.previewUrl ? el('img', {src: s.logo.previewUrl, alt: 'Your logo', class: 'es-logo__thumb'}) : null,
          el('div', {class: 'es-logo__meta'}, [
            el('span', {class: 'es-logo__name', text: s.logo.name}),
            el('span', {class: 'es-logo__status', role: 'status', text: s.logo.status === 'uploading' ? 'Uploading\u2026' : s.logo.status === 'ready' ? 'Uploaded \u2713' : s.logo.status === 'error' ? 'Upload failed' : ''})
          ]),
          el('label', {class: 'es-btn es-btn--small es-btn--ghost', for: fileId}, ['Replace']),
          el('button', {type: 'button', class: 'es-btn es-btn--small es-btn--ghost', onclick: function () { self.clearLogo(); self.renderStep('#' + fileId); }}, ['Remove'])
        ]));
      } else {
        logoBox.appendChild(el('label', {class: 'es-upload', for: fileId}, [
          el('span', {'aria-hidden': 'true'}, ['\u2b06 ']), 'Upload your logo'
        ]));
      }
      logoBox.appendChild(el('input', {type: 'file', id: fileId, class: 'es-file', accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
        'aria-describedby': fileId + '-help', onchange: function (e) { self.onFile(e.target.files && e.target.files[0]); e.target.value = ''; }}));
      logoBox.appendChild(el('p', {class: 'es-help', id: fileId + '-help', text: 'PNG, JPG or WebP \u00b7 max ' + this.maxMb + ' MB'}));
      if (this.errors.logo) logoBox.appendChild(el('p', {class: 'es-error', role: 'alert', text: this.errors.logo}));

      form.appendChild(el('fieldset', {class: 'es-group'}, [
        el('legend', {}, ['Icon or logo ', el('span', {class: 'es-muted', text: '(optional \u00b7 ' + priceNote + ')'})]),
        grid,
        this.errors.icon ? el('p', {class: 'es-error', role: 'alert', text: this.errors.icon}) : null,
        el('p', {class: 'es-or', text: 'or'}),
        logoBox
      ]));
    }

    dialog.appendChild(el('div', {class: 'es-body es-body--split'}, [el('div', {class: 'es-body__preview'}, [preview]), form]));
    this.priceNode = el('strong', {class: 'es-foot__price', 'aria-live': 'polite'});
    dialog.appendChild(el('div', {class: 'es-foot'}, [
      this.priceNode,
      el('button', {type: 'button', class: 'es-btn es-btn--primary', onclick: function () { self.toConfirm(); }}, ['Continue'])
    ]));
    this.updateLive();
  };

  Studio.prototype.updateLive = function () {
    if (this.priceNode) this.priceNode.textContent = this.money(priceFor(this.draft, this.config));
    if (this.previewNode) this.renderPreview(this.previewNode, this.draft);
  };

  Studio.prototype.toConfirm = function () {
    this.errors = validateState(this.draft, this.config, this.library);
    if (Object.keys(this.errors).length) {
      this.renderStep('[aria-invalid="true"], .es-error');
      var firstError = this.dialog.querySelector('[aria-invalid="true"]');
      if (firstError) firstError.focus();
      return;
    }
    this.step = 'confirm';
    this.renderStep();
  };

  /* Step 3: confirm */
  Studio.prototype.renderConfirm = function (dialog) {
    var self = this;
    var s = this.draft;
    var t = this.text;
    var rows = [];
    var color = findById(this.library.colors, s.colorId);
    var font = findById(this.library.fonts, s.fontId);
    function row(label, value) { if (value) rows.push(el('div', {class: 'es-dl__row'}, [el('dt', {text: label}), el('dd', {text: value})])); }
    row('Embroidery', typeLabel(s.type, this.library));
    if (s.type !== 'bottom') { row('Name', s.firstName); row('Designation', s.secondName); }
    if (s.type !== 'top') row('Bottom text', s.bottomName);
    row('Colour', color && color.name);
    row('Font', font && font.name);
    if (s.type !== 'bottom') row('Icon / logo', hasLogo(s) ? 'Custom logo' : (findById(this.library.icons, s.iconId) || {}).name);
    row('Price', this.money(priceFor(s, this.config)));

    var ackId = this.id + '-ack';
    var needsAck = Boolean(t.requireAck);
    var previews = el('div', {class: 'es-confirm__previews'});
    if (s.type !== 'bottom') { var p1 = el('div', {class: 'es-preview', role: 'img', 'aria-label': 'Top preview'}); previews.appendChild(p1); this.renderPreview(p1, s, 'top'); }
    if (s.type !== 'top') { var p2 = el('div', {class: 'es-preview', role: 'img', 'aria-label': 'Bottom preview'}); previews.appendChild(p2); this.renderPreview(p2, s, 'bottom'); }

    dialog.appendChild(this.header(t.confirmTitle || "Here's your final personalised look!", function () { self.step = 'edit'; self.renderStep(); }));
    dialog.appendChild(el('div', {class: 'es-body es-body--split'}, [
      el('div', {class: 'es-body__preview'}, [previews]),
      el('div', {class: 'es-form'}, [
        el('dl', {class: 'es-dl'}, rows),
        t.delivery ? el('p', {class: 'es-notice', text: t.delivery}) : null,
        t.terms ? el('p', {class: 'es-notice es-notice--warn', text: t.terms}) : null,
        needsAck ? el('label', {class: 'es-check', for: ackId}, [el('input', {type: 'checkbox', id: ackId}), ' ', t.ackLabel || 'I understand']) : null,
        this.errors.ack ? el('p', {class: 'es-error', role: 'alert', text: this.errors.ack}) : null
      ])
    ]));
    dialog.appendChild(el('div', {class: 'es-foot'}, [
      el('button', {type: 'button', class: 'es-btn es-btn--ghost', onclick: function () { self.step = 'edit'; self.errors = {}; self.renderStep(); }}, [t.goBack || 'Go back']),
      el('button', {type: 'button', class: 'es-btn es-btn--primary', 'data-es-autofocus': true, onclick: function () {
        if (needsAck && !doc.getElementById(ackId).checked) { self.errors = {ack: 'Please confirm to continue.'}; self.renderStep('#' + ackId); return; }
        self.confirm();
      }}, [t.confirm || 'Confirm'])
    ]));
  };

  /* ---------- Preview ---------- */

  Studio.prototype.previewImage = function (area) {
    if (area === 'bottom' && this.config.bottomImage) return this.config.bottomImage;
    var form = findProductForm(this.root);
    var id = currentVariantId(form);
    var variants = this.data.variants || [];
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === id && variants[i].image) return variants[i].image;
    }
    return this.data.image || '';
  };

  Studio.prototype.renderPreview = function (node, s, forceArea) {
    var area = forceArea || (s.type === 'bottom' ? 'bottom' : 'top');
    var color = findById(this.library.colors, s.colorId);
    var font = findById(this.library.fonts, s.fontId);
    var ink = color ? color.hex : '#ffffff';
    var family = font ? font.family : 'inherit';
    var positions = this.config.positions || {};
    node.innerHTML = '';
    var src = this.previewImage(area);
    var stage = el('div', {class: 'es-stage'}, [src ? el('img', {src: src, alt: '', class: 'es-stage__img', draggable: 'false'}) : el('div', {class: 'es-stage__blank'})]);
    node.appendChild(stage);
    var self = this;

    function place(key) {
      var p = resolvePosition(key, self.config, self.library);
      return 'left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%;width:' + (p.width * 100) + '%;transform:translate(-50%,-50%) rotate(' + p.rotation + 'deg);';
    }
    function textLayer(key, lines) {
      var clean = lines.map(function (l) { return String(l || '').trim(); }).filter(Boolean);
      if (!clean.length) return;
      var layer = el('div', {class: 'es-layer es-layer--text', 'data-key': key, style: place(key) + 'color:' + ink + ';font-family:' + family});
      clean.forEach(function (line, i) { layer.appendChild(el('span', {class: i ? 'es-line es-line--sub' : 'es-line', text: line})); });
      stage.appendChild(layer);
    }

    if (area === 'top') {
      textLayer(positions.top || 'leftChest', [s.firstName, s.secondName]);
      var iconPos = positions.icon || 'rightChest';
      if (hasLogo(s) || (s.logo && s.logo.previewUrl)) {
        stage.appendChild(el('div', {class: 'es-layer es-layer--icon', style: place(iconPos)}, [el('img', {src: s.logo.previewUrl || s.logo.url, alt: '', class: 'es-layer__logo'})]));
      } else if (s.iconId) {
        var icon = findById(this.library.icons, s.iconId);
        if (icon) stage.appendChild(el('div', {class: 'es-layer es-layer--icon', style: place(iconPos)}, [
          el('span', {class: 'es-mask', style: '--es-mask:url("' + assetUrl(icon.image, this.data).replace(/"/g, '') + '");background:' + ink})
        ]));
      }
    } else {
      textLayer(positions.bottom || 'leftSide', [s.bottomName]);
    }
    fitText(stage);
  };

  /** Sizes each text layer relative to the rendered image width. */
  function fitText(stage) {
    var apply = function () {
      var width = stage.clientWidth || 300;
      Array.prototype.forEach.call(stage.querySelectorAll('.es-layer--text'), function (layer) {
        var boxWidth = (parseFloat(layer.style.width) / 100) * width;
        var longest = 1;
        Array.prototype.forEach.call(layer.children, function (c) { longest = Math.max(longest, Array.from(c.textContent).length); });
        var size = Math.max(7, Math.min(40, (boxWidth / Math.max(6, longest)) * 1.7));
        layer.style.fontSize = size.toFixed(1) + 'px';
      });
    };
    apply();
    if (global.requestAnimationFrame) global.requestAnimationFrame(apply);
    var img = stage.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', apply, {once: true});
  }

  /* ---------- Logo upload ---------- */

  Studio.prototype.revokeDraftLogo = function () {
    var d = this.draft && this.draft.logo;
    var c = this.confirmed && this.confirmed.logo;
    if (d && d.previewUrl && (!c || c.previewUrl !== d.previewUrl)) {
      try { URL.revokeObjectURL(d.previewUrl); } catch (e) { /* ignore */ }
    }
  };

  Studio.prototype.clearLogo = function () {
    this.revokeDraftLogo();
    this.draft.logo = null;
    this.uploadToken = null;
    delete this.errors.logo;
  };

  Studio.prototype.onFile = function (file) {
    var self = this;
    if (!file) return;
    var error = validateFile(file, this.maxMb);
    if (error) { this.errors.logo = error; this.renderStep('.es-upload, .es-logo button'); return; }
    this.clearLogo();
    var token = {};
    this.uploadToken = token;
    this.draft.iconId = '';
    this.draft.logo = {name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading', url: '', uploadId: ''};
    this.renderStep('.es-logo button');

    var body = new FormData();
    body.append('file', file, file.name);
    body.append('productId', 'gid://shopify/Product/' + (this.data.productId || ''));
    var endpoint = String(this.text.proxyPath || '/apps/embroidery-studio').replace(/\/$/, '') + '/upload';

    function finish(ok, payload) {
      if (self.uploadToken !== token || !self.draft.logo) return; // replaced or removed meanwhile
      if (ok) {
        self.draft.logo.status = 'ready';
        self.draft.logo.url = payload.url;
        self.draft.logo.uploadId = payload.uploadId;
        delete self.errors.logo;
      } else {
        self.draft.logo.status = 'error';
        self.draft.logo.error = (payload && payload.error) || 'Your logo could not be uploaded. Please try again.';
        self.errors.logo = self.draft.logo.error;
      }
      if (self.modal && self.step === 'edit') self.renderStep('.es-logo button');
    }

    function poll(uploadId, attempt) {
      if (attempt > 12) { finish(false, {error: 'Your logo is taking too long to process. Please try again.'}); return; }
      setTimeout(function () {
        fetch(endpoint + '?id=' + encodeURIComponent(uploadId), {credentials: 'same-origin', headers: {Accept: 'application/json'}})
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok && res.url) finish(true, {url: res.url, uploadId: uploadId});
            else if (res.ok) poll(uploadId, attempt + 1);
            else finish(false, res);
          })
          .catch(function () { poll(uploadId, attempt + 1); });
      }, 1500);
    }

    fetch(endpoint, {method: 'POST', body: body, credentials: 'same-origin', headers: {Accept: 'application/json'}})
      .then(function (r) {
        return r.json().catch(function () { return {ok: false, error: r.status === 404 ? 'Logo upload is not available on this store.' : 'Upload failed (' + r.status + ').'}; });
      })
      .then(function (res) {
        if (res.ok && res.url) finish(true, res);
        else if (res.ok && res.uploadId) poll(res.uploadId, 0);
        else finish(false, res);
      })
      .catch(function () { finish(false, {error: 'Network error while uploading. Please try again.'}); });
  };

  /* ---------- Confirm / skip / remove ---------- */

  Studio.prototype.confirm = function () {
    var errors = validateState(this.draft, this.config, this.library);
    if (Object.keys(errors).length) { this.errors = errors; this.step = 'edit'; this.renderStep(); return; }
    var form = findProductForm(this.root);
    if (!form) {
      this.errors = {ack: 'We could not find the add-to-cart form on this page. Please refresh and try again.'};
      this.renderStep();
      return;
    }
    if (this.confirmed && this.confirmed.logo && this.draft.logo !== this.confirmed.logo) {
      var old = this.confirmed.logo.previewUrl;
      if (old && (!this.draft.logo || this.draft.logo.previewUrl !== old)) { try { URL.revokeObjectURL(old); } catch (e) { /* ignore */ } }
    }
    this.confirmed = this.draft;
    this.draft = this.freshState('');
    this.skipped = false;
    this.inject();
    this.cartNote = null;
    this.modal.remove();
    this.modal = null;
    doc.documentElement.classList.remove('es-lock');
    this.renderCard();
    this.updatePagePrice();
    var edit = this.root.querySelector('.es-card__actions .es-btn');
    if (edit) edit.focus();
    this.root.dispatchEvent(new CustomEvent('embroidery:change', {bubbles: true, detail: {type: this.confirmed.type, price: priceFor(this.confirmed, this.config)}}));
  };

  Studio.prototype.skip = function () {
    this.confirmed = null;
    this.skipped = true;
    this.cartNote = null;
    this.inject();
    this.renderCard();
    this.updatePagePrice();
    this.root.dispatchEvent(new CustomEvent('embroidery:change', {bubbles: true, detail: {type: '', price: 0}}));
  };

  Studio.prototype.remove = function () {
    if (this.confirmed && this.confirmed.logo && this.confirmed.logo.previewUrl) {
      try { URL.revokeObjectURL(this.confirmed.logo.previewUrl); } catch (e) { /* ignore */ }
    }
    this.confirmed = null;
    this.skipped = false;
    this.cartNote = null;
    this.inject();
    this.renderCard();
    this.updatePagePrice();
    var add = this.root.querySelector('.es-card__actions .es-btn');
    if (add) add.focus();
    this.root.dispatchEvent(new CustomEvent('embroidery:change', {bubbles: true, detail: {type: '', price: 0}}));
  };

  /* ---------- Product form integration ---------- */

  /**
   * Writes the confirmed configuration into the product form as
   * properties[...] inputs, or removes every trace of it. Never touches the
   * form's variant input: the variant is read at submit time only.
   */
  Studio.prototype.inject = function () {
    var form = findProductForm(this.root);
    // Remove our inputs from wherever they are (a theme may have swapped forms).
    Array.prototype.forEach.call(doc.querySelectorAll('[data-es-injected="' + this.id + '"]'), function (n) { n.remove(); });
    this.form = form;
    if (!form || !this.confirmed) return;
    var props = buildProperties(this.confirmed, this.config, this.library, currentVariantId(form));
    var box = el('div', {'data-es-injected': this.id, hidden: true});
    Object.keys(props).forEach(function (key) {
      box.appendChild(el('input', {type: 'hidden', name: 'properties[' + key + ']', value: props[key]}));
    });
    form.appendChild(box);
  };

  Studio.prototype.injected = function () {
    return Boolean(this.form && this.form.querySelector('[data-es-injected="' + this.id + '"]'));
  };

  Studio.prototype.bindForm = function () {
    var self = this;
    // Re-validate and refresh right before any add-to-cart submission. Capture
    // phase runs before theme handlers, including AJAX product forms.
    var guard = function (event) {
      var form = event.type === 'submit' ? event.target : (event.target.closest && event.target.closest('form'));
      if (!(form instanceof HTMLFormElement)) {
        var btn = event.target.closest && event.target.closest('button[type="submit"],input[type="submit"],[name="add"]');
        form = btn && btn.form;
      }
      if (!form || form !== findProductForm(self.root)) return;
      if (event.type === 'click' && !(event.target.closest && event.target.closest('button[type="submit"],input[type="submit"],[name="add"]'))) return;
      if (self.confirmed) {
        var errors = validateState(self.confirmed, self.config, self.library);
        if (Object.keys(errors).length) {
          event.preventDefault();
          event.stopImmediatePropagation();
          self.open(self.confirmed.type, self.root.querySelector('.es-btn'));
          self.errors = errors;
          self.renderStep();
          return;
        }
      }
      self.inject(); // also refreshes _embroidery_variant_id from the current variant
      if (self.confirmed) {
        var now = Date.now();
        if (!self.lastAdd || now - self.lastAdd > 800) { // submit + click fire for one add
          self.lastAdd = now;
          var variantId = currentVariantId(form);
          setTimeout(function () { self.checkCart(variantId, 0); }, 1200);
        }
      }
    };
    doc.addEventListener('submit', guard, true);
    doc.addEventListener('click', guard, true);

    // Some themes re-render the product form on variant change; restore our inputs.
    if (global.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        if (pending || !self.confirmed) return;
        pending = true;
        (global.queueMicrotask || setTimeout)(function () {
          pending = false;
          if (!self.injected() || findProductForm(self.root) !== self.form) self.inject();
          self.updatePagePrice();
        });
      }).observe(this.root.closest('.shopify-section, main') || doc.body, {childList: true, subtree: true});
    }

    // Keep the preview on the selected variant's image.
    var refresh = function () {
      if (self.modal && self.previewNode && self.step === 'edit') self.updateLive();
      if (self.confirmed) { self.cartNote = null; self.renderCard(); self.updatePagePrice(); }
    };
    doc.addEventListener('change', function (e) {
      var form = findProductForm(self.root);
      if (form && e.target && (e.target.form === form || form.contains(e.target))) setTimeout(refresh, 50);
    });
    doc.addEventListener('variant:change', refresh);
  };

  function init() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-es-root]'), function (root) {
      if (root.__esStudio) return;
      root.__esStudio = new Studio(root);
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
  doc.addEventListener('shopify:section:load', init);
  global.EmbroideryStudio = {Core: Core, init: init};
})(typeof window !== 'undefined' ? window : globalThis);
