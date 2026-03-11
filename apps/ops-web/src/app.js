/**
 * AI Operations OS — Application
 *
 * Complete rewrite with sidebar-based navigation, hash router,
 * immersive SPARK chat, dashboard with sparklines and personality radar,
 * keyboard shortcuts, and all existing functionality preserved.
 *
 * Architecture:
 *   1. Configuration & state
 *   2. API client (unified, with auth)
 *   3. Theme management
 *   4. Router (hash-based + keyboard shortcuts)
 *   5. Toast notification system
 *   6. Skeleton loading
 *   7. Auth / Login
 *   8. Dashboard page
 *   9. SPARK Chat page
 *  10. Tasks & Approvals page
 *  11. Connectors page
 *  12. Modals
 *  13. SSE (real-time approvals)
 *  14. Auto-refresh
 *  15. Init
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // 1. Configuration & State
  // ═══════════════════════════════════════════════════════════════════

  var API_BASE = window.OPS_API_BASE || 'http://localhost:3100';
  var refreshInterval = null;

  // Auth state
  var authToken = localStorage.getItem('ops_auth_token') || '';
  var authApiKey = localStorage.getItem('ops_auth_api_key') || '';

  // Cached data
  var cachedTasks = [];
  var cachedApprovals = [];
  var cachedWorkflows = [];
  var cachedReceipts = [];
  var pendingDenyId = null;

  // SPARK chat state
  var sparkConversationId = null;
  var sparkConversations = [];

  // Current page
  var currentPage = 'dashboard';

  // Page name map for topbar title
  var PAGE_TITLES = {
    dashboard: 'Dashboard',
    'spark-chat': 'SPARK',
    memory: 'Memory',
    tasks: 'Tasks',
    connectors: 'Connectors',
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. API Client
  // ═══════════════════════════════════════════════════════════════════

  function authHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = 'Bearer ' + authToken;
    } else if (authApiKey) {
      headers['Authorization'] = 'Bearer ' + authApiKey;
    }
    return headers;
  }

  var api = {
    get: function (path) {
      return fetch(API_BASE + path, { headers: authHeaders() })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (err) {
          console.error('API GET ' + path + ':', err);
          return null;
        });
    },

    post: function (path, body) {
      return fetch(API_BASE + path, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body || {}),
      })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (err) {
          console.error('API POST ' + path + ':', err);
          return null;
        });
    },

    patch: function (path, body) {
      return fetch(API_BASE + path, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body || {}),
      })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (err) {
          console.error('API PATCH ' + path + ':', err);
          return null;
        });
    },

    /** Raw fetch for SSE/streaming (returns Response). */
    raw: function (path, opts) {
      opts = opts || {};
      opts.headers = opts.headers || authHeaders();
      return fetch(API_BASE + path, opts);
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. Theme Management
  // ═══════════════════════════════════════════════════════════════════

  var htmlEl = document.documentElement;
  var themeToggle = document.getElementById('theme-toggle');

  function initTheme() {
    var saved = localStorage.getItem('ops-theme');
    if (saved) htmlEl.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    var current = htmlEl.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    htmlEl.setAttribute('data-theme', next);
    localStorage.setItem('ops-theme', next);
    if (typeof DesignTokens !== 'undefined') DesignTokens.invalidate();
    // Redraw canvases
    drawDashboardCanvases();
  }

  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
  initTheme();

  // ═══════════════════════════════════════════════════════════════════
  // 4. Router
  // ═══════════════════════════════════════════════════════════════════

  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebar-toggle');
  var navItems = document.querySelectorAll('.sidebar-nav-item');
  var pageSections = document.querySelectorAll('.page-section');
  var topbarTitle = document.getElementById('topbar-title');
  var mobileMenuBtn = document.getElementById('mobile-menu-btn');

  function navigateTo(page) {
    if (!page || page === currentPage) return;
    var previousPage = currentPage;
    currentPage = page;
    window.location.hash = '#/' + page;

    // Cleanup when leaving memory page
    if (previousPage === 'memory' && page !== 'memory' && spiralViz) {
      spiralViz.stop();
    }

    // Update sidebar active state
    navItems.forEach(function (item) {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update page sections
    pageSections.forEach(function (section) {
      var sectionPage = section.id.replace('page-', '');
      section.classList.toggle('active', sectionPage === page);
    });

    // Update topbar title
    if (topbarTitle) topbarTitle.textContent = PAGE_TITLES[page] || page;

    // Close mobile sidebar
    if (sidebar) sidebar.classList.remove('mobile-open');

    // Animate page in
    animatePageIn(page);

    // Page-specific loading
    if (page === 'dashboard') loadDashboard();
    else if (page === 'spark-chat') loadSparkChat();
    else if (page === 'tasks') { loadTasks(); loadApprovals(); loadWorkflows(); loadReceipts(); }
    else if (page === 'connectors') loadConnectors();
    else if (page === 'memory') loadMemoryPage();
  }

  function initRouter() {
    var hash = window.location.hash.replace('#/', '') || 'dashboard';
    // Validate hash
    var validPages = ['dashboard', 'spark-chat', 'memory', 'tasks', 'connectors'];
    if (validPages.indexOf(hash) === -1) hash = 'dashboard';
    currentPage = ''; // Force navigateTo to run
    navigateTo(hash);
  }

  // Sidebar nav clicks
  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      navigateTo(item.dataset.page);
    });
  });

  // Sidebar expand/collapse
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      sidebar.classList.toggle('expanded');
    });
    sidebarToggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sidebar.classList.toggle('expanded');
      }
    });
  }

  // Mobile menu
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Handle back/forward
  window.addEventListener('hashchange', function () {
    var hash = window.location.hash.replace('#/', '') || 'dashboard';
    if (hash !== currentPage) {
      currentPage = ''; // Force
      navigateTo(hash);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Don't capture if typing in an input/textarea
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    // Page shortcuts: 1-5
    if (e.key === '1') navigateTo('dashboard');
    else if (e.key === '2') navigateTo('spark-chat');
    else if (e.key === '3') navigateTo('memory');
    else if (e.key === '4') navigateTo('tasks');
    else if (e.key === '5') navigateTo('connectors');
    // Search: /
    else if (e.key === '/') {
      e.preventDefault();
      var search = document.getElementById('global-search');
      if (search) search.focus();
    }
    // New task: n
    else if (e.key === 'n' || e.key === 'N') {
      if (currentPage === 'tasks') openSlideOver();
    }
    // Help: ?
    else if (e.key === '?') {
      toggleShortcuts();
    }
    // Escape: close modals
    else if (e.key === 'Escape') {
      closeAllModals();
      closeShortcuts();
    }
  });

  // Shortcuts overlay
  function toggleShortcuts() {
    var overlay = document.getElementById('shortcuts-overlay');
    if (overlay) overlay.classList.toggle('visible');
  }
  function closeShortcuts() {
    var overlay = document.getElementById('shortcuts-overlay');
    if (overlay) overlay.classList.remove('visible');
  }
  var closeShortcutsBtn = document.getElementById('close-shortcuts');
  if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', closeShortcuts);

  // ═══════════════════════════════════════════════════════════════════
  // 5. Toast Notification System
  // ═══════════════════════════════════════════════════════════════════

  var toastContainer = document.getElementById('toast-container');

  function showToast(message, type) {
    type = type || 'success';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;

    var iconSvg = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };

    toast.innerHTML =
      '<span class="toast-icon">' + (iconSvg[type] || iconSvg.success) + '</span>' +
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

    if (toastContainer) toastContainer.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('toast-fade-out');
      setTimeout(function () { if (toast.parentElement) toast.remove(); }, 300);
    }, 4000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. Skeleton Loading
  // ═══════════════════════════════════════════════════════════════════

  function renderSkeletonCards(count) {
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton-card">' +
        '<div class="skeleton-line skeleton-line-title"></div>' +
        '<div class="skeleton-line skeleton-line-long"></div>' +
        '<div class="skeleton-line skeleton-line-medium"></div>' +
        '<div class="skeleton-line skeleton-line-short"></div>' +
      '</div>';
    }
    return html;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. Auth / Login
  // ═══════════════════════════════════════════════════════════════════

  var loginOverlay = document.getElementById('login-overlay');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var loginBtn = document.getElementById('login-btn');
  var loginEmail = document.getElementById('login-email');
  var loginPassword = document.getElementById('login-password');
  var registerToggle = document.getElementById('register-toggle');
  var devContinueBtn = document.getElementById('dev-continue-btn');
  var isRegisterMode = false;

  if (registerToggle) {
    registerToggle.addEventListener('click', function () {
      isRegisterMode = !isRegisterMode;
      loginBtn.textContent = isRegisterMode ? 'Register' : 'Sign In';
      registerToggle.textContent = isRegisterMode ? 'Sign In' : 'Register';
      loginError.textContent = '';
    });
  }

  if (devContinueBtn) {
    devContinueBtn.addEventListener('click', function () {
      if (loginOverlay) loginOverlay.classList.add('hidden');
      initDashboard();
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      loginError.textContent = '';
      loginBtn.disabled = true;

      var endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
      var payload = { email: loginEmail.value.trim(), password: loginPassword.value };
      if (isRegisterMode) payload.name = payload.email.split('@')[0];

      fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          loginBtn.disabled = false;
          if (data.error) { loginError.textContent = data.error; return; }
          if (data.token) {
            authToken = data.token;
            authApiKey = data.apiKey || '';
            localStorage.setItem('ops_auth_token', authToken);
            localStorage.setItem('ops_auth_api_key', authApiKey);
            if (loginOverlay) loginOverlay.classList.add('hidden');
            initDashboard();
          }
        })
        .catch(function (err) {
          loginBtn.disabled = false;
          loginError.textContent = 'Connection error: ' + err.message;
        });
    });
  }

  window.opsLogout = function () {
    authToken = '';
    authApiKey = '';
    localStorage.removeItem('ops_auth_token');
    localStorage.removeItem('ops_auth_api_key');
    if (loginOverlay) loginOverlay.classList.remove('hidden');
  };

  function checkAuthState() {
    fetch(API_BASE + '/health')
      .then(function (res) { return res.json(); })
      .then(function () {
        if (authToken || authApiKey) {
          fetch(API_BASE + '/api/auth/me', { headers: authHeaders() })
            .then(function (res) {
              if (res.status === 200) {
                if (loginOverlay) loginOverlay.classList.add('hidden');
                initDashboard();
              } else if (res.status === 401) {
                localStorage.removeItem('ops_auth_token');
                localStorage.removeItem('ops_auth_api_key');
                authToken = '';
                authApiKey = '';
                if (loginOverlay) loginOverlay.classList.remove('hidden');
              } else {
                if (loginOverlay) loginOverlay.classList.add('hidden');
                initDashboard();
              }
            })
            .catch(function () {
              if (loginOverlay) loginOverlay.classList.add('hidden');
              initDashboard();
            });
        } else {
          fetch(API_BASE + '/api/approvals/count')
            .then(function (res) {
              if (res.status === 200) {
                if (loginOverlay) loginOverlay.classList.add('hidden');
                initDashboard();
              } else {
                if (loginOverlay) loginOverlay.classList.remove('hidden');
              }
            })
            .catch(function () {
              if (loginOverlay) loginOverlay.classList.remove('hidden');
            });
        }
      })
      .catch(function () {
        if (loginOverlay) loginOverlay.classList.remove('hidden');
        if (loginError) loginError.textContent = 'Cannot connect to server';
      });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 8. Dashboard Page
  // ═══════════════════════════════════════════════════════════════════

  function loadDashboard() {
    loadDashboardStats();
    loadDashboardSoul();
    loadDashboardAwareness();
    loadDashboardActivity();
  }

  // ── Stats row with sparklines ──

  function loadDashboardStats() {
    Promise.all([
      api.get('/api/tasks'),
      api.get('/api/approvals'),
      api.get('/api/spark/stats'),
    ]).then(function (results) {
      var tasksData = results[0] || {};
      var approvalsData = results[1] || {};
      var sparkStats = results[2] || {};

      cachedTasks = tasksData.tasks || [];
      cachedApprovals = approvalsData.approvals || [];

      var pendingCount = cachedApprovals.filter(function (a) { return !a.decision; }).length;

      // Update stat values with animation
      var DT = typeof DesignTokens !== 'undefined' ? DesignTokens : null;

      var totalTasksEl = document.getElementById('stat-total-tasks');
      var pendingApprovalsEl = document.getElementById('stat-pending-approvals');
      var episodesEl = document.getElementById('stat-episodes');
      var accuracyEl = document.getElementById('stat-accuracy');

      if (DT) {
        DT.animateCounter(totalTasksEl, cachedTasks.length);
        DT.animateCounter(pendingApprovalsEl, pendingCount);
        DT.animateCounter(episodesEl, sparkStats.totalEpisodes || 0);
      } else {
        totalTasksEl.textContent = cachedTasks.length;
        pendingApprovalsEl.textContent = pendingCount;
        episodesEl.textContent = sparkStats.totalEpisodes || 0;
      }

      // Accuracy
      var cats = Object.values(sparkStats.categories || {});
      if (cats.length > 0) {
        var avgAccuracy = cats.reduce(function (s, c) { return s + (c.accuracy || 0); }, 0) / cats.length;
        if (DT) {
          DT.animateCounter(accuracyEl, avgAccuracy * 100, { suffix: '%', decimals: 0 });
        } else {
          accuracyEl.textContent = (avgAccuracy * 100).toFixed(0) + '%';
        }
      }

      // Update tasks badge
      var tasksBadge = document.getElementById('tasks-badge');
      if (tasksBadge) {
        tasksBadge.textContent = pendingCount > 0 ? pendingCount : '';
      }

      // Draw sparklines
      drawDashboardCanvases();
    });
  }

  function drawDashboardCanvases() {
    var DT = typeof DesignTokens !== 'undefined' ? DesignTokens : null;
    if (!DT) return;

    // Sparkline for tasks (use dummy data if no history)
    drawSparklineCanvas('sparkline-tasks');
    drawSparklineCanvas('sparkline-approvals');
    drawSparklineCanvas('sparkline-episodes');
    drawSparklineCanvas('sparkline-accuracy');
  }

  function drawSparklineCanvas(canvasId) {
    var DT = typeof DesignTokens !== 'undefined' ? DesignTokens : null;
    if (!DT) return;

    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var result = DT.autoSizeCanvas(canvas, 40);
    if (!result) return;

    var ctx = result.ctx;
    var w = result.width;
    var h = result.height;

    // Generate sample data (in production, this would come from API)
    var data = [];
    for (var i = 0; i < 20; i++) {
      data.push(Math.random() * 0.5 + 0.25 + i * 0.02);
    }

    ctx.clearRect(0, 0, w, h);
    DT.drawSparkline(ctx, data, w, h);
  }

  // ── Soul state (emotional + personality) ──

  function loadDashboardSoul() {
    Promise.all([
      api.get('/api/spark/emotional-state'),
      api.get('/api/spark/personality'),
    ]).then(function (results) {
      var emotional = results[0];
      var personality = results[1];

      renderEmotionalState(emotional);
      renderPersonalityRadar(personality);
    });
  }

  function renderEmotionalState(data) {
    var dot = document.getElementById('emotional-dot');
    var text = document.getElementById('emotional-text');
    var detail = document.getElementById('emotional-detail');

    if (!data || !data.emotionalState) {
      if (text) text.textContent = 'Not yet initialized';
      return;
    }

    var state = data.emotionalState;
    var valence = state.valence || 0;
    var momentum = state.momentum || 'stable';
    var volatility = state.volatility || 0;

    // Set dot class
    if (dot) {
      dot.className = 'emotional-dot';
      if (valence > 0.1) dot.classList.add('positive');
      else if (valence < -0.1) dot.classList.add('negative');
      else dot.classList.add('neutral');
    }

    // Momentum arrow
    var arrow = momentum === 'improving' ? ' \u2197' : momentum === 'declining' ? ' \u2198' : ' \u2192';
    if (text) text.textContent = capitalize(momentum) + arrow + ' (valence: ' + valence.toFixed(2) + ')';

    if (detail) {
      detail.textContent = 'Volatility: ' + (volatility * 100).toFixed(0) + '% | ' +
        'High-emotion events: ' + (state.highEmotionCount || 0);
    }
  }

  function renderPersonalityRadar(data) {
    var DT = typeof DesignTokens !== 'undefined' ? DesignTokens : null;
    var canvas = document.getElementById('personality-radar');
    var traitsList = document.getElementById('personality-traits');

    if (!data || !data.personality) {
      if (traitsList) traitsList.innerHTML = '<div class="text-muted" style="font-size:var(--text-xs);">Not yet initialized</div>';
      return;
    }

    var traits = data.personality;
    var traitNames = ['curiosity', 'caution', 'warmth', 'directness', 'playfulness'];
    var values = traitNames.map(function (name) { return traits[name] || 0.5; });

    // Draw radar
    if (DT && canvas) {
      var result = DT.autoSizeCanvas(canvas, null);
      if (result) {
        var ctx = result.ctx;
        var size = Math.min(result.width, result.height);
        ctx.clearRect(0, 0, result.width, result.height);
        DT.drawRadar(ctx, values, size / 2, size / 2, size / 2 - 20);
      }
    }

    // Render trait bars
    if (traitsList) {
      traitsList.innerHTML = traitNames.map(function (name, i) {
        var pct = Math.round(values[i] * 100);
        return '<div class="personality-trait">' +
          '<span class="personality-trait-name">' + name + '</span>' +
          '<div class="personality-trait-bar">' +
            '<div class="personality-trait-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  // ── Awareness (beliefs, insights, weights) ──

  function loadDashboardAwareness() {
    Promise.all([
      api.get('/api/spark/awareness'),
      api.get('/api/spark/weights'),
    ]).then(function (results) {
      var awareness = results[0] || {};
      var weightsData = results[1] || {};

      renderBeliefs(awareness.beliefs || {});
      renderInsights(awareness.insights || []);
      renderAlerts(awareness.alerts || {});
      renderWeights(weightsData.weights || weightsData || {});

      // SENTINEL status
      renderSentinelStatus(awareness);
    });
  }

  function renderSentinelStatus(awareness) {
    var pill = document.getElementById('sentinel-status-pill');
    var detail = document.getElementById('sentinel-detail');
    if (!pill || !detail) return;

    var alerts = awareness.alerts || {};
    var sentinelActive = (alerts.sentinelActive || []).length > 0;

    if (sentinelActive) {
      pill.className = 'status-pill pending';
      pill.textContent = 'Elevated';
      detail.textContent = 'SENTINEL categories have elevated risk levels.';
    } else {
      pill.className = 'status-pill completed';
      pill.textContent = 'Protected';
      detail.textContent = 'All critical categories within safe thresholds.';
    }
  }

  function renderBeliefs(beliefs) {
    var grid = document.getElementById('beliefs-grid');
    if (!grid) return;

    var entries = Object.values(beliefs);
    if (!entries || entries.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);">No beliefs yet \u2014 run the pipeline to generate awareness data</div>';
      return;
    }

    var sentinel = ['destructive', 'financial'];

    grid.innerHTML = entries.map(function (b) {
      var trustClass = b.trustLevel === 'high' ? 'high' : b.trustLevel === 'low' ? 'low' : 'medium';

      return '<div class="belief-card">' +
        '<div class="belief-header">' +
          '<span class="belief-category">' + escapeHtml(b.category) + '</span>' +
          '<span class="belief-trust ' + trustClass + '">' + escapeHtml(b.trustLevel) + '</span>' +
        '</div>' +
        '<div class="belief-narrative">' + escapeHtml(b.narrative) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderInsights(insights) {
    var list = document.getElementById('insights-list');
    if (!list) return;

    if (!insights || insights.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);">No insights yet \u2014 patterns emerge after enough learning episodes</div>';
      return;
    }

    list.innerHTML = insights.map(function (ins) {
      return '<div class="insight-card">' +
        '<div class="insight-type">' + escapeHtml(ins.pattern || '') + ' \u00b7 ' + escapeHtml(ins.category || '') + '</div>' +
        '<div>' + escapeHtml(ins.summary || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderAlerts(alerts) {
    var container = document.getElementById('spark-alerts-container');
    if (!container) return;

    var items = [];
    if (alerts.oscillating) {
      alerts.oscillating.forEach(function (c) {
        items.push('<div class="spark-alert warning">' + escapeHtml(c) + ': oscillating weight</div>');
      });
    }
    if (alerts.lowConfidence) {
      alerts.lowConfidence.forEach(function (c) {
        items.push('<div class="spark-alert info">' + escapeHtml(c) + ': low confidence</div>');
      });
    }
    if (alerts.sentinelActive) {
      alerts.sentinelActive.forEach(function (c) {
        items.push('<div class="spark-alert error">' + escapeHtml(c) + ': SENTINEL elevated</div>');
      });
    }

    container.innerHTML = items.length > 0 ? items.join('') : '';
  }

  function renderWeights(weights) {
    var grid = document.getElementById('weight-grid');
    if (!grid) return;

    if (!weights || (typeof weights === 'object' && Object.keys(weights).length === 0)) {
      grid.innerHTML = '<div class="empty-state" style="padding:var(--sp-4);">No weights data</div>';
      return;
    }

    var entries = Array.isArray(weights) ? weights : Object.values(weights);

    grid.innerHTML = entries.map(function (w) {
      var barPct = ((w.currentWeight - w.lowerBound) / (w.upperBound - w.lowerBound)) * 100;
      return '<div class="weight-card">' +
        '<div class="weight-category">' + escapeHtml(w.category) + '</div>' +
        '<div class="weight-value">' + w.currentWeight.toFixed(3) + '</div>' +
        '<div class="weight-bar">' +
          '<div class="weight-bar-fill" style="width:' + Math.max(5, barPct) + '%"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Activity feed ──

  var ACTIVITY_MAX = 20;

  function loadDashboardActivity() {
    // Initial load from audit log if available
    api.get('/api/audit?limit=20').then(function (data) {
      if (!data) return;
      var feed = document.getElementById('activity-feed');
      if (!feed) return;

      var events = data.entries || data.events || data || [];
      if (!Array.isArray(events) || events.length === 0) return;

      feed.innerHTML = events.map(function (ev) {
        var dotClass = 'system';
        var action = (ev.action || ev.type || '').toLowerCase();
        if (action.indexOf('approv') !== -1) dotClass = 'approval';
        else if (action.indexOf('task') !== -1) dotClass = 'task';
        else if (action.indexOf('spark') !== -1) dotClass = 'spark';

        return '<div class="activity-item">' +
          '<span class="activity-dot ' + dotClass + '"></span>' +
          '<span class="activity-text">' + escapeHtml(ev.action || ev.message || ev.type || '') + '</span>' +
          '<span class="activity-time">' + formatTime(ev.timestamp || ev.createdAt || '') + '</span>' +
        '</div>';
      }).join('');
    });
  }

  function addActivity(type, message) {
    var feed = document.getElementById('activity-feed');
    if (!feed) return;

    var empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();

    var dotClass = type === 'success' ? 'spark' : type === 'warning' ? 'approval' : type === 'error' ? 'approval' : 'system';

    var item = document.createElement('div');
    item.className = 'activity-item animate-slide-up';
    item.innerHTML =
      '<span class="activity-dot ' + dotClass + '"></span>' +
      '<span class="activity-text">' + escapeHtml(message) + '</span>' +
      '<span class="activity-time">' + new Date().toLocaleTimeString() + '</span>';

    feed.insertBefore(item, feed.firstChild);

    var items = feed.querySelectorAll('.activity-item');
    while (items.length > ACTIVITY_MAX) {
      items[items.length - 1].remove();
      items = feed.querySelectorAll('.activity-item');
    }
  }

  // Snapshot button
  var snapshotBtn = document.getElementById('spark-snapshot-btn');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', function () {
      api.post('/api/spark/snapshot', { reason: 'Manual dashboard snapshot' }).then(function (data) {
        showToast(data ? 'Weight snapshot created' : 'Failed to create snapshot', data ? 'success' : 'error');
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 9. SPARK Chat Page
  // ═══════════════════════════════════════════════════════════════════

  var chatMessages = document.getElementById('chat-messages');
  var chatInput = document.getElementById('chat-input');
  var chatSendBtn = document.getElementById('chat-send-btn');
  var chatSuggestions = document.getElementById('chat-suggestions');
  var newChatBtn = document.getElementById('new-chat-btn');

  function loadSparkChat() {
    loadConversationList();
    // Auto-resize textarea
    if (chatInput) {
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
    }
  }

  function loadConversationList() {
    api.get('/api/spark/conversations').then(function (data) {
      var list = document.getElementById('chat-list');
      if (!list || !data) return;

      sparkConversations = data.conversations || [];
      if (sparkConversations.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:var(--sp-4);font-size:var(--text-xs);">No conversations yet</div>';
        return;
      }

      list.innerHTML = sparkConversations.map(function (conv) {
        var isActive = conv.id === sparkConversationId;
        return '<div class="chat-list-item' + (isActive ? ' active' : '') + '" data-id="' + escapeHtml(conv.id) + '" onclick="App.loadConversation(\'' + escapeHtml(conv.id) + '\')">' +
          '<div class="chat-list-item-title">' + escapeHtml(conv.title || conv.firstMessage || 'Conversation') + '</div>' +
          '<div class="chat-list-item-time">' + formatTime(conv.lastMessageAt || conv.createdAt) + '</div>' +
        '</div>';
      }).join('');
    });
  }

  function loadConversation(conversationId) {
    sparkConversationId = conversationId;

    api.get('/api/spark/conversations/' + conversationId).then(function (data) {
      if (!data) return;

      // Clear messages
      chatMessages.innerHTML = '';

      var messages = data.messages || data.turns || [];
      messages.forEach(function (msg) {
        appendChatMessage(
          msg.role === 'user' ? 'user' : 'spark',
          msg.content || msg.text || msg.response || '',
          msg.reasoning || [],
          msg.suggestions || [],
          msg.intent,
          msg.confidence
        );
      });

      // Update sidebar active state
      loadConversationList();
    });
  }

  function appendChatMessage(role, text, reasoning, suggestions, intent, confidence) {
    // Remove welcome if present
    var welcome = document.getElementById('chat-welcome');
    if (welcome) welcome.remove();

    var msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ' + role;

    var avatarContent = role === 'user' ? 'Y' :
      '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">' +
      '<path d="M16 4 A12 12 0 1 1 4 16 A6 6 0 0 1 16 16" stroke-width="2.5"/>' +
      '<circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/></svg>';
    var avatar = '<div class="chat-msg-avatar">' + avatarContent + '</div>';

    var body = '<div class="chat-msg-body">' +
      '<div class="chat-msg-content">' + escapeHtml(text) + '</div>';

    // Reasoning accordion (SPARK messages)
    if (role === 'spark' && reasoning && reasoning.length > 0) {
      body += '<div class="chat-reasoning">' +
        '<button class="chat-reasoning-toggle" onclick="this.classList.toggle(\'open\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
          ' ' + reasoning.length + ' reasoning steps' +
        '</button>' +
        '<div class="chat-reasoning-steps">';

      reasoning.forEach(function (step) {
        var conf = step.confidence ? (step.confidence * 100).toFixed(0) + '%' : '';
        body += escapeHtml(step.ruleId || '') + ': ' + escapeHtml(step.description || '') +
          (conf ? ' (' + conf + ')' : '') + '\n';
      });

      body += '</div></div>';
    }

    // Meta badges
    if (role === 'spark' && (intent || confidence)) {
      body += '<div class="chat-meta">';
      if (intent) body += '<span class="chat-badge chat-badge-intent">' + escapeHtml(intent) + '</span>';
      if (confidence !== undefined) {
        var confPct = (confidence * 100).toFixed(0) + '%';
        var confClass = confidence < 0.5 ? ' low' : '';
        body += '<span class="chat-badge chat-badge-confidence' + confClass + '">' + confPct + ' confidence</span>';
      }
      body += '</div>';
    }

    body += '</div>';

    msgDiv.innerHTML = avatar + body;
    chatMessages.appendChild(msgDiv);

    // Update suggestions
    if (role === 'spark' && suggestions && suggestions.length > 0) {
      chatSuggestions.innerHTML = suggestions.map(function (s) {
        return '<button class="suggestion-chip" data-suggestion="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
      }).join('');
      bindSuggestionChips();
    }

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendTypingIndicator() {
    var typingDiv = document.createElement('div');
    typingDiv.className = 'chat-msg spark';
    typingDiv.id = 'spark-typing';
    typingDiv.innerHTML =
      '<div class="chat-msg-avatar"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M16 4 A12 12 0 1 1 4 16 A6 6 0 0 1 16 16" stroke-width="2.5"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/></svg></div>' +
      '<div class="chat-msg-body"><div class="chat-msg-content animate-pulse" style="min-width:60px;">...</div></div>';
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return typingDiv;
  }

  function sendChat(message) {
    if (!message || !message.trim()) return;
    message = message.trim();

    appendChatMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatSendBtn.disabled = true;

    var typing = appendTypingIndicator();

    var body = { message: message };
    if (sparkConversationId) body.conversationId = sparkConversationId;

    api.post('/api/spark/chat', body).then(function (data) {
      if (typing.parentElement) typing.remove();

      if (data) {
        sparkConversationId = data.conversationId || sparkConversationId;
        appendChatMessage(
          'spark',
          data.response || 'No response',
          data.reasoning || [],
          data.suggestions || [],
          data.intent,
          data.confidence
        );
        loadConversationList();
      } else {
        appendChatMessage('spark', 'Sorry, something went wrong.', [], []);
      }

      chatSendBtn.disabled = false;
      chatInput.focus();
    });
  }

  function resetChat() {
    sparkConversationId = null;

    chatMessages.innerHTML =
      '<div class="chat-welcome" id="chat-welcome">' +
        '<div class="chat-welcome-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div>' +
        '<h2 class="chat-welcome-title">Talk to SPARK</h2>' +
        '<p class="chat-welcome-subtitle">Ask about learning patterns, predictions, cross-connector insights, or just say hello.</p>' +
      '</div>';

    chatSuggestions.innerHTML =
      '<button class="suggestion-chip" data-suggestion="How are you doing?">How are you doing?</button>' +
      '<button class="suggestion-chip" data-suggestion="What have you learned?">What have you learned?</button>' +
      '<button class="suggestion-chip" data-suggestion="What connections do you see?">What connections do you see?</button>' +
      '<button class="suggestion-chip" data-suggestion="Reflect on your blind spots">Reflect on your blind spots</button>';

    bindSuggestionChips();
    loadConversationList();
  }

  // Bind events
  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', function () { sendChat(chatInput.value); });
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat(chatInput.value);
      }
    });
    chatInput.addEventListener('input', function () {
      chatSendBtn.disabled = !chatInput.value.trim();
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', resetChat);
  }

  function bindSuggestionChips() {
    document.querySelectorAll('.suggestion-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        sendChat(chip.dataset.suggestion || chip.textContent);
      });
    });
  }
  // Bind initial chips
  bindSuggestionChips();

  // ═══════════════════════════════════════════════════════════════════
  // 10. Tasks & Approvals Page
  // ═══════════════════════════════════════════════════════════════════

  // ── Filters ──
  var filterSource = document.getElementById('filter-source');
  var filterStatus = document.getElementById('filter-status');
  var filterIntent = document.getElementById('filter-intent');
  var clearFiltersBtn = document.getElementById('clear-filters-btn');

  if (filterSource) filterSource.addEventListener('change', renderFilteredTasks);
  if (filterStatus) filterStatus.addEventListener('change', renderFilteredTasks);
  if (filterIntent) filterIntent.addEventListener('change', renderFilteredTasks);
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', function () {
      filterSource.value = '';
      filterStatus.value = '';
      filterIntent.value = '';
      renderFilteredTasks();
    });
  }

  // ── Tasks ──

  function loadTasks() {
    var list = document.getElementById('task-list');
    if (list && cachedTasks.length === 0) list.innerHTML = renderSkeletonCards(3);

    api.get('/api/tasks').then(function (data) {
      if (!data) {
        if (list) list.innerHTML = '<div class="empty-state">Failed to load tasks</div>';
        return;
      }
      cachedTasks = data.tasks || [];
      renderFilteredTasks();
    });
  }

  // Source-specific icons
  var SOURCE_ICONS = {
    email: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>',
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    social: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
    store: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
    manual: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    slack: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="13" y="2" width="3" height="8" rx="1.5"/><rect x="8" y="14" width="3" height="8" rx="1.5"/></svg>',
    notion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/><line x1="8" y1="9" x2="16" y2="9"/></svg>',
  };

  function renderFilteredTasks() {
    var list = document.getElementById('task-list');
    if (!list) return;

    var source = filterSource ? filterSource.value : '';
    var status = filterStatus ? filterStatus.value : '';
    var intent = filterIntent ? filterIntent.value : '';

    var filtered = cachedTasks.filter(function (t) {
      if (source && t.source !== source) return false;
      if (status && t.status !== status) return false;
      if (intent && t.intent !== intent) return false;
      return true;
    });

    // Sort: pending/queued first, then running, then by date desc
    var statusOrder = { pending: 0, queued: 1, running: 2, completed: 3, failed: 4 };
    filtered.sort(function (a, b) {
      var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 5;
      var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 5;
      if (sa !== sb) return sa - sb;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    // Update task count display
    var taskCountEl = document.getElementById('task-count-label');
    if (taskCountEl) taskCountEl.textContent = filtered.length + ' of ' + cachedTasks.length + ' tasks';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">' + (cachedTasks.length === 0 ? 'No tasks yet' : 'No tasks match filters') + '</div>';
      return;
    }

    list.innerHTML = filtered.map(function (t) {
      var sourceKey = (t.source || 'manual').toLowerCase();
      var icon = SOURCE_ICONS[sourceKey] || SOURCE_ICONS.manual;
      return '<div class="task-card" data-id="' + escapeHtml(t.id || '') + '" onclick="App.showTaskDetail(this)">' +
        '<div class="task-source-icon ' + escapeHtml(sourceKey) + '">' + icon + '</div>' +
        '<div class="task-info">' +
          '<div class="task-title">' + escapeHtml(t.title) + '</div>' +
          '<div class="task-subtitle">' + escapeHtml(t.source || '') + ' \u00b7 ' + escapeHtml(t.intent || '') + ' \u00b7 ' + formatTime(t.createdAt) + '</div>' +
        '</div>' +
        '<div class="task-meta">' +
          '<span class="status-pill ' + (t.status || 'pending') + '">' + escapeHtml(t.status || 'pending') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Approvals ──

  function loadApprovals() {
    var list = document.getElementById('approval-list');
    if (list) list.innerHTML = renderSkeletonCards(2);

    api.get('/api/approvals').then(function (data) {
      if (!data) {
        if (list) list.innerHTML = '<div class="empty-state">Failed to load approvals</div>';
        return;
      }

      cachedApprovals = data.approvals || [];
      var pending = cachedApprovals.filter(function (a) { return !a.decision; });

      var countEl = document.getElementById('approval-count');
      if (countEl) countEl.textContent = pending.length + ' pending';

      if (pending.length === 0) {
        if (list) list.innerHTML = '<div class="empty-state">No pending approvals</div>';
        return;
      }

      if (list) {
        list.innerHTML = pending.map(function (a) {
          var riskClass = a.risk || 'low';
          return '<div class="approval-card">' +
            '<div class="approval-card-header">' +
              '<div class="approval-card-title">' + escapeHtml(a.reason || '') + '</div>' +
              '<span class="risk-pill ' + riskClass + '">' + escapeHtml(riskClass) + '</span>' +
            '</div>' +
            '<div class="approval-card-body">' + escapeHtml((a.preview || '').slice(0, 200)) + '</div>' +
            '<div class="approval-card-actions">' +
              '<button class="btn btn-success btn-sm" onclick="App.approveWithLoading(this, \'' + a.id + '\')">Approve</button>' +
              '<button class="btn btn-danger btn-sm" onclick="App.confirmDeny(\'' + a.id + '\', \'' + escapeHtml(a.reason || '') + '\')">Deny</button>' +
              '<button class="btn btn-sm" onclick="App.showCordExplainer(\'' + a.id + '\')">Why flagged?</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    });
  }

  function decideApproval(id, decision, btn) {
    api.post('/api/approvals/' + id + '/decide', { decision: decision }).then(function (data) {
      if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
      showToast(data ? 'Approval ' + decision : 'Failed', data ? 'success' : 'error');
      loadApprovals();
      addActivity(decision === 'approved' ? 'success' : 'warning', 'Approval ' + decision);
    });
  }

  function approveWithLoading(btn, id) {
    btn.disabled = true;
    decideApproval(id, 'approved', btn);
  }

  // Deny confirmation
  function confirmDeny(id, reason) {
    pendingDenyId = id;
    var reasonText = document.getElementById('deny-reason-text');
    if (reasonText) reasonText.textContent = reason ? '"' + reason + '"' : '';
    openModal('deny-confirm-modal');
  }

  function executeDeny() {
    if (pendingDenyId) {
      decideApproval(pendingDenyId, 'denied');
      pendingDenyId = null;
    }
    closeModal('deny-confirm-modal');
  }

  var confirmDenyBtn = document.getElementById('confirm-deny-btn');
  var cancelDenyBtn = document.getElementById('cancel-deny-btn');
  if (confirmDenyBtn) confirmDenyBtn.addEventListener('click', executeDeny);
  if (cancelDenyBtn) cancelDenyBtn.addEventListener('click', function () { pendingDenyId = null; closeModal('deny-confirm-modal'); });

  // Approval history toggle
  var historyToggleBtn = document.getElementById('toggle-history-btn');
  if (historyToggleBtn) {
    historyToggleBtn.addEventListener('click', function () {
      var list = document.getElementById('approval-history-list');
      if (!list) return;
      if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        historyToggleBtn.textContent = 'Hide History';
        loadApprovalHistory();
      } else {
        list.classList.add('hidden');
        historyToggleBtn.textContent = 'Show History';
      }
    });
  }

  function loadApprovalHistory() {
    var list = document.getElementById('approval-history-list');
    if (!list) return;
    list.innerHTML = renderSkeletonCards(2);

    api.get('/api/approvals/history?limit=20').then(function (data) {
      if (!data || !data.history || data.history.length === 0) {
        list.innerHTML = '<div class="empty-state">No approval history</div>';
        return;
      }

      list.innerHTML = data.history.map(function (a) {
        var decisionClass = a.decision === 'approved' ? 'completed' : 'failed';
        return '<div class="approval-card">' +
          '<div class="approval-card-header">' +
            '<div class="approval-card-title">' + escapeHtml(a.reason || '') + '</div>' +
            '<span class="status-pill ' + decisionClass + '">' + escapeHtml(a.decision || '') + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    });
  }

  // ── Workflows ──

  function loadWorkflows() {
    var list = document.getElementById('workflow-list');
    if (!list) return;
    list.innerHTML = renderSkeletonCards(2);

    api.get('/api/workflows').then(function (data) {
      if (!data) { list.innerHTML = '<div class="empty-state">Failed to load</div>'; return; }
      cachedWorkflows = data.runs || [];

      if (cachedWorkflows.length === 0) {
        list.innerHTML = '<div class="empty-state">No workflow runs</div>';
        return;
      }

      list.innerHTML = cachedWorkflows.map(function (r) {
        var completed = r.steps.filter(function (s) { return s.status === 'completed'; }).length;
        var stateClass = r.state === 'completed' ? 'completed' : r.state === 'failed' ? 'failed' : 'running';

        return '<div class="task-card" style="cursor:default;">' +
          '<div class="task-info">' +
            '<div class="task-title">' + escapeHtml(r.workflowType) + '</div>' +
            '<div class="task-subtitle">Steps: ' + completed + '/' + r.steps.length + ' \u00b7 Started: ' + formatTime(r.startedAt) + '</div>' +
          '</div>' +
          '<span class="status-pill ' + stateClass + '">' + escapeHtml(r.state) + '</span>' +
        '</div>';
      }).join('');
    });
  }

  // ── New Task (Slide-over) ──

  var slideOver = document.getElementById('new-task-slide-over');
  var slideOverBackdrop = document.getElementById('slide-over-backdrop');
  var newTaskBtn = document.getElementById('new-task-btn');
  var closeTaskFormBtn = document.getElementById('close-task-form');
  var cancelTaskBtn = document.getElementById('cancel-task-btn');
  var submitTaskBtn = document.getElementById('submit-task-btn');

  function openSlideOver() {
    if (slideOver) slideOver.classList.add('open');
    if (slideOverBackdrop) slideOverBackdrop.classList.add('visible');
    var titleInput = document.getElementById('task-title');
    if (titleInput) titleInput.focus();
  }

  function closeSlideOver() {
    if (slideOver) slideOver.classList.remove('open');
    if (slideOverBackdrop) slideOverBackdrop.classList.remove('visible');
    // Reset form
    var el;
    el = document.getElementById('task-source'); if (el) el.value = 'manual';
    el = document.getElementById('task-title'); if (el) el.value = '';
    el = document.getElementById('task-body'); if (el) el.value = '';
  }

  if (newTaskBtn) newTaskBtn.addEventListener('click', openSlideOver);
  if (closeTaskFormBtn) closeTaskFormBtn.addEventListener('click', closeSlideOver);
  if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', closeSlideOver);
  if (slideOverBackdrop) slideOverBackdrop.addEventListener('click', closeSlideOver);

  if (submitTaskBtn) {
    submitTaskBtn.addEventListener('click', function () {
      var source = document.getElementById('task-source').value;
      var title = document.getElementById('task-title').value.trim();
      var body = document.getElementById('task-body').value.trim();

      if (!title) { document.getElementById('task-title').focus(); return; }

      submitTaskBtn.disabled = true;
      submitTaskBtn.textContent = 'Creating...';

      var payload = { source: source, title: title };
      if (body) payload.body = body;

      api.post('/api/tasks', payload).then(function (data) {
        submitTaskBtn.disabled = false;
        submitTaskBtn.textContent = 'Create Task';

        if (data) {
          closeSlideOver();
          loadTasks();
          addActivity('success', 'Created task: ' + title);
          showToast('Task created: ' + title, 'success');
        } else {
          showToast('Failed to create task', 'error');
        }
      });
    });
  }

  // ── Pipeline Run ──

  var runPipelineBtn = document.getElementById('run-pipeline-btn');
  var PIPELINE_STAGE_NAMES = ['Classify', 'Policy', 'CORD Safety', 'Approve', 'Execute', 'Receipt'];

  if (runPipelineBtn) {
    runPipelineBtn.addEventListener('click', function () {
      api.get('/api/tasks').then(function (data) {
        if (!data || !data.tasks || data.tasks.length === 0) {
          showToast('No tasks available', 'error');
          return;
        }
        var task = data.tasks.find(function (t) { return t.status === 'pending' || t.status === 'queued'; }) || data.tasks[0];
        startPipelineLiveView(task);
      });
    });
  }

  function startPipelineLiveView(task) {
    var stageStates = {};
    var stageTimes = {};
    var stageStartTimes = {};
    PIPELINE_STAGE_NAMES.forEach(function (name) { stageStates[name] = 'pending'; stageTimes[name] = ''; });

    var pipelineStages = document.getElementById('pipeline-stages');
    var pipelineLiveLog = document.getElementById('pipeline-live-log');

    renderPipelineStages(pipelineStages, stageStates, stageTimes);
    if (pipelineLiveLog) pipelineLiveLog.innerHTML = '';
    openModal('pipeline-live-modal');
    if (runPipelineBtn) { runPipelineBtn.disabled = true; runPipelineBtn.textContent = 'Running...'; }

    addPipelineLog(pipelineLiveLog, 'Pipeline started for: ' + task.title);
    addActivity('info', 'Pipeline started: ' + task.title);

    var currentStageIndex = 0;

    fetch(API_BASE + '/api/pipeline/run', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ source: task.source, title: task.title, body: task.body || '' }),
    }).then(function (response) {
      if (!response.ok) {
        stageStates[PIPELINE_STAGE_NAMES[0]] = 'error';
        renderPipelineStages(pipelineStages, stageStates, stageTimes);
        addPipelineLog(pipelineLiveLog, 'Failed: HTTP ' + response.status);
        resetPipelineBtn();
        return;
      }

      stageStates[PIPELINE_STAGE_NAMES[0]] = 'active';
      stageStartTimes[PIPELINE_STAGE_NAMES[0]] = Date.now();
      renderPipelineStages(pipelineStages, stageStates, stageTimes);

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            PIPELINE_STAGE_NAMES.forEach(function (name) {
              if (stageStates[name] === 'active' || stageStates[name] === 'pending') {
                if (stageStartTimes[name]) stageTimes[name] = (Date.now() - stageStartTimes[name]) + 'ms';
                stageStates[name] = 'done';
              }
            });
            renderPipelineStages(pipelineStages, stageStates, stageTimes);
            addPipelineLog(pipelineLiveLog, 'Pipeline completed');
            addActivity('success', 'Pipeline completed: ' + task.title);
            showToast('Pipeline completed', 'success');
            resetPipelineBtn();
            loadTasks();
            loadApprovals();
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();

          lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;

            var evt = null;
            if (line.indexOf('data: ') === 0) {
              try { evt = JSON.parse(line.slice(6)); } catch (e) { addPipelineLog(pipelineLiveLog, line.slice(6)); }
            } else if (line.indexOf('event:') !== 0 && line.indexOf('id:') !== 0 && line.charAt(0) !== ':') {
              try { evt = JSON.parse(line); } catch (e2) { /* ignore */ }
            }

            if (evt) {
              var evtType = (evt.type || evt.event || evt.step || '').toLowerCase();
              var evtMsg = evt.message || evt.detail || evt.reason || evt.step || evt.type || JSON.stringify(evt);
              addPipelineLog(pipelineLiveLog, evtMsg);

              // Advance stages
              var stageMap = {
                classify: 0, classification: 0,
                policy: 1, 'policy-check': 1,
                cord: 2, safety: 2, risk: 2,
                approve: 3, approval: 3, review: 3,
                execute: 4, execution: 4, run: 4,
                receipt: 5, audit: 5, complete: 5, completed: 5, done: 5,
              };

              var matched = stageMap[evtType] !== undefined ? stageMap[evtType] : -1;
              if (matched >= 0) {
                for (var s = 0; s < matched; s++) {
                  if (stageStates[PIPELINE_STAGE_NAMES[s]] !== 'done' && stageStates[PIPELINE_STAGE_NAMES[s]] !== 'error') {
                    if (stageStartTimes[PIPELINE_STAGE_NAMES[s]]) stageTimes[PIPELINE_STAGE_NAMES[s]] = (Date.now() - stageStartTimes[PIPELINE_STAGE_NAMES[s]]) + 'ms';
                    stageStates[PIPELINE_STAGE_NAMES[s]] = 'done';
                  }
                }
                stageStates[PIPELINE_STAGE_NAMES[matched]] = 'active';
                stageStartTimes[PIPELINE_STAGE_NAMES[matched]] = Date.now();
              } else if (currentStageIndex < PIPELINE_STAGE_NAMES.length) {
                if (stageStartTimes[PIPELINE_STAGE_NAMES[currentStageIndex]]) stageTimes[PIPELINE_STAGE_NAMES[currentStageIndex]] = (Date.now() - stageStartTimes[PIPELINE_STAGE_NAMES[currentStageIndex]]) + 'ms';
                stageStates[PIPELINE_STAGE_NAMES[currentStageIndex]] = 'done';
                currentStageIndex++;
                if (currentStageIndex < PIPELINE_STAGE_NAMES.length) {
                  stageStates[PIPELINE_STAGE_NAMES[currentStageIndex]] = 'active';
                  stageStartTimes[PIPELINE_STAGE_NAMES[currentStageIndex]] = Date.now();
                }
              }
              renderPipelineStages(pipelineStages, stageStates, stageTimes);
            }
          });

          readChunk();
        }).catch(function (err) {
          addPipelineLog(pipelineLiveLog, 'Stream error: ' + err.message);
          resetPipelineBtn();
        });
      }

      readChunk();
    }).catch(function (err) {
      addPipelineLog(pipelineLiveLog, 'Failed: ' + err.message);
      resetPipelineBtn();
      showToast('Pipeline failed', 'error');
    });
  }

  function renderPipelineStages(container, states, times) {
    if (!container) return;
    container.innerHTML = PIPELINE_STAGE_NAMES.map(function (name, i) {
      var state = states[name] || 'pending';
      return '<div class="pipeline-stage ' + state + '">' + escapeHtml(name) +
        (times[name] ? ' (' + times[name] + ')' : '') + '</div>';
    }).join('');
  }

  function addPipelineLog(container, message) {
    if (!container) return;
    container.textContent += new Date().toLocaleTimeString() + '  ' + message + '\n';
    container.scrollTop = container.scrollHeight;
  }

  function resetPipelineBtn() {
    if (runPipelineBtn) { runPipelineBtn.disabled = false; runPipelineBtn.textContent = 'Run Pipeline'; }
  }

  // ── Receipts ──

  var verifyChainBtn = document.getElementById('verify-chain-btn');
  var exportReceiptsBtn = document.getElementById('export-receipts-btn');

  function loadReceipts() {
    api.get('/api/receipts').then(function (data) {
      if (data && data.receipts) cachedReceipts = data.receipts;
      else if (data && Array.isArray(data)) cachedReceipts = data;
      else cachedReceipts = generateReceiptsFromApprovals();
      renderReceiptChain();
    }).catch(function () {
      cachedReceipts = generateReceiptsFromApprovals();
      renderReceiptChain();
    });
  }

  function generateReceiptsFromApprovals() {
    var receipts = [];
    var prevHash = '0000000000000000';
    cachedApprovals.forEach(function (a, i) {
      var hash = simpleHash(prevHash + (a.id || '') + (a.decision || '') + (a.requestedAt || ''));
      receipts.push({
        id: a.id || ('rcpt-' + i),
        actionId: a.id,
        timestamp: a.decidedAt || a.requestedAt || new Date().toISOString(),
        hash: hash,
        prevHash: prevHash,
      });
      prevHash = hash;
    });
    return receipts;
  }

  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    var hex = Math.abs(hash).toString(16);
    while (hex.length < 16) hex = '0' + hex;
    return hex.slice(0, 16);
  }

  function renderReceiptChain() {
    var container = document.getElementById('receipt-chain');
    if (!container) return;

    if (cachedReceipts.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:var(--sp-4);">No receipts loaded</div>';
      return;
    }

    container.innerHTML = cachedReceipts.map(function (r) {
      return '<div class="receipt-node">' +
        '<span>' + escapeHtml((r.actionId || r.id || '').slice(0, 12)) + '... </span>' +
        '<span class="receipt-hash">' + escapeHtml((r.hash || '').slice(0, 16)) + '</span>' +
        '<span style="margin-left:auto;color:var(--text-muted);font-size:0.625rem;">' + formatTime(r.timestamp) + '</span>' +
      '</div>';
    }).join('');
  }

  if (verifyChainBtn) {
    verifyChainBtn.addEventListener('click', function () {
      if (cachedReceipts.length === 0) { showToast('No receipts to verify', 'warning'); return; }
      var valid = true;
      for (var i = 1; i < cachedReceipts.length; i++) {
        if (cachedReceipts[i].prevHash && cachedReceipts[i - 1].hash && cachedReceipts[i].prevHash !== cachedReceipts[i - 1].hash) {
          valid = false;
          break;
        }
      }
      var result = document.getElementById('chain-verification-result');
      if (result) {
        result.classList.remove('hidden');
        result.className = 'chain-verification-result ' + (valid ? 'valid' : 'invalid');
        result.textContent = valid
          ? 'Chain verified: all ' + cachedReceipts.length + ' receipts valid'
          : 'Chain broken: hash mismatch detected';
      }
      showToast(valid ? 'Chain integrity verified' : 'Chain integrity failed', valid ? 'success' : 'error');
    });
  }

  if (exportReceiptsBtn) {
    exportReceiptsBtn.addEventListener('click', function () {
      if (cachedReceipts.length === 0) { showToast('No receipts to export', 'warning'); return; }
      var blob = new Blob([JSON.stringify(cachedReceipts, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'receipt-chain-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Receipts exported', 'success');
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 11. Connectors Page
  // ═══════════════════════════════════════════════════════════════════

  var CONNECTOR_DEFS = [
    { id: 'gmail',    name: 'Gmail',    iconClass: 'gmail',    keys: ['gmail', 'email'],
      desc: 'Email ingestion and reply drafting',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>' },
    { id: 'calendar', name: 'Calendar', iconClass: 'calendar', keys: ['calendar', 'gcal'],
      desc: 'Event scheduling and conflict detection',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
    { id: 'x',        name: 'X',        iconClass: 'x',        keys: ['x', 'twitter'],
      desc: 'Social monitoring and content publishing',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
    { id: 'shopify',  name: 'Shopify',  iconClass: 'shopify',  keys: ['shopify', 'store'],
      desc: 'Order management and inventory alerts',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>' },
    { id: 'slack',    name: 'Slack',    iconClass: 'slack',    keys: ['slack'],
      desc: 'Workspace messages and channel monitoring',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="13" y="2" width="3" height="8" rx="1.5"/><rect x="8" y="14" width="3" height="8" rx="1.5"/><rect x="2" y="8" width="8" height="3" rx="1.5"/><rect x="14" y="13" width="8" height="3" rx="1.5"/></svg>' },
    { id: 'notion',   name: 'Notion',   iconClass: 'notion',   keys: ['notion'],
      desc: 'Knowledge base and document tracking',
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>' },
  ];

  function loadConnectors() {
    api.get('/api/connectors').then(function (data) {
      var grid = document.getElementById('connector-grid');
      if (!grid) return;

      var connectorMap = {};
      if (data && data.connectors) {
        data.connectors.forEach(function (c) {
          connectorMap[(c.id || c.name || '').toLowerCase()] = c;
        });
      }

      grid.innerHTML = CONNECTOR_DEFS.map(function (def) {
        var found = null;
        def.keys.forEach(function (key) { if (connectorMap[key]) found = connectorMap[key]; });
        var isActive = found && (found.configured !== false && found.enabled !== false);
        var statusDot = isActive ? 'active' : 'inactive';
        var statusLabel = isActive ? 'Connected' : 'Not connected';
        var lastActivity = found && found.lastActivity ? formatTime(found.lastActivity) : 'Never';

        return '<div class="connector-card ' + (isActive ? 'connected' : '') + '">' +
          '<div class="connector-card-header">' +
            '<div class="connector-icon ' + def.iconClass + '">' + def.icon + '</div>' +
            '<div>' +
              '<div class="connector-name">' + escapeHtml(def.name) + '</div>' +
              '<div class="connector-status-label"><span class="dot ' + statusDot + '"></span> ' + statusLabel + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="connector-desc">' + escapeHtml(def.desc) + '</div>' +
          '<div class="connector-stats">' +
            '<div class="connector-stat-row"><span>Tasks processed</span><span>' + (found ? (found.taskCount || 0) : '—') + '</span></div>' +
            '<div class="connector-stat-row"><span>Last activity</span><span>' + lastActivity + '</span></div>' +
          '</div>' +
        '</div>';
      }).join('');

      // Load patterns
      loadCrossConnectorPatterns();
    });
  }

  function loadCrossConnectorPatterns() {
    api.get('/api/spark/context').then(function (data) {
      var list = document.getElementById('patterns-list');
      if (!list || !data) return;

      var patterns = data.crossConnectorPatterns || data.patterns || [];
      if (patterns.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);">No patterns detected yet</div>';
        return;
      }

      list.innerHTML = patterns.map(function (p) {
        return '<div class="pattern-card">' +
          '<div class="pattern-card-title">' + escapeHtml(p.type || p.pattern || '') + '</div>' +
          '<div class="pattern-card-body">' + escapeHtml(p.description || p.summary || '') + '</div>' +
        '</div>';
      }).join('');
    });
  }

  var refreshConnectorsBtn = document.getElementById('refresh-connectors-btn');
  if (refreshConnectorsBtn) refreshConnectorsBtn.addEventListener('click', loadConnectors);

  // ═══════════════════════════════════════════════════════════════════
  // 12. Modals
  // ═══════════════════════════════════════════════════════════════════

  function openModal(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.add('visible');
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.remove('visible');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(function (m) {
      m.classList.remove('visible');
    });
    closeSlideOver();
  }

  // Wire modal close buttons
  document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    // Close on backdrop click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.classList.remove('visible');
    });
    // Close on X button
    var closeBtn = overlay.querySelector('[id^="close-"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        overlay.classList.remove('visible');
      });
    }
  });

  // Task detail modal
  function showTaskDetail(cardEl) {
    var taskId = cardEl.dataset.id;
    var task = cachedTasks.find(function (t) { return t.id === taskId; }) || {};

    var titleEl = document.getElementById('task-detail-title-text');
    if (titleEl) titleEl.textContent = task.title || 'Task Details';

    var bodyEl = document.getElementById('task-detail-body');
    if (bodyEl) {
      bodyEl.innerHTML =
        '<div style="display:grid;grid-template-columns:120px 1fr;gap:var(--sp-2) var(--sp-4);font-size:var(--text-sm);">' +
          '<span class="label">ID</span><span class="mono">' + escapeHtml(task.id || '') + '</span>' +
          '<span class="label">Status</span><span class="status-pill ' + (task.status || 'pending') + '">' + escapeHtml(task.status || '') + '</span>' +
          '<span class="label">Source</span><span>' + escapeHtml(task.source || '') + '</span>' +
          '<span class="label">Intent</span><span>' + escapeHtml(task.intent || '') + '</span>' +
          '<span class="label">Priority</span><span>' + escapeHtml(task.priority || 'normal') + '</span>' +
          '<span class="label">Created</span><span>' + formatTime(task.createdAt) + '</span>' +
        '</div>' +
        (task.body ? '<div class="mt-4"><h4>Body</h4><p class="text-secondary mt-2" style="font-size:var(--text-sm);">' + escapeHtml(task.body) + '</p></div>' : '');
    }

    openModal('task-detail-modal');
  }

  // CORD Explainer
  function showCordExplainer(approvalId) {
    var approval = cachedApprovals.find(function (a) { return a.id === approvalId; });
    if (!approval) { showToast('Approval not found', 'error'); return; }

    api.get('/api/approvals/' + approvalId + '/cord').then(function (data) {
      var cord = data || {};
      var score = cord.score || cord.overallScore || mapRiskToScore(approval.risk);
      var decision = cord.decision || mapRiskToDecision(approval.risk);
      var dimensions = cord.dimensions || cord.breakdown || generateFallbackDimensions(approval.risk);
      var reasons = cord.reasons || cord.flags || generateFallbackReasons(approval.risk, approval.reason);

      var body = document.getElementById('cord-modal-body');
      if (body) {
        var scoreColor = score > 70 ? 'var(--red)' : score > 45 ? 'var(--yellow)' : 'var(--green)';

        var html = '<div style="text-align:center;margin-bottom:var(--sp-6);">' +
          '<div class="mono" style="font-size:var(--text-3xl);font-weight:700;color:' + scoreColor + ';">' + score + '</div>' +
          '<div class="label">CORD Risk Score</div>' +
          '<div class="status-pill mt-2" style="background:var(--accent-subtle);color:var(--accent);">' + escapeHtml(decision) + '</div>' +
        '</div>';

        if (dimensions && dimensions.length > 0) {
          html += '<h4 class="mb-4">Risk Dimensions</h4>';
          dimensions.forEach(function (d) {
            var val = d.value || d.score || 0;
            var barColor = val > 70 ? 'var(--red)' : val > 45 ? 'var(--yellow)' : 'var(--green)';
            html += '<div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2);font-size:var(--text-sm);">' +
              '<span style="width:120px;color:var(--text-secondary);">' + escapeHtml(d.name || '') + '</span>' +
              '<div style="flex:1;height:4px;background:var(--border);border-radius:var(--radius-full);overflow:hidden;">' +
                '<div style="width:' + val + '%;height:100%;background:' + barColor + ';border-radius:var(--radius-full);"></div>' +
              '</div>' +
              '<span class="mono" style="width:30px;text-align:right;color:var(--text-muted);font-size:var(--text-xs);">' + val + '</span>' +
            '</div>';
          });
        }

        if (reasons && reasons.length > 0) {
          html += '<h4 class="mt-6 mb-4">Reasons</h4>';
          reasons.forEach(function (r) {
            html += '<div style="font-size:var(--text-sm);color:var(--text-secondary);padding:var(--sp-1) 0;">\u2022 ' + escapeHtml(r) + '</div>';
          });
        }

        body.innerHTML = html;
      }
      openModal('cord-modal');
    });
  }

  function mapRiskToScore(risk) {
    return { low: 25, medium: 50, high: 72, critical: 90 }[risk] || 40;
  }
  function mapRiskToDecision(risk) {
    return { low: 'ALLOW', medium: 'CONTAIN', high: 'CHALLENGE', critical: 'BLOCK' }[risk] || 'CONTAIN';
  }
  function generateFallbackDimensions(risk) {
    var base = risk === 'critical' ? 80 : risk === 'high' ? 60 : risk === 'medium' ? 40 : 20;
    return [
      { name: 'reversibility', value: Math.min(100, base + Math.floor(Math.random() * 20)) },
      { name: 'data sensitivity', value: Math.min(100, base + Math.floor(Math.random() * 25) - 10) },
      { name: 'scope', value: Math.min(100, base + Math.floor(Math.random() * 15)) },
      { name: 'financial impact', value: Math.min(100, base + Math.floor(Math.random() * 30) - 15) },
    ];
  }
  function generateFallbackReasons(risk, reason) {
    var reasons = [];
    if (reason) reasons.push(reason);
    if (risk === 'critical' || risk === 'high') { reasons.push('Action has limited reversibility'); reasons.push('Potential for high-impact side effects'); }
    if (risk === 'medium') { reasons.push('Moderate scope of impact detected'); }
    reasons.push('Policy evaluation triggered human-in-the-loop check');
    return reasons;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 13. SSE (Real-time Approvals)
  // ═══════════════════════════════════════════════════════════════════

  function connectSSE() {
    try {
      var es = new EventSource(API_BASE + '/api/approvals/stream');
      es.onopen = function () {
        var dot = document.getElementById('status-dot');
        var text = document.getElementById('status-text');
        if (dot) dot.classList.add('connected');
        if (text) text.textContent = 'Connected';
      };
      es.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          loadApprovals();
          addActivity('warning', 'New approval request');
        } catch (err) { /* ignore */ }
      };
      es.onerror = function () {
        var dot = document.getElementById('status-dot');
        var text = document.getElementById('status-text');
        if (dot) dot.classList.remove('connected');
        if (text) text.textContent = 'Disconnected';
        es.close();
        setTimeout(connectSSE, 5000);
      };
    } catch (err) {
      var text = document.getElementById('status-text');
      if (text) text.textContent = 'Offline';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 14. Auto-refresh
  // ═══════════════════════════════════════════════════════════════════

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(function () {
      if (currentPage === 'dashboard') loadDashboard();
      else if (currentPage === 'tasks') { loadTasks(); loadApprovals(); }
    }, 15000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 15. Memory Spiral Visualization
  // ═══════════════════════════════════════════════════════════════════

  var spiralViz = null;
  var activeTypeFilters = []; // empty = all

  function loadMemoryPage() {
    // Load stats
    api.get('/api/spark/memory/stats').then(function (data) {
      if (!data) return;
      var el;
      el = document.getElementById('memory-token-count'); if (el) el.textContent = data.totalTokens || 0;
      el = document.getElementById('memory-edge-count'); if (el) el.textContent = data.totalEdges || 0;
      el = document.getElementById('memory-active-count'); if (el) el.textContent = data.activeTokens || 0;
      el = document.getElementById('memory-archived-count'); if (el) el.textContent = data.archivedTokens || 0;
    });

    // Load graph and start visualization
    loadMemoryGraph();
  }

  function loadMemoryGraph() {
    api.get('/api/spark/memory/graph').then(function (data) {
      if (!data) return;
      initSpiralViz();
      spiralViz.loadData(data);
    });
  }

  function initSpiralViz() {
    if (spiralViz) return; // Already initialized

    var canvas = document.getElementById('memory-canvas');
    if (!canvas) return;

    spiralViz = new SpiralViz(canvas, {
      onSelectToken: function (node) {
        showMemoryDetail(node);
      },
      onDeselectToken: function () {
        hideMemoryDetail();
      },
    });
  }

  function destroySpiralViz() {
    if (spiralViz) {
      spiralViz.destroy();
      spiralViz = null;
    }
    hideMemoryDetail();
  }

  // ── Memory detail panel ───────────────────────────────────────────

  function showMemoryDetail(node) {
    var panel = document.getElementById('memory-detail-panel');
    var title = document.getElementById('memory-detail-title');
    var content = document.getElementById('memory-detail-content');
    if (!panel || !content) return;

    title.textContent = capitalize(node.type) + ' Token';

    var sentimentColor = node.sentiment === 'positive' ? 'var(--green)' :
                         node.sentiment === 'negative' ? 'var(--red)' :
                         node.sentiment === 'mixed' ? 'var(--yellow)' : 'var(--text-muted)';

    var html = '';

    // Gist
    if (node.gist) {
      html += '<div class="memory-detail-gist">' + escapeHtml(node.gist) + '</div>';
    }

    // Properties
    html += '<div class="memory-detail-row"><span class="label">Type</span><span class="value">' + escapeHtml(node.type) + '</span></div>';
    html += '<div class="memory-detail-row"><span class="label">Tier</span><span class="value">' + escapeHtml(node.tier) + '</span></div>';
    html += '<div class="memory-detail-row"><span class="label">Strength</span><span class="value">' + (node.strength * 100).toFixed(1) + '%</span></div>';
    html += '<div class="memory-detail-row"><span class="label">Spiral Count</span><span class="value">' + node.spiralCount + '</span></div>';
    html += '<div class="memory-detail-row"><span class="label">Sentiment</span><span class="value" style="color:' + sentimentColor + '">' + escapeHtml(node.sentiment) + '</span></div>';

    if (node.createdAt) {
      html += '<div class="memory-detail-row"><span class="label">Created</span><span class="value">' + formatTime(node.createdAt) + '</span></div>';
    }

    // Topics
    if (node.topics && node.topics.length > 0) {
      html += '<div class="memory-detail-topics">';
      for (var i = 0; i < node.topics.length; i++) {
        html += '<span class="memory-detail-topic-tag">' + escapeHtml(node.topics[i]) + '</span>';
      }
      html += '</div>';
    }

    // Connected nodes
    if (spiralViz) {
      var connected = spiralViz._getConnectedNodes(node);
      if (connected.length > 0) {
        html += '<div class="memory-detail-connections">';
        html += '<h5>Connections (' + connected.length + ')</h5>';
        var max = Math.min(connected.length, 8);
        for (var j = 0; j < max; j++) {
          var cn = connected[j];
          html += '<div class="memory-detail-connection-item">';
          html += '<span style="color:' + (spiralViz._resolveTypeColor(cn.type, DesignTokens.colors())) + '">&bull;</span> ';
          html += escapeHtml(cn.gist || cn.type);
          html += '</div>';
        }
        if (connected.length > max) {
          html += '<div class="memory-detail-connection-item" style="color:var(--text-muted)">+' + (connected.length - max) + ' more</div>';
        }
        html += '</div>';
      }
    }

    content.innerHTML = html;
    panel.classList.add('visible');
  }

  function hideMemoryDetail() {
    var panel = document.getElementById('memory-detail-panel');
    if (panel) panel.classList.remove('visible');
  }

  // ── Memory filter chips ───────────────────────────────────────────

  var memoryFiltersEl = document.getElementById('memory-filters');
  if (memoryFiltersEl) {
    memoryFiltersEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.memory-filter-chip');
      if (!chip) return;

      var type = chip.getAttribute('data-type');

      if (type === 'all') {
        // Select "All", deselect others
        activeTypeFilters = [];
        var chips = memoryFiltersEl.querySelectorAll('.memory-filter-chip');
        for (var i = 0; i < chips.length; i++) {
          chips[i].classList.remove('active');
        }
        chip.classList.add('active');
      } else {
        // Toggle this type
        var allChip = memoryFiltersEl.querySelector('[data-type="all"]');
        if (allChip) allChip.classList.remove('active');

        var idx = activeTypeFilters.indexOf(type);
        if (idx >= 0) {
          activeTypeFilters.splice(idx, 1);
          chip.classList.remove('active');
        } else {
          activeTypeFilters.push(type);
          chip.classList.add('active');
        }

        // If no specific filters, revert to "All"
        if (activeTypeFilters.length === 0 && allChip) {
          allChip.classList.add('active');
        }
      }

      if (spiralViz) {
        spiralViz.setTypeFilter(activeTypeFilters.length > 0 ? activeTypeFilters : null);
      }
    });
  }

  // Strength slider
  var strengthSlider = document.getElementById('memory-strength-slider');
  var strengthValue = document.getElementById('memory-strength-value');
  if (strengthSlider) {
    strengthSlider.addEventListener('input', function () {
      var val = parseInt(strengthSlider.value, 10);
      if (strengthValue) strengthValue.textContent = val + '%';
      if (spiralViz) spiralViz.setMinStrength(val / 100);
    });
  }

  // ── Memory controls ──────────────────────────────────────────────

  var memoryZoomInBtn = document.getElementById('memory-zoom-in');
  var memoryZoomOutBtn = document.getElementById('memory-zoom-out');
  var memoryResetViewBtn = document.getElementById('memory-reset-view');
  var memoryDetailCloseBtn = document.getElementById('memory-detail-close');

  if (memoryZoomInBtn) memoryZoomInBtn.addEventListener('click', function () { if (spiralViz) spiralViz.zoomIn(); });
  if (memoryZoomOutBtn) memoryZoomOutBtn.addEventListener('click', function () { if (spiralViz) spiralViz.zoomOut(); });
  if (memoryResetViewBtn) memoryResetViewBtn.addEventListener('click', function () { if (spiralViz) spiralViz.resetView(); });
  if (memoryDetailCloseBtn) memoryDetailCloseBtn.addEventListener('click', hideMemoryDetail);

  // Maintenance button
  var memoryMaintenanceBtn = document.getElementById('memory-maintenance-btn');
  if (memoryMaintenanceBtn) {
    memoryMaintenanceBtn.addEventListener('click', function () {
      api.post('/api/spark/memory/maintenance').then(function (data) {
        showToast(data ? 'Maintenance pass completed' : 'Maintenance failed', data ? 'success' : 'error');
        loadMemoryPage();
      });
    });
  }

  // Refresh button
  var memoryRefreshBtn = document.getElementById('memory-refresh-btn');
  if (memoryRefreshBtn) {
    memoryRefreshBtn.addEventListener('click', function () {
      destroySpiralViz();
      loadMemoryPage();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / 60000);
      var diffHrs = Math.floor(diffMs / 3600000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHrs < 24) return diffHrs + 'h ago';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 16. Animations, Accessibility & Polish
  // ═══════════════════════════════════════════════════════════════════

  // ── Page transition animations ─────────────────────────────────────
  // Add slideUp animation to page section when it becomes active

  function animatePageIn(page) {
    var section = document.getElementById('page-' + page);
    if (!section) return;
    section.style.animation = 'none';
    section.offsetHeight; // Force reflow
    section.style.animation = 'slideUp 0.25s var(--ease-out) both';
  }

  // Patch navigateTo to include page animation
  var _origNavigateTo = navigateTo;
  // We'll call animatePageIn within a MutationObserver or after class toggle
  // Instead, add the animation class in navigateTo — we already have it, just ensure CSS handles it

  // ── Focus trapping in modals ──────────────────────────────────────

  function trapFocus(modalEl) {
    if (!modalEl) return;
    var focusable = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    function handleTab(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    modalEl._focusTrapHandler = handleTab;
    modalEl.addEventListener('keydown', handleTab);
    // Focus the first focusable element
    first.focus();
  }

  function releaseFocus(modalEl) {
    if (!modalEl || !modalEl._focusTrapHandler) return;
    modalEl.removeEventListener('keydown', modalEl._focusTrapHandler);
    delete modalEl._focusTrapHandler;
  }

  // Patch openModal / closeModal to add focus trapping
  var _origOpenModal = openModal;
  openModal = function (id) {
    _origOpenModal(id);
    var modal = document.getElementById(id);
    if (modal) {
      setTimeout(function () { trapFocus(modal); }, 50);
    }
  };

  var _origCloseModal = closeModal;
  closeModal = function (id) {
    var modal = document.getElementById(id);
    if (modal) releaseFocus(modal);
    _origCloseModal(id);
  };

  // ── IntersectionObserver — animate elements on scroll ─────────────

  function initScrollAnimations() {
    if (!('IntersectionObserver' in window)) return;
    // Check reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // Observe cards and sections that should animate in
    var targets = document.querySelectorAll('.stat-card, .glass-card, .connector-card, .approval-card, .pattern-card');
    targets.forEach(function (el) {
      el.classList.add('animate-target');
      observer.observe(el);
    });
  }

  // ── Canvas performance — pause when tab hidden ────────────────────

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      // Pause spiral viz to save CPU
      if (spiralViz && spiralViz.running) {
        spiralViz.stop();
        spiralViz._wasPaused = true;
      }
    } else {
      // Resume spiral viz if it was paused
      if (spiralViz && spiralViz._wasPaused) {
        spiralViz.start();
        spiralViz._wasPaused = false;
      }
    }
  });

  // ── Skip to content ───────────────────────────────────────────────

  var skipLink = document.getElementById('skip-to-content');
  if (skipLink) {
    skipLink.addEventListener('click', function (e) {
      e.preventDefault();
      var main = document.getElementById('main-content');
      if (main) {
        main.focus();
        main.scrollIntoView();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Health Check & Init
  // ═══════════════════════════════════════════════════════════════════

  function checkHealth() {
    api.get('/health').then(function (data) {
      var dot = document.getElementById('status-dot');
      var text = document.getElementById('status-text');
      if (data && data.status === 'ok') {
        if (dot) dot.classList.add('connected');
        if (text) text.textContent = 'Connected';
        addActivity('success', 'Connected to API (v' + (data.version || '?') + ')');
      } else {
        if (dot) dot.classList.remove('connected');
        if (text) text.textContent = 'API Offline';
      }
    });
  }

  function initDashboard() {
    checkHealth();
    initRouter();
    connectSSE();
    startAutoRefresh();
    initScrollAnimations();
  }

  // Global exports
  window.App = {
    approveWithLoading: approveWithLoading,
    confirmDeny: confirmDeny,
    showTaskDetail: showTaskDetail,
    showCordExplainer: showCordExplainer,
    showToast: showToast,
    loadConversation: loadConversation,
  };

  window.showToast = showToast;

  // Start
  checkAuthState();
})();
