/**
 * SpiralViz — Force-directed Memory Graph Visualization
 *
 * Renders SPARK's memory tokens as an interactive force-directed graph.
 * Nodes are sized by strength, colored by type, and positioned via a
 * spring-electrical simulation. Edges show weighted connections.
 *
 * Interaction: click to select, hover to highlight, scroll to zoom,
 * drag to pan, drag node to reposition.
 */

/* exported SpiralViz */
/* eslint-disable no-unused-vars */

var SpiralViz = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────

  var SIMULATION_ALPHA  = 1.0;
  var ALPHA_DECAY       = 0.005;
  var ALPHA_MIN         = 0.001;
  var VELOCITY_DECAY    = 0.4;

  // Force model tuning
  var REPULSION_STRENGTH = 800;
  var SPRING_STRENGTH    = 0.05;
  var SPRING_LENGTH      = 100;
  var CENTER_GRAVITY     = 0.01;

  // Visual
  var NODE_MIN_RADIUS   = 6;
  var NODE_MAX_RADIUS   = 22;
  var EDGE_MIN_WIDTH    = 0.4;
  var EDGE_MAX_WIDTH    = 2.5;
  var HOVER_GROW        = 4;
  var LABEL_DISTANCE    = 6;

  // Interaction
  var CLICK_RADIUS      = 12;
  var ZOOM_MIN          = 0.15;
  var ZOOM_MAX          = 5;
  var ZOOM_STEP         = 0.12;

  // Token type → color mapping (uses CSS custom properties via DesignTokens)
  var TYPE_COLORS = {
    conversation:      '--accent',
    episode:           '--green',
    insight:           '--yellow',
    belief:            '--orange',
    'cross-connector': '--cyan',
    composite:         '--red',
    reflection:        '--blue',
  };

  // Tier opacity multipliers
  var TIER_OPACITY = {
    raw:        1.0,
    recent:     0.85,
    compressed: 0.6,
    archival:   0.35,
  };

  // ── SpiralViz Class ───────────────────────────────────────────────

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts - { onSelectToken, onDeselectToken }
   */
  function SpiralViz(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = null;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;

    // Graph data
    this.nodes = [];     // { id, type, tier, strength, spiralCount, gist, topics, sentiment, x, y, vx, vy, radius, color, opacity, pinned }
    this.edges = [];     // { from, to, weight, type, fromNode, toNode }
    this.nodeIndex = {};  // id → node

    // Simulation state
    this.alpha = 0;
    this.running = false;
    this.rafId = null;

    // Camera / transform
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;

    // Interaction state
    this.hoveredNode = null;
    this.selectedNode = null;
    this.dragNode = null;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Filters
    this.typeFilter = null;      // null = show all, or Set of types
    this.minStrength = 0;

    // Callbacks
    this.onSelectToken = opts.onSelectToken || null;
    this.onDeselectToken = opts.onDeselectToken || null;

    // Bind event handlers
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp   = this._handleMouseUp.bind(this);
    this._onWheel     = this._handleWheel.bind(this);
    this._onDblClick  = this._handleDblClick.bind(this);
    this._onResize    = this._handleResize.bind(this);

    this._init();
  }

  // ── Initialization ────────────────────────────────────────────────

  SpiralViz.prototype._init = function () {
    this._setupCanvas();
    this._bindEvents();
  };

  SpiralViz.prototype._setupCanvas = function () {
    var rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.floor(rect.width) || 800;
    this.height = Math.floor(rect.height) || 500;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);
  };

  SpiralViz.prototype._bindEvents = function () {
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('mouseleave', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this._onDblClick);
    window.addEventListener('resize', this._onResize);
  };

  SpiralViz.prototype.destroy = function () {
    this.stop();
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mouseleave', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('dblclick', this._onDblClick);
    window.removeEventListener('resize', this._onResize);
  };

  // ── Data Loading ──────────────────────────────────────────────────

  /**
   * Load graph data from API response.
   * @param {{ tokens: Array, edges: Array }} data
   */
  SpiralViz.prototype.loadData = function (data) {
    if (!data || !data.tokens) return;

    var centerX = this.width / 2;
    var centerY = this.height / 2;
    var nodeCount = data.tokens.length;

    // Build nodes
    this.nodes = [];
    this.nodeIndex = {};

    for (var i = 0; i < data.tokens.length; i++) {
      var t = data.tokens[i];
      // Arrange initially in a spiral pattern for aesthetics
      var angle = i * 2.399963; // golden angle
      var dist = Math.sqrt(i + 1) * 20;
      var node = {
        id: t.id,
        type: t.type || 'conversation',
        tier: t.tier || 'recent',
        strength: t.strength || 0.5,
        spiralCount: t.spiralCount || 0,
        gist: t.gist || '',
        topics: t.topics || [],
        sentiment: t.sentiment || 'neutral',
        createdAt: t.createdAt || '',
        // Physics
        x: centerX + Math.cos(angle) * dist,
        y: centerY + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        // Visual (computed)
        radius: this._strengthToRadius(t.strength || 0.5),
        color: '',
        opacity: TIER_OPACITY[t.tier] || 0.6,
        // State
        pinned: false,
      };
      this.nodes.push(node);
      this.nodeIndex[node.id] = node;
    }

    // Build edges (only if both endpoints exist)
    this.edges = [];
    if (data.edges) {
      for (var j = 0; j < data.edges.length; j++) {
        var e = data.edges[j];
        var fromNode = this.nodeIndex[e.from];
        var toNode = this.nodeIndex[e.to];
        if (fromNode && toNode) {
          this.edges.push({
            from: e.from,
            to: e.to,
            weight: e.weight || 0.1,
            type: e.type || 'related',
            fromNode: fromNode,
            toNode: toNode,
          });
        }
      }
    }

    // Reset view
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.hoveredNode = null;
    this.selectedNode = null;

    // Start simulation
    this.alpha = SIMULATION_ALPHA;
    this.start();
  };

  SpiralViz.prototype._strengthToRadius = function (strength) {
    return NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * Math.max(0, Math.min(1, strength));
  };

  // ── Simulation ────────────────────────────────────────────────────

  SpiralViz.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this._tick();
  };

  SpiralViz.prototype.stop = function () {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  };

  SpiralViz.prototype._tick = function () {
    if (!this.running) return;

    if (this.alpha > ALPHA_MIN) {
      this._simulate();
      this.alpha = Math.max(ALPHA_MIN, this.alpha - ALPHA_DECAY);
    }

    this._render();

    this.rafId = requestAnimationFrame(this._tick.bind(this));
  };

  SpiralViz.prototype._simulate = function () {
    var nodes = this.nodes;
    var edges = this.edges;
    var n = nodes.length;
    var cx = this.width / 2;
    var cy = this.height / 2;

    // Apply forces
    for (var i = 0; i < n; i++) {
      var a = nodes[i];
      if (a.pinned) continue;

      // Center gravity
      a.vx += (cx - a.x) * CENTER_GRAVITY * this.alpha;
      a.vy += (cy - a.y) * CENTER_GRAVITY * this.alpha;

      // Repulsion (all pairs)
      for (var j = i + 1; j < n; j++) {
        var b = nodes[j];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var dist2 = dx * dx + dy * dy;
        if (dist2 < 1) dist2 = 1;
        var dist = Math.sqrt(dist2);
        var force = REPULSION_STRENGTH * this.alpha / dist2;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        if (!b.pinned) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Spring forces (along edges)
    for (var k = 0; k < edges.length; k++) {
      var edge = edges[k];
      var from = edge.fromNode;
      var to = edge.toNode;
      var edx = to.x - from.x;
      var edy = to.y - from.y;
      var eDist = Math.sqrt(edx * edx + edy * edy) || 1;
      var displacement = eDist - SPRING_LENGTH;
      var springF = SPRING_STRENGTH * displacement * this.alpha * (0.5 + edge.weight * 0.5);
      var sfx = (edx / eDist) * springF;
      var sfy = (edy / eDist) * springF;

      if (!from.pinned) {
        from.vx += sfx;
        from.vy += sfy;
      }
      if (!to.pinned) {
        to.vx -= sfx;
        to.vy -= sfy;
      }
    }

    // Integrate velocities
    for (var m = 0; m < n; m++) {
      var node = nodes[m];
      if (node.pinned) continue;
      node.vx *= VELOCITY_DECAY;
      node.vy *= VELOCITY_DECAY;
      node.x += node.vx;
      node.y += node.vy;
    }
  };

  // ── Rendering ─────────────────────────────────────────────────────

  SpiralViz.prototype._render = function () {
    var ctx = this.ctx;
    var w = this.width;
    var h = this.height;

    // Clear
    var c = DesignTokens.colors();
    ctx.fillStyle = c.bgPrimary;
    ctx.fillRect(0, 0, w, h);

    // Apply camera transform
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-w / 2 + this.offsetX, -h / 2 + this.offsetY);

    // Draw edges
    this._renderEdges(ctx, c);

    // Draw nodes
    this._renderNodes(ctx, c);

    // Draw labels for hovered/selected
    this._renderLabels(ctx, c);

    ctx.restore();

    // Draw HUD (not affected by camera)
    this._renderHUD(ctx, c);
  };

  SpiralViz.prototype._renderEdges = function (ctx, c) {
    var edges = this.edges;
    var selected = this.selectedNode;
    var hovered = this.hoveredNode;

    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var from = e.fromNode;
      var to = e.toNode;

      // Filter check
      if (!this._isVisible(from) || !this._isVisible(to)) continue;

      var isHighlighted = (selected && (from.id === selected.id || to.id === selected.id)) ||
                          (hovered && (from.id === hovered.id || to.id === hovered.id));

      var alpha = isHighlighted ? 0.6 : 0.12;
      var width = EDGE_MIN_WIDTH + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * e.weight;

      if (selected && !isHighlighted) alpha = 0.04;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = this._withAlpha(c.textMuted, alpha);
      ctx.lineWidth = isHighlighted ? width * 1.5 : width;
      ctx.stroke();
    }
  };

  SpiralViz.prototype._renderNodes = function (ctx, c) {
    var nodes = this.nodes;
    var selected = this.selectedNode;
    var hovered = this.hoveredNode;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!this._isVisible(node)) continue;

      var isSelected = selected && node.id === selected.id;
      var isHovered = hovered && node.id === hovered.id;
      var isConnected = this._isConnectedTo(node, selected) || this._isConnectedTo(node, hovered);
      var dimmed = (selected || hovered) && !isSelected && !isHovered && !isConnected;

      var radius = node.radius;
      if (isHovered || isSelected) radius += HOVER_GROW;

      var nodeColor = this._getNodeColor(node, c);
      var nodeAlpha = dimmed ? 0.15 : node.opacity;

      // Glow for selected/hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
        var glow = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, radius + 8);
        glow.addColorStop(0, this._withAlpha(nodeColor, 0.3));
        glow.addColorStop(1, this._withAlpha(nodeColor, 0));
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = this._withAlpha(nodeColor, nodeAlpha);
      ctx.fill();

      // Border
      ctx.strokeStyle = this._withAlpha(nodeColor, nodeAlpha * 0.8);
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.stroke();

      // Spiral count indicator (small dot in center for heavily reinforced)
      if (node.spiralCount > 5) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(2, radius * 0.25), 0, Math.PI * 2);
        ctx.fillStyle = this._withAlpha('#ffffff', nodeAlpha * 0.6);
        ctx.fill();
      }
    }
  };

  SpiralViz.prototype._renderLabels = function (ctx, c) {
    var targets = [];
    if (this.selectedNode) targets.push(this.selectedNode);
    if (this.hoveredNode && this.hoveredNode !== this.selectedNode) targets.push(this.hoveredNode);

    // Also label connected nodes when something is selected
    if (this.selectedNode) {
      for (var i = 0; i < this.edges.length; i++) {
        var e = this.edges[i];
        if (e.fromNode.id === this.selectedNode.id && this._isVisible(e.toNode)) targets.push(e.toNode);
        if (e.toNode.id === this.selectedNode.id && this._isVisible(e.fromNode)) targets.push(e.fromNode);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    var seen = {};
    for (var j = 0; j < targets.length; j++) {
      var node = targets[j];
      if (seen[node.id]) continue;
      seen[node.id] = true;

      var label = node.gist || node.type;
      if (label.length > 40) label = label.substring(0, 37) + '…';

      var ly = node.y + node.radius + LABEL_DISTANCE;
      var fontSize = node === this.selectedNode || node === this.hoveredNode ? 11 : 10;

      ctx.font = DesignTokens.fontBody(fontSize);
      var tw = ctx.measureText(label).width;

      // Background pill
      var px = 6;
      var py = 3;
      ctx.fillStyle = this._withAlpha(c.bgSecondary, 0.85);
      ctx.beginPath();
      this._roundRect(ctx, node.x - tw / 2 - px, ly - py, tw + px * 2, fontSize + py * 2, 4);
      ctx.fill();

      // Text
      ctx.fillStyle = c.textPrimary;
      ctx.fillText(label, node.x, ly);
    }
  };

  SpiralViz.prototype._renderHUD = function (ctx, c) {
    // Legend (bottom-right corner)
    var legendX = this.width - 16;
    var legendY = this.height - 16;
    var typeNames = ['conversation', 'episode', 'insight', 'belief', 'cross-connector', 'composite', 'reflection'];
    var displayNames = ['Conversation', 'Episode', 'Insight', 'Belief', 'Cross-Connector', 'Composite', 'Reflection'];

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = DesignTokens.fontBody(10);

    for (var i = typeNames.length - 1; i >= 0; i--) {
      var y = legendY - (typeNames.length - 1 - i) * 18;
      var typeColor = this._resolveTypeColor(typeNames[i], c);

      // Dot
      ctx.beginPath();
      ctx.arc(legendX - ctx.measureText(displayNames[i]).width - 12, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = typeColor;
      ctx.fill();

      // Text
      ctx.fillStyle = c.textMuted;
      ctx.fillText(displayNames[i], legendX, y);
    }

    // Zoom level indicator (bottom-left)
    ctx.textAlign = 'left';
    ctx.font = DesignTokens.fontMono(10);
    ctx.fillStyle = c.textMuted;
    ctx.fillText(Math.round(this.zoom * 100) + '%', 16, this.height - 16);

    // Node count (top-left)
    var visCount = 0;
    for (var j = 0; j < this.nodes.length; j++) {
      if (this._isVisible(this.nodes[j])) visCount++;
    }
    ctx.fillText(visCount + ' / ' + this.nodes.length + ' nodes', 16, 24);
  };

  // ── Helpers ───────────────────────────────────────────────────────

  SpiralViz.prototype._getNodeColor = function (node, c) {
    return this._resolveTypeColor(node.type, c);
  };

  SpiralViz.prototype._resolveTypeColor = function (type, c) {
    var cssVar = TYPE_COLORS[type] || '--accent';
    return DesignTokens.css(cssVar);
  };

  SpiralViz.prototype._withAlpha = function (color, alpha) {
    // Convert hex or named color to rgba
    if (color.charAt(0) === '#') {
      var r = parseInt(color.slice(1, 3), 16);
      var g = parseInt(color.slice(3, 5), 16);
      var b = parseInt(color.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    if (color.indexOf('rgb') === 0) {
      // Already rgb/rgba — extract components
      var match = color.match(/[\d.]+/g);
      if (match && match.length >= 3) {
        return 'rgba(' + match[0] + ',' + match[1] + ',' + match[2] + ',' + alpha + ')';
      }
    }
    return color;
  };

  SpiralViz.prototype._roundRect = function (ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  };

  SpiralViz.prototype._isVisible = function (node) {
    if (this.typeFilter && !this.typeFilter.has(node.type)) return false;
    if (node.strength < this.minStrength) return false;
    return true;
  };

  SpiralViz.prototype._isConnectedTo = function (node, target) {
    if (!target) return false;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if ((e.fromNode === node && e.toNode === target) ||
          (e.toNode === node && e.fromNode === target)) {
        return true;
      }
    }
    return false;
  };

  SpiralViz.prototype._getConnectedNodes = function (target) {
    var connected = [];
    if (!target) return connected;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.fromNode.id === target.id) connected.push(e.toNode);
      if (e.toNode.id === target.id) connected.push(e.fromNode);
    }
    return connected;
  };

  // ── Coordinate Transform ──────────────────────────────────────────

  /** Convert screen coordinates to world coordinates. */
  SpiralViz.prototype._screenToWorld = function (sx, sy) {
    var hw = this.width / 2;
    var hh = this.height / 2;
    return {
      x: (sx - hw) / this.zoom + hw - this.offsetX,
      y: (sy - hh) / this.zoom + hh - this.offsetY,
    };
  };

  /** Find the node under a world coordinate. */
  SpiralViz.prototype._hitTest = function (wx, wy) {
    // Search in reverse (topmost drawn last)
    for (var i = this.nodes.length - 1; i >= 0; i--) {
      var n = this.nodes[i];
      if (!this._isVisible(n)) continue;
      var dx = wx - n.x;
      var dy = wy - n.y;
      var hitR = n.radius + CLICK_RADIUS / this.zoom;
      if (dx * dx + dy * dy <= hitR * hitR) return n;
    }
    return null;
  };

  // ── Event Handlers ────────────────────────────────────────────────

  SpiralViz.prototype._handleMouseDown = function (e) {
    e.preventDefault();
    var rect = this.canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    var world = this._screenToWorld(sx, sy);

    this.lastMouseX = sx;
    this.lastMouseY = sy;

    var hit = this._hitTest(world.x, world.y);

    if (hit) {
      this.dragNode = hit;
      hit.pinned = true;
      // Restart simulation slightly to adjust layout
      if (this.alpha < 0.05) this.alpha = 0.05;
    } else {
      this.isPanning = true;
    }
  };

  SpiralViz.prototype._handleMouseMove = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;

    if (this.dragNode) {
      var world = this._screenToWorld(sx, sy);
      this.dragNode.x = world.x;
      this.dragNode.y = world.y;
      this.dragNode.vx = 0;
      this.dragNode.vy = 0;
    } else if (this.isPanning) {
      var dx = sx - this.lastMouseX;
      var dy = sy - this.lastMouseY;
      this.offsetX += dx / this.zoom;
      this.offsetY += dy / this.zoom;
    } else {
      // Hover detection
      var w = this._screenToWorld(sx, sy);
      var prev = this.hoveredNode;
      this.hoveredNode = this._hitTest(w.x, w.y);
      if (this.hoveredNode !== prev) {
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
      }
    }

    this.lastMouseX = sx;
    this.lastMouseY = sy;
  };

  SpiralViz.prototype._handleMouseUp = function (e) {
    if (this.dragNode) {
      // If it was just a click (not a drag), select/deselect
      var rect = this.canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;
      var movedDist = Math.abs(sx - this.lastMouseX) + Math.abs(sy - this.lastMouseY);

      // Release pin unless we want to keep it positioned
      this.dragNode.pinned = false;

      // Treat as click if mouse didn't move much from the mousedown
      if (!this.isPanning) {
        this._handleNodeClick(this.dragNode);
      }

      this.dragNode = null;
    }
    this.isPanning = false;
  };

  SpiralViz.prototype._handleNodeClick = function (node) {
    if (this.selectedNode === node) {
      // Deselect
      this.selectedNode = null;
      if (this.onDeselectToken) this.onDeselectToken();
    } else {
      this.selectedNode = node;
      if (this.onSelectToken) this.onSelectToken(node);
    }
  };

  SpiralViz.prototype._handleWheel = function (e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * (1 + delta)));
  };

  SpiralViz.prototype._handleDblClick = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    var world = this._screenToWorld(sx, sy);

    var hit = this._hitTest(world.x, world.y);
    if (hit) {
      // Center on node
      this.offsetX = this.width / 2 - hit.x;
      this.offsetY = this.height / 2 - hit.y;
      this.zoom = Math.min(ZOOM_MAX, this.zoom * 1.5);
    }
  };

  SpiralViz.prototype._handleResize = function () {
    this._setupCanvas();
  };

  // ── Public API ────────────────────────────────────────────────────

  /** Set type filter (null = all, or array of type strings). */
  SpiralViz.prototype.setTypeFilter = function (types) {
    if (!types || types.length === 0) {
      this.typeFilter = null;
    } else {
      this.typeFilter = new Set(types);
    }
  };

  /** Set minimum strength filter. */
  SpiralViz.prototype.setMinStrength = function (val) {
    this.minStrength = val || 0;
  };

  /** Zoom in by one step. */
  SpiralViz.prototype.zoomIn = function () {
    this.zoom = Math.min(ZOOM_MAX, this.zoom * (1 + ZOOM_STEP));
  };

  /** Zoom out by one step. */
  SpiralViz.prototype.zoomOut = function () {
    this.zoom = Math.max(ZOOM_MIN, this.zoom * (1 - ZOOM_STEP));
  };

  /** Reset view to default zoom and center. */
  SpiralViz.prototype.resetView = function () {
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.selectedNode = null;
    this.hoveredNode = null;
    if (this.onDeselectToken) this.onDeselectToken();
  };

  /** Reheat the simulation (re-run layout). */
  SpiralViz.prototype.reheat = function () {
    this.alpha = SIMULATION_ALPHA * 0.5;
    if (!this.running) this.start();
  };

  /** Get the currently selected node. */
  SpiralViz.prototype.getSelectedNode = function () {
    return this.selectedNode;
  };

  /** Get graph stats. */
  SpiralViz.prototype.getStats = function () {
    var vis = 0;
    for (var i = 0; i < this.nodes.length; i++) {
      if (this._isVisible(this.nodes[i])) vis++;
    }
    return {
      totalNodes: this.nodes.length,
      visibleNodes: vis,
      totalEdges: this.edges.length,
    };
  };

  return SpiralViz;
})();
