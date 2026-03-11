/**
 * Design Tokens — Canvas / CSS Sync Utility
 *
 * Reads CSS custom properties from the DOM and provides them as plain JS
 * values for Canvas rendering (sparklines, personality radar, memory graph).
 *
 * Also provides shared drawing helpers to keep Canvas rendering consistent
 * with the CSS design system.
 */

/* exported DesignTokens */
/* eslint-disable no-unused-vars */

var DesignTokens = (function () {
  'use strict';

  // ── Cached computed style ──────────────────────────────────────────

  var _cache = {};
  var _cacheValid = false;

  /**
   * Read a CSS custom property from the document root.
   * Results are cached per frame via invalidate().
   */
  function css(name) {
    if (_cacheValid && _cache[name] !== undefined) return _cache[name];
    var val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    _cache[name] = val;
    return val;
  }

  /** Invalidate the token cache (call on theme change). */
  function invalidate() {
    _cache = {};
    _cacheValid = false;
  }

  // Invalidate on theme change (observed via MutationObserver on <html>)
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'data-theme') {
        invalidate();
        break;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true });

  // ── Color helpers ──────────────────────────────────────────────────

  /** Get the current theme's palette as plain color strings. */
  function colors() {
    return {
      bgPrimary:     css('--bg-primary'),
      bgSecondary:   css('--bg-secondary'),
      bgTertiary:    css('--bg-tertiary'),
      surface:       css('--surface-solid'),
      border:        css('--border'),
      textPrimary:   css('--text-primary'),
      textSecondary: css('--text-secondary'),
      textMuted:     css('--text-muted'),
      accent:        css('--accent'),
      accentEnd:     css('--accent-end'),
      accentSubtle:  css('--accent-subtle'),
      green:         css('--green'),
      greenSubtle:   css('--green-subtle'),
      yellow:        css('--yellow'),
      yellowSubtle:  css('--yellow-subtle'),
      red:           css('--red'),
      redSubtle:     css('--red-subtle'),
      orange:        css('--orange'),
      blue:          css('--blue'),
      cyan:          css('--cyan'),
    };
  }

  /** Create a gradient from accent to accent-end. */
  function accentGradient(ctx, x0, y0, x1, y1) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, css('--accent'));
    g.addColorStop(1, css('--accent-end'));
    return g;
  }

  // ── Font helpers ───────────────────────────────────────────────────

  var FONT_BODY = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  var FONT_MONO = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

  function fontBody(size) {
    return (size || 13) + 'px ' + FONT_BODY;
  }
  function fontMono(size) {
    return (size || 12) + 'px ' + FONT_MONO;
  }

  // ── Canvas DPI scaling ─────────────────────────────────────────────

  /**
   * Set up a canvas for HiDPI rendering.
   * Returns { ctx, width, height } with logical pixel dimensions.
   */
  function setupCanvas(canvas, width, height) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx: ctx, width: width, height: height, dpr: dpr };
  }

  /**
   * Auto-size a canvas to fill its parent's width.
   * Returns { ctx, width, height }.
   */
  function autoSizeCanvas(canvas, heightOverride) {
    var parent = canvas.parentElement;
    if (!parent) return null;
    var rect = parent.getBoundingClientRect();
    var w = Math.floor(rect.width);
    var h = heightOverride || Math.floor(rect.height) || 40;
    return setupCanvas(canvas, w, h);
  }

  // ── Drawing Helpers ────────────────────────────────────────────────

  /**
   * Draw a sparkline chart.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number[]} data - Array of values.
   * @param {number} w - Canvas width (logical px).
   * @param {number} h - Canvas height (logical px).
   * @param {object} [opts] - { color, fillColor, lineWidth }
   */
  function drawSparkline(ctx, data, w, h, opts) {
    if (!data || data.length < 2) return;
    opts = opts || {};
    var color = opts.color || css('--accent');
    var fillColor = opts.fillColor || css('--accent-subtle');
    var lineWidth = opts.lineWidth || 1.5;

    var padding = 2;
    var drawW = w - padding * 2;
    var drawH = h - padding * 2;

    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var range = max - min || 1;

    var stepX = drawW / (data.length - 1);

    // Build path
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = padding + i * stepX;
      var y = padding + drawH - ((data[i] - min) / range) * drawH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Fill under curve with gradient fade
    ctx.lineTo(padding + (data.length - 1) * stepX, padding + drawH);
    ctx.lineTo(padding, padding + drawH);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padding, 0, padding + drawH);
    grad.addColorStop(0, fillColor);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /**
   * Draw a pentagon radar chart (for personality traits).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number[]} values - 5 values between 0 and 1.
   * @param {number} cx - Center X.
   * @param {number} cy - Center Y.
   * @param {number} r  - Radius.
   */
  function drawRadar(ctx, values, cx, cy, r) {
    if (!values || values.length < 5) return;
    var c = colors();
    var n = 5;
    var angleStep = (Math.PI * 2) / n;
    var startAngle = -Math.PI / 2; // Top

    // Draw grid rings
    for (var ring = 1; ring <= 4; ring++) {
      var ringR = (r * ring) / 4;
      ctx.beginPath();
      for (var j = 0; j < n; j++) {
        var angle = startAngle + j * angleStep;
        var px = cx + Math.cos(angle) * ringR;
        var py = cy + Math.sin(angle) * ringR;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw axes
    for (var k = 0; k < n; k++) {
      var axAngle = startAngle + k * angleStep;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(axAngle) * r, cy + Math.sin(axAngle) * r);
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw data polygon
    ctx.beginPath();
    for (var m = 0; m < n; m++) {
      var vAngle = startAngle + m * angleStep;
      var vr = r * Math.max(0.05, Math.min(1, values[m]));
      var vx = cx + Math.cos(vAngle) * vr;
      var vy = cy + Math.sin(vAngle) * vr;
      if (m === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();

    // Fill with subtle accent
    ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
    ctx.fill();

    // Stroke
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw value dots
    for (var d = 0; d < n; d++) {
      var dAngle = startAngle + d * angleStep;
      var dr = r * Math.max(0.05, Math.min(1, values[d]));
      var dx = cx + Math.cos(dAngle) * dr;
      var dy = cy + Math.sin(dAngle) * dr;
      ctx.beginPath();
      ctx.arc(dx, dy, 3, 0, Math.PI * 2);
      ctx.fillStyle = c.accent;
      ctx.fill();
      ctx.strokeStyle = c.bgSecondary;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /**
   * Animate a counter from 0 to target value with easing.
   * @param {HTMLElement} el - Element to update textContent.
   * @param {number} target - Target number.
   * @param {object} [opts] - { duration, prefix, suffix, decimals }
   */
  function animateCounter(el, target, opts) {
    opts = opts || {};
    var duration = opts.duration || 800;
    var prefix = opts.prefix || '';
    var suffix = opts.suffix || '';
    var decimals = opts.decimals || 0;
    var start = 0;
    var startTime = null;

    function easeOut(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(ts) {
      if (!startTime) startTime = ts;
      var elapsed = ts - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var value = start + (target - start) * easeOut(progress);
      el.textContent = prefix + value.toFixed(decimals) + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    css: css,
    invalidate: invalidate,
    colors: colors,
    accentGradient: accentGradient,
    fontBody: fontBody,
    fontMono: fontMono,
    setupCanvas: setupCanvas,
    autoSizeCanvas: autoSizeCanvas,
    drawSparkline: drawSparkline,
    drawRadar: drawRadar,
    animateCounter: animateCounter,
    FONT_BODY: FONT_BODY,
    FONT_MONO: FONT_MONO,
  };
})();
