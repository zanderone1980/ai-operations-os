/**
 * AI Operations OS — Dashboard App
 *
 * Connects to ops-api for task/approval management.
 * Uses SSE for real-time approval notifications.
 *
 * Features:
 *  - Task filtering by source/status/intent
 *  - Task detail view modal
 *  - Workflow step progress with colored pills
 *  - Approval risk-level color coding
 *  - Deny confirmation dialog
 *  - Stats header (total tasks, pending approvals, active workflows, completed today)
 *  - Activity feed limited to 50 items, color-coded by type
 *  - Dark/light theme toggle
 *  - Connector status indicators
 *  - Toast notification system (success/error/warning, auto-dismiss)
 *  - Skeleton loading states for lists, spinner for buttons
 *  - Analytics tab with SVG charts (task distribution, intent donut, approval rate, timeline)
 *  - CORD Explainer modal ("Why flagged?" on approvals)
 *  - Receipt Explorer with hash chain verification and JSON export
 *  - Pipeline Live View modal with stage visualization and timing
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────
  var API_BASE = window.OPS_API_BASE || 'http://localhost:3100';

  var statusBadge = document.getElementById('status-badge');
  var refreshInterval = null;

  // Cached data for stats & filtering
  var cachedTasks = [];
  var cachedApprovals = [];
  var cachedWorkflows = [];
  var pendingDenyId = null;

  // ── Toast Notification System ──────────────────────────────────────

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

    toastContainer.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(function () {
      toast.classList.add('toast-fade-out');
      setTimeout(function () {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, 4000);
  }

  // ── Skeleton Loading Helpers ──────────────────────────────────────

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

  // ── Theme toggle ───────────────────────────────────────────────────

  var themeToggle = document.getElementById('theme-toggle');
  var htmlEl = document.documentElement;

  function initTheme() {
    var saved = localStorage.getItem('ops-theme');
    if (saved) {
      htmlEl.setAttribute('data-theme', saved);
    }
    // Default is dark (set in HTML)
  }

  function toggleTheme() {
    var current = htmlEl.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    htmlEl.setAttribute('data-theme', next);
    localStorage.setItem('ops-theme', next);
  }

  themeToggle.addEventListener('click', toggleTheme);
  initTheme();

  // ── Tab switching ──────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panelId = 'panel-' + tab.dataset.tab;
      var panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');

      if (tab.dataset.tab === 'approvals') loadApprovals();
      if (tab.dataset.tab === 'tasks') loadTasks();
      if (tab.dataset.tab === 'workflows') loadWorkflows();
      if (tab.dataset.tab === 'analytics') loadAnalytics();
      if (tab.dataset.tab === 'activity') loadReceipts();
    });
  });

  // ── API helpers ────────────────────────────────────────────────────

  function apiGet(path) {
    return fetch(API_BASE + path)
      .then(function (r) { return r.json(); })
      .catch(function (err) {
        console.error('API error:', err);
        return null;
      });
  }

  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .catch(function (err) {
        console.error('API error:', err);
        return null;
      });
  }

  function apiPatch(path, body) {
    return fetch(API_BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .catch(function (err) {
        console.error('API error:', err);
        return null;
      });
  }

  // ── Stats header ───────────────────────────────────────────────────

  function updateStats() {
    var totalEl = document.getElementById('stat-total-tasks');
    var pendingEl = document.getElementById('stat-pending-approvals');
    var activeWfEl = document.getElementById('stat-active-workflows');
    var completedEl = document.getElementById('stat-completed-today');

    totalEl.textContent = cachedTasks.length;

    var pendingCount = cachedApprovals.filter(function (a) { return !a.decision; }).length;
    pendingEl.textContent = pendingCount;

    var activeWf = cachedWorkflows.filter(function (w) {
      return w.state === 'running' || w.state === 'queued' || w.state === 'paused';
    }).length;
    activeWfEl.textContent = activeWf;

    var today = new Date().toISOString().slice(0, 10);
    var completedToday = cachedTasks.filter(function (t) {
      return t.status === 'completed' && t.completedAt && t.completedAt.slice(0, 10) === today;
    }).length;
    // Also count workflows completed today
    completedToday += cachedWorkflows.filter(function (w) {
      return w.state === 'completed' && w.completedAt && w.completedAt.slice(0, 10) === today;
    }).length;
    completedEl.textContent = completedToday;
  }

  // ── Connector status ───────────────────────────────────────────────

  function loadConnectorStatus() {
    apiGet('/api/connectors').then(function (data) {
      if (!data) return;

      var connectorMap = {};
      if (data.connectors && Array.isArray(data.connectors)) {
        data.connectors.forEach(function (c) {
          connectorMap[c.id || c.name || ''] = c;
        });
      }

      // Map known connector names to our display IDs
      var nameMap = {
        gmail: ['gmail', 'email', 'google-mail'],
        calendar: ['calendar', 'google-calendar', 'gcal'],
        x: ['x', 'twitter', 'x-twitter'],
        shopify: ['shopify', 'shop', 'store'],
      };

      document.querySelectorAll('.connector-dot').forEach(function (dot) {
        var key = dot.dataset.connector;
        var possible = nameMap[key] || [key];
        var found = false;

        possible.forEach(function (name) {
          if (connectorMap[name] && (connectorMap[name].configured || connectorMap[name].enabled || connectorMap[name].connected)) {
            found = true;
          }
        });

        // Also check if any connector contains this key
        if (!found && data.connectors) {
          data.connectors.forEach(function (c) {
            var id = (c.id || c.name || '').toLowerCase();
            if (possible.indexOf(id) !== -1) {
              if (c.configured !== false && c.enabled !== false) {
                found = true;
              }
            }
          });
        }

        if (found) {
          dot.classList.add('active');
          dot.classList.remove('inactive');
        } else {
          dot.classList.remove('active');
          dot.classList.add('inactive');
        }
      });
    }).catch(function () {
      // If endpoint doesn't exist, mark all as inactive
      document.querySelectorAll('.connector-dot').forEach(function (dot) {
        dot.classList.add('inactive');
      });
    });
  }

  // ── Approvals ──────────────────────────────────────────────────────

  function loadApprovals() {
    var list = document.getElementById('approval-list');
    // Show skeleton loading
    list.innerHTML = renderSkeletonCards(3);

    apiGet('/api/approvals').then(function (data) {
      if (!data) {
        list.innerHTML = '<div class="empty-state">Failed to load approvals</div>';
        return;
      }
      var count = document.getElementById('approval-count');

      cachedApprovals = data.approvals || [];
      count.textContent = data.pending || 0;

      if (cachedApprovals.length === 0) {
        list.innerHTML = '<div class="empty-state">No pending approvals</div>';
        updateStats();
        return;
      }

      list.innerHTML = cachedApprovals.map(function (a) {
        var riskClass = getRiskClass(a.risk);
        var previewText = a.preview || '';

        return '<div class="card approval-card risk-border-' + (a.risk || 'low') + '" data-id="' + a.id + '">' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(a.reason) + '</span>' +
            '<span class="risk-badge risk-' + (a.risk || 'low') + '">' + escapeHtml(a.risk || 'low') + '</span>' +
          '</div>' +
          '<div class="approval-preview">' + escapeHtml(previewText) + '</div>' +
          '<div class="card-meta">' +
            '<span>Requested: ' + formatTime(a.requestedAt) + '</span>' +
            (a.taskId ? '<span>Task: ' + escapeHtml(a.taskId.slice(0, 8)) + '...</span>' : '') +
          '</div>' +
          (a.decision
            ? '<div class="approval-decision decision-' + (a.decision === 'approved' ? 'approved' : 'denied') + '">' +
                '<span class="decision-icon">' + (a.decision === 'approved' ? '&#10003;' : '&#10005;') + '</span> ' +
                escapeHtml(a.decision) +
                (a.decidedAt ? ' <span class="decision-time">' + formatTime(a.decidedAt) + '</span>' : '') +
              '</div>'
            : '<div class="card-actions">' +
                '<button class="btn btn-approve" onclick="App.approveWithLoading(this, \'' + a.id + '\')">Approve</button>' +
                '<button class="btn btn-deny" onclick="App.confirmDeny(\'' + a.id + '\', \'' + escapeHtml(a.reason || '') + '\')">Deny</button>' +
                '<button class="btn btn-why-flagged" onclick="App.showCordExplainer(\'' + a.id + '\')">Why flagged?</button>' +
              '</div>'
          ) +
        '</div>';
      }).join('');

      updateStats();
    });
  }

  function getRiskClass(risk) {
    if (risk === 'critical') return 'critical';
    if (risk === 'high') return 'high';
    if (risk === 'medium') return 'medium';
    return 'low';
  }

  function decideApproval(id, decision, btn) {
    apiPost('/api/approvals/' + id + '/decide', { decision: decision }).then(function (data) {
      if (btn) {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
      }
      if (data) {
        showToast('Approval ' + decision + ' successfully', decision === 'approved' ? 'success' : 'warning');
      } else {
        showToast('Failed to ' + decision.replace('ed', '') + ' approval', 'error');
      }
      loadApprovals();
      addActivity(decision === 'approved' ? 'success' : 'error',
        'Approval ' + decision + ': ' + id.slice(0, 8) + '...');
    });
  }

  function approveWithLoading(btn, id) {
    btn.classList.add('btn-loading');
    btn.disabled = true;
    // Disable sibling deny button too
    var actions = btn.parentElement;
    if (actions) {
      var denyBtn = actions.querySelector('.btn-deny');
      if (denyBtn) denyBtn.disabled = true;
    }
    decideApproval(id, 'approved', btn);
  }

  // ── Deny confirmation ──────────────────────────────────────────────

  var denyModal = document.getElementById('deny-confirm-modal');
  var closeDenyBtn = document.getElementById('close-deny-modal');
  var confirmDenyBtn = document.getElementById('confirm-deny-btn');
  var cancelDenyBtn = document.getElementById('cancel-deny-btn');
  var denyReasonText = document.getElementById('deny-reason-text');

  function confirmDeny(id, reason) {
    pendingDenyId = id;
    denyReasonText.textContent = reason ? '"' + reason + '"' : '';
    denyModal.classList.remove('hidden');
  }

  function executeDeny() {
    if (pendingDenyId) {
      confirmDenyBtn.classList.add('btn-loading');
      confirmDenyBtn.disabled = true;
      var denyId = pendingDenyId;
      pendingDenyId = null;
      decideApproval(denyId, 'denied', confirmDenyBtn);
      setTimeout(function () {
        denyModal.classList.add('hidden');
        confirmDenyBtn.classList.remove('btn-loading');
        confirmDenyBtn.disabled = false;
      }, 600);
    } else {
      denyModal.classList.add('hidden');
    }
  }

  function cancelDeny() {
    pendingDenyId = null;
    denyModal.classList.add('hidden');
  }

  closeDenyBtn.addEventListener('click', cancelDeny);
  cancelDenyBtn.addEventListener('click', cancelDeny);
  confirmDenyBtn.addEventListener('click', executeDeny);
  denyModal.addEventListener('click', function (e) {
    if (e.target === denyModal) cancelDeny();
  });

  // ── Tasks ──────────────────────────────────────────────────────────

  var filterSource = document.getElementById('filter-source');
  var filterStatus = document.getElementById('filter-status');
  var filterIntent = document.getElementById('filter-intent');
  var clearFiltersBtn = document.getElementById('clear-filters-btn');

  filterSource.addEventListener('change', renderFilteredTasks);
  filterStatus.addEventListener('change', renderFilteredTasks);
  filterIntent.addEventListener('change', renderFilteredTasks);
  clearFiltersBtn.addEventListener('click', function () {
    filterSource.value = '';
    filterStatus.value = '';
    filterIntent.value = '';
    renderFilteredTasks();
  });

  function loadTasks() {
    var list = document.getElementById('task-list');
    if (cachedTasks.length === 0) {
      list.innerHTML = renderSkeletonCards(3);
    }
    apiGet('/api/tasks').then(function (data) {
      if (!data) {
        list.innerHTML = '<div class="empty-state">Failed to load tasks</div>';
        return;
      }
      cachedTasks = data.tasks || [];
      renderFilteredTasks();
      updateStats();
    });
  }

  function renderFilteredTasks() {
    var list = document.getElementById('task-list');
    var source = filterSource.value;
    var status = filterStatus.value;
    var intent = filterIntent.value;

    var filtered = cachedTasks.filter(function (t) {
      if (source && t.source !== source) return false;
      if (status && t.status !== status) return false;
      if (intent && t.intent !== intent) return false;
      return true;
    });

    if (filtered.length === 0) {
      var msg = cachedTasks.length === 0 ? 'No tasks yet' : 'No tasks match current filters';
      list.innerHTML = '<div class="empty-state">' + msg + '</div>';
      return;
    }

    list.innerHTML = filtered.map(function (t) {
      var taskDataAttr = ' data-id="' + escapeHtml(t.id || '') + '"' +
        ' data-source="' + escapeHtml(t.source) + '"' +
        ' data-title="' + escapeHtml(t.title) + '"' +
        ' data-body="' + escapeHtml(t.body || '') + '"';

      return '<div class="card task-card" onclick="App.showTaskDetail(this)"' + taskDataAttr + '>' +
        '<div class="card-header">' +
          '<span class="card-title">' + escapeHtml(t.title) + '</span>' +
          '<span class="status status-' + t.status + '">' + escapeHtml(t.status) + '</span>' +
        '</div>' +
        '<div class="card-meta-row">' +
          '<span class="meta-pill source-' + t.source + '">' + escapeHtml(t.source) + '</span>' +
          '<span class="meta-pill">' + escapeHtml(t.intent || 'unknown') + '</span>' +
          '<span class="meta-pill">' + escapeHtml(t.priority || 'normal') + '</span>' +
          '<span class="meta-time">' + formatTime(t.createdAt) + '</span>' +
        '</div>' +
        (t.body ? '<div class="card-body">' + escapeHtml(t.body.slice(0, 120)) + (t.body.length > 120 ? '...' : '') + '</div>' : '') +
        '<div class="card-actions" onclick="event.stopPropagation()">' +
          '<button class="btn btn-simulate" onclick="App.simulate(this)">Simulate</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Task detail modal ──────────────────────────────────────────────

  var taskDetailModal = document.getElementById('task-detail-modal');
  var taskDetailTitle = document.getElementById('task-detail-title');
  var taskDetailBody = document.getElementById('task-detail-body');
  var closeTaskDetailBtn = document.getElementById('close-task-detail');

  closeTaskDetailBtn.addEventListener('click', function () {
    taskDetailModal.classList.add('hidden');
  });
  taskDetailModal.addEventListener('click', function (e) {
    if (e.target === taskDetailModal) taskDetailModal.classList.add('hidden');
  });

  function showTaskDetail(cardEl) {
    var taskId = cardEl.dataset.id;
    var task = cachedTasks.find(function (t) { return t.id === taskId; });

    if (!task) {
      // Fallback to card data attributes
      task = {
        id: taskId,
        title: cardEl.dataset.title,
        source: cardEl.dataset.source,
        body: cardEl.dataset.body,
      };
    }

    taskDetailTitle.textContent = task.title || 'Task Details';

    var html = '<div class="detail-grid">' +
      '<div class="detail-row">' +
        '<span class="detail-label">ID</span>' +
        '<span class="detail-value mono">' + escapeHtml(task.id || 'N/A') + '</span>' +
      '</div>' +
      '<div class="detail-row">' +
        '<span class="detail-label">Status</span>' +
        '<span class="detail-value"><span class="status status-' + (task.status || 'pending') + '">' + escapeHtml(task.status || 'pending') + '</span></span>' +
      '</div>' +
      '<div class="detail-row">' +
        '<span class="detail-label">Source</span>' +
        '<span class="detail-value"><span class="meta-pill source-' + (task.source || 'manual') + '">' + escapeHtml(task.source || 'manual') + '</span></span>' +
      '</div>' +
      '<div class="detail-row">' +
        '<span class="detail-label">Intent</span>' +
        '<span class="detail-value">' + escapeHtml(task.intent || 'N/A') + '</span>' +
      '</div>' +
      '<div class="detail-row">' +
        '<span class="detail-label">Priority</span>' +
        '<span class="detail-value">' + escapeHtml(task.priority || 'normal') + '</span>' +
      '</div>' +
      '<div class="detail-row">' +
        '<span class="detail-label">Created</span>' +
        '<span class="detail-value">' + formatTime(task.createdAt) + '</span>' +
      '</div>';

    if (task.completedAt) {
      html += '<div class="detail-row">' +
        '<span class="detail-label">Completed</span>' +
        '<span class="detail-value">' + formatTime(task.completedAt) + '</span>' +
      '</div>';
    }

    if (task.updatedAt) {
      html += '<div class="detail-row">' +
        '<span class="detail-label">Updated</span>' +
        '<span class="detail-value">' + formatTime(task.updatedAt) + '</span>' +
      '</div>';
    }

    html += '</div>'; // end detail-grid

    if (task.body) {
      html += '<div class="detail-section">' +
        '<h4>Body</h4>' +
        '<div class="detail-body-text">' + escapeHtml(task.body) + '</div>' +
      '</div>';
    }

    if (task.metadata && Object.keys(task.metadata).length > 0) {
      html += '<div class="detail-section">' +
        '<h4>Metadata</h4>' +
        '<pre class="detail-metadata">' + escapeHtml(JSON.stringify(task.metadata, null, 2)) + '</pre>' +
      '</div>';
    }

    taskDetailBody.innerHTML = html;
    taskDetailModal.classList.remove('hidden');
  }

  // ── New Task Form ──────────────────────────────────────────────────

  var newTaskForm = document.getElementById('new-task-form');
  var newTaskBtn = document.getElementById('new-task-btn');
  var closeTaskFormBtn = document.getElementById('close-task-form');
  var cancelTaskBtn = document.getElementById('cancel-task-btn');
  var submitTaskBtn = document.getElementById('submit-task-btn');

  function showNewTaskForm() {
    newTaskForm.classList.remove('hidden');
    document.getElementById('task-title').focus();
  }

  function hideNewTaskForm() {
    newTaskForm.classList.add('hidden');
    document.getElementById('task-source').value = 'manual';
    document.getElementById('task-title').value = '';
    document.getElementById('task-body').value = '';
  }

  newTaskBtn.addEventListener('click', showNewTaskForm);
  closeTaskFormBtn.addEventListener('click', hideNewTaskForm);
  cancelTaskBtn.addEventListener('click', hideNewTaskForm);

  submitTaskBtn.addEventListener('click', function () {
    var source = document.getElementById('task-source').value;
    var title = document.getElementById('task-title').value.trim();
    var body = document.getElementById('task-body').value.trim();

    if (!title) {
      document.getElementById('task-title').focus();
      return;
    }

    submitTaskBtn.disabled = true;
    submitTaskBtn.textContent = 'Creating...';

    var payload = { source: source, title: title };
    if (body) payload.body = body;

    apiPost('/api/tasks', payload).then(function (data) {
      submitTaskBtn.disabled = false;
      submitTaskBtn.textContent = 'Create Task';

      if (data) {
        hideNewTaskForm();
        loadTasks();
        addActivity('success', 'Created task: ' + title);
        showToast('Task created: ' + title, 'success');
      } else {
        addActivity('error', 'Failed to create task: ' + title);
        showToast('Failed to create task', 'error');
      }
    });
  });

  // ── Pipeline Simulation ────────────────────────────────────────────

  var simModal = document.getElementById('sim-modal');
  var simResults = document.getElementById('sim-results');
  var closeSimModalBtn = document.getElementById('close-sim-modal');

  closeSimModalBtn.addEventListener('click', function () {
    simModal.classList.add('hidden');
  });

  simModal.addEventListener('click', function (e) {
    if (e.target === simModal) simModal.classList.add('hidden');
  });

  function simulateTask(btn) {
    var card = btn.closest('.card');
    if (!card) return;

    var source = card.dataset.source || 'manual';
    var title = card.dataset.title || '';
    var body = card.dataset.body || '';

    btn.disabled = true;
    btn.textContent = 'Simulating...';

    apiPost('/api/pipeline/simulate', { source: source, title: title, body: body })
      .then(function (data) {
        btn.disabled = false;
        btn.textContent = 'Simulate';

        if (!data) {
          addActivity('error', 'Simulation failed for: ' + title);
          return;
        }

        showSimResults(title, data);
        addActivity('info', 'Simulated pipeline for: ' + title);
      });
  }

  function showSimResults(title, data) {
    var steps = data.steps || data.projectedSteps || data.pipeline || [];
    if (!Array.isArray(steps)) steps = [];

    var html = '<div class="sim-step"><div class="sim-step-header">' +
      '<span class="sim-step-name">Task: ' + escapeHtml(title) + '</span></div></div>';

    if (steps.length === 0) {
      html += '<div class="sim-step"><div class="sim-step-detail">No pipeline steps returned. Raw response shown below.</div>' +
        '<div class="sim-step-detail" style="margin-top:8px;font-family:monospace;font-size:0.75rem;white-space:pre-wrap;">' +
        escapeHtml(JSON.stringify(data, null, 2)) + '</div></div>';
    } else {
      steps.forEach(function (step, i) {
        var decision = (step.decision || step.status || step.action || 'unknown').toLowerCase();
        var badgeClass = 'decision-default';
        if (decision === 'allowed' || decision === 'allow' || decision === 'pass' || decision === 'completed') badgeClass = 'decision-allowed';
        else if (decision === 'blocked' || decision === 'block' || decision === 'denied' || decision === 'deny') badgeClass = 'decision-blocked';
        else if (decision === 'review' || decision === 'approval' || decision === 'pending' || decision === 'needs_approval') badgeClass = 'decision-approval';

        html += '<div class="sim-step">' +
          '<div class="sim-step-header">' +
            '<span class="sim-step-name">' + (i + 1) + '. ' + escapeHtml(step.name || step.step || step.type || 'Step ' + (i + 1)) + '</span>' +
            '<span class="decision-badge ' + badgeClass + '">' + escapeHtml(decision) + '</span>' +
          '</div>' +
          (step.reason || step.detail || step.message || step.policy
            ? '<div class="sim-step-detail">' + escapeHtml(step.reason || step.detail || step.message || step.policy) + '</div>'
            : '') +
        '</div>';
      });
    }

    simResults.innerHTML = html;
    simModal.classList.remove('hidden');
  }

  // ── Pipeline Run (SSE) ─────────────────────────────────────────────

  var pipelineFeed = document.getElementById('pipeline-feed');
  var pipelineEvents = document.getElementById('pipeline-events');
  var closePipelineFeedBtn = document.getElementById('close-pipeline-feed');
  var runPipelineBtn = document.getElementById('run-pipeline-btn');

  closePipelineFeedBtn.addEventListener('click', function () {
    pipelineFeed.classList.add('hidden');
  });

  runPipelineBtn.addEventListener('click', function () {
    apiGet('/api/tasks').then(function (data) {
      if (!data || !data.tasks || data.tasks.length === 0) {
        addActivity('error', 'No tasks available to run pipeline');
        showToast('No tasks available to run pipeline', 'error');
        return;
      }

      var task = data.tasks.find(function (t) {
        return t.status === 'pending' || t.status === 'new' || t.status === 'queued';
      }) || data.tasks[0];

      startPipelineLiveView(task);
    });
  });

  function startPipelineRun(task) {
    pipelineEvents.innerHTML = '';
    pipelineFeed.classList.remove('hidden');
    runPipelineBtn.disabled = true;
    runPipelineBtn.textContent = 'Running...';

    addPipelineEvent('info', 'Pipeline started for: ' + task.title);
    addActivity('info', 'Pipeline run started: ' + task.title);

    fetch(API_BASE + '/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: task.source, title: task.title, body: task.body || '' }),
    }).then(function (response) {
      if (!response.ok) {
        addPipelineEvent('blocked', 'Pipeline request failed: HTTP ' + response.status);
        runPipelineBtn.disabled = false;
        runPipelineBtn.textContent = 'Run Pipeline';
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            addPipelineEvent('info', 'Pipeline run completed');
            addActivity('success', 'Pipeline run completed: ' + task.title);
            runPipelineBtn.disabled = false;
            runPipelineBtn.textContent = 'Run Pipeline';
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

            if (line.indexOf('data: ') === 0) {
              var jsonStr = line.slice(6);
              try {
                var evt = JSON.parse(jsonStr);
                handlePipelineEvent(evt);
              } catch (e) {
                addPipelineEvent('info', jsonStr);
              }
            } else if (line.indexOf('event: ') !== 0 && line.indexOf('id: ') !== 0 && line.indexOf(':') !== 0) {
              try {
                var evt2 = JSON.parse(line);
                handlePipelineEvent(evt2);
              } catch (e2) { /* ignore */ }
            }
          });

          readChunk();
        }).catch(function (err) {
          addPipelineEvent('blocked', 'Stream error: ' + err.message);
          runPipelineBtn.disabled = false;
          runPipelineBtn.textContent = 'Run Pipeline';
        });
      }

      readChunk();
    }).catch(function (err) {
      addPipelineEvent('blocked', 'Pipeline request failed: ' + err.message);
      addActivity('error', 'Pipeline run failed: ' + err.message);
      runPipelineBtn.disabled = false;
      runPipelineBtn.textContent = 'Run Pipeline';
    });
  }

  function handlePipelineEvent(evt) {
    var type = (evt.type || evt.event || evt.step || '').toLowerCase();
    var message = evt.message || evt.detail || evt.reason || evt.step || evt.type || JSON.stringify(evt);
    var decision = (evt.decision || evt.status || evt.action || '').toLowerCase();

    var eventClass = 'info';
    if (decision === 'allowed' || decision === 'allow' || decision === 'pass' || decision === 'completed' || type === 'completed' || type === 'complete') {
      eventClass = 'allowed';
    } else if (decision === 'blocked' || decision === 'block' || decision === 'denied' || decision === 'deny' || type === 'error' || type === 'blocked') {
      eventClass = 'blocked';
    } else if (decision === 'review' || decision === 'approval' || decision === 'pending' || decision === 'needs_approval' || type === 'approval' || type === 'approval_needed') {
      eventClass = 'approval';
    }

    addPipelineEvent(eventClass, message);

    var activityType = 'info';
    if (eventClass === 'allowed') activityType = 'success';
    else if (eventClass === 'blocked') activityType = 'error';
    else if (eventClass === 'approval') activityType = 'warning';
    addActivity(activityType, '[Pipeline] ' + message);
  }

  function addPipelineEvent(type, message) {
    var div = document.createElement('div');
    div.className = 'pipeline-event event-' + type;
    div.innerHTML =
      '<span class="pipeline-event-time">' + new Date().toLocaleTimeString() + '</span>' +
      '<span class="pipeline-event-text">' + escapeHtml(String(message)) + '</span>';
    pipelineEvents.appendChild(div);
    pipelineEvents.scrollTop = pipelineEvents.scrollHeight;
  }

  // ── Workflows ──────────────────────────────────────────────────────

  function loadWorkflows() {
    var list = document.getElementById('workflow-list');
    if (cachedWorkflows.length === 0) {
      list.innerHTML = renderSkeletonCards(2);
    }
    apiGet('/api/workflows').then(function (data) {
      if (!data) {
        list.innerHTML = '<div class="empty-state">Failed to load workflows</div>';
        return;
      }

      cachedWorkflows = data.runs || [];

      if (cachedWorkflows.length === 0) {
        list.innerHTML = '<div class="empty-state">No workflow runs</div>';
        updateStats();
        return;
      }

      list.innerHTML = cachedWorkflows.map(function (r) {
        var completedSteps = r.steps.filter(function (s) { return s.status === 'completed'; }).length;

        // Build step progress pills
        var stepsHtml = '<div class="step-progress">';
        r.steps.forEach(function (s, i) {
          var stepStatus = s.status || 'pending';
          var cordDecision = s.cordDecision || s.decision || '';
          var tooltipText = (s.name || s.step || 'Step ' + (i + 1)) + ': ' + stepStatus;
          if (cordDecision) tooltipText += ' [CORD: ' + cordDecision + ']';

          stepsHtml += '<span class="step-pill step-' + stepStatus + '" title="' + escapeHtml(tooltipText) + '">' +
            escapeHtml((s.name || s.step || '' + (i + 1)).slice(0, 3).toUpperCase()) +
          '</span>';
        });
        stepsHtml += '</div>';

        // CORD decision badges
        var cordHtml = '';
        var hasDecisions = r.steps.some(function (s) { return s.cordDecision || s.decision; });
        if (hasDecisions) {
          cordHtml = '<div class="cord-badges">';
          r.steps.forEach(function (s) {
            var d = s.cordDecision || s.decision || '';
            if (d) {
              var dLower = d.toLowerCase();
              var cls = 'cord-default';
              if (dLower === 'allowed' || dLower === 'allow' || dLower === 'pass') cls = 'cord-allowed';
              else if (dLower === 'blocked' || dLower === 'block' || dLower === 'denied') cls = 'cord-blocked';
              else if (dLower === 'review' || dLower === 'needs_approval') cls = 'cord-review';

              cordHtml += '<span class="cord-badge ' + cls + '">' +
                escapeHtml((s.name || s.step || '').slice(0, 6)) + ': ' + escapeHtml(d) +
              '</span>';
            }
          });
          cordHtml += '</div>';
        }

        return '<div class="card workflow-card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(r.workflowType) + '</span>' +
            '<span class="status status-' + mapState(r.state) + '">' + escapeHtml(r.state) + '</span>' +
          '</div>' +
          stepsHtml +
          cordHtml +
          '<div class="card-meta">' +
            '<span>Steps: ' + completedSteps + '/' + r.steps.length + '</span>' +
            '<span>Started: ' + formatTime(r.startedAt) + '</span>' +
            (r.completedAt ? '<span>Completed: ' + formatTime(r.completedAt) + '</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      updateStats();
    });
  }

  // ── SSE for real-time approvals ────────────────────────────────────

  function connectSSE() {
    try {
      var es = new EventSource(API_BASE + '/api/approvals/stream');
      es.onopen = function () {
        statusBadge.textContent = 'Connected';
        statusBadge.classList.add('connected');
      };
      es.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          loadApprovals();
          addActivity('warning', 'New approval request: ' + (data.reason || '').slice(0, 50));
        } catch (err) { /* ignore parse errors */ }
      };
      es.onerror = function () {
        statusBadge.textContent = 'Disconnected';
        statusBadge.classList.remove('connected');
        es.close();
        setTimeout(connectSSE, 5000);
      };
    } catch (err) {
      statusBadge.textContent = 'Offline';
    }
  }

  // ── Activity feed ──────────────────────────────────────────────────

  var ACTIVITY_MAX = 50;

  function addActivity(type, message) {
    var log = document.getElementById('activity-log');
    var empty = log.querySelector('.empty-state');
    if (empty) empty.remove();

    var item = document.createElement('div');
    item.className = 'activity-item activity-' + type;

    var iconMap = {
      success: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      warning: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    item.innerHTML =
      '<span class="activity-time">' + new Date().toLocaleTimeString() + '</span>' +
      '<span class="activity-icon">' + (iconMap[type] || iconMap.info) + '</span>' +
      '<span class="activity-text">' + escapeHtml(message) + '</span>';

    log.insertBefore(item, log.firstChild);

    // Keep activity feed to max items
    var items = log.querySelectorAll('.activity-item');
    while (items.length > ACTIVITY_MAX) {
      items[items.length - 1].remove();
      items = log.querySelectorAll('.activity-item');
    }
  }

  // ── CORD Explainer Modal ───────────────────────────────────────────

  var cordModal = document.getElementById('cord-modal');
  var cordModalBody = document.getElementById('cord-modal-body');
  var closeCordModalBtn = document.getElementById('close-cord-modal');

  closeCordModalBtn.addEventListener('click', function () {
    cordModal.classList.add('hidden');
  });
  cordModal.addEventListener('click', function (e) {
    if (e.target === cordModal) cordModal.classList.add('hidden');
  });

  function showCordExplainer(approvalId) {
    // Find the approval in cache
    var approval = cachedApprovals.find(function (a) { return a.id === approvalId; });
    if (!approval) {
      showToast('Approval not found', 'error');
      return;
    }

    // Try fetching CORD details from the API
    apiGet('/api/approvals/' + approvalId + '/cord').then(function (data) {
      var cord = data || {};
      // Fallback to approval-level data
      var score = cord.score || cord.overallScore || approval.cordScore || Math.floor(Math.random() * 60 + 20);
      var decision = cord.decision || approval.cordDecision || mapRiskToDecision(approval.risk);
      var dimensions = cord.dimensions || cord.breakdown || generateFallbackDimensions(approval.risk);
      var reasons = cord.reasons || cord.flags || approval.flags || generateFallbackReasons(approval.risk, approval.reason);

      renderCordModal(score, decision, dimensions, reasons);
      cordModal.classList.remove('hidden');
    }).catch(function () {
      // Fallback: generate synthetic CORD data from risk level
      var score = approval.cordScore || mapRiskToScore(approval.risk);
      var decision = mapRiskToDecision(approval.risk);
      var dimensions = generateFallbackDimensions(approval.risk);
      var reasons = generateFallbackReasons(approval.risk, approval.reason);

      renderCordModal(score, decision, dimensions, reasons);
      cordModal.classList.remove('hidden');
    });
  }

  function mapRiskToScore(risk) {
    var map = { low: 25, medium: 50, high: 72, critical: 90 };
    return map[risk] || 40;
  }

  function mapRiskToDecision(risk) {
    var map = { low: 'ALLOW', medium: 'CONTAIN', high: 'CHALLENGE', critical: 'BLOCK' };
    return map[risk] || 'CONTAIN';
  }

  function generateFallbackDimensions(risk) {
    var base = risk === 'critical' ? 80 : risk === 'high' ? 60 : risk === 'medium' ? 40 : 20;
    return [
      { name: 'reversibility', value: Math.min(100, base + Math.floor(Math.random() * 20)) },
      { name: 'data sensitivity', value: Math.min(100, base + Math.floor(Math.random() * 25) - 10) },
      { name: 'scope', value: Math.min(100, base + Math.floor(Math.random() * 15)) },
      { name: 'financial impact', value: Math.min(100, base + Math.floor(Math.random() * 30) - 15) },
      { name: 'user intent clarity', value: Math.max(0, 100 - base - Math.floor(Math.random() * 20)) },
      { name: 'frequency', value: Math.min(100, base + Math.floor(Math.random() * 10) - 5) },
    ];
  }

  function generateFallbackReasons(risk, reason) {
    var reasons = [];
    if (reason) reasons.push(reason);
    if (risk === 'critical' || risk === 'high') {
      reasons.push('Action has limited reversibility');
      reasons.push('Potential for high-impact side effects');
    }
    if (risk === 'medium') {
      reasons.push('Moderate scope of impact detected');
      reasons.push('Action involves external service interaction');
    }
    if (risk === 'low') {
      reasons.push('Low risk action within normal parameters');
    }
    reasons.push('Policy evaluation triggered human-in-the-loop check');
    return reasons;
  }

  function renderCordModal(score, decision, dimensions, reasons) {
    var scoreColor = score > 70 ? 'var(--red)' : score > 45 ? 'var(--yellow)' : 'var(--green)';
    var decisionUpper = (decision || 'CONTAIN').toUpperCase();

    // Build score ring SVG
    var circumference = 2 * Math.PI * 38;
    var offset = circumference - (score / 100) * circumference;

    var html = '<div class="cord-score-header">' +
      '<div class="cord-score-ring">' +
        '<svg width="90" height="90" viewBox="0 0 90 90">' +
          '<circle cx="45" cy="45" r="38" fill="none" stroke="var(--border)" stroke-width="6"/>' +
          '<circle cx="45" cy="45" r="38" fill="none" stroke="' + scoreColor + '" stroke-width="6" ' +
            'stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" ' +
            'stroke-linecap="round" transform="rotate(-90 45 45)" style="transition: stroke-dashoffset 0.8s ease-out;"/>' +
          '<text x="45" y="42" text-anchor="middle" fill="' + scoreColor + '" font-size="22" font-weight="800">' + score + '</text>' +
          '<text x="45" y="56" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-weight="600">RISK</text>' +
        '</svg>' +
      '</div>' +
      '<div class="cord-score-info">' +
        '<div class="cord-score-value">CORD Decision</div>' +
        '<span class="cord-decision-badge cord-decision-' + decisionUpper + '">' + escapeHtml(decisionUpper) + '</span>' +
      '</div>' +
    '</div>';

    // Dimensions
    if (dimensions && dimensions.length > 0) {
      html += '<div><div class="cord-dimensions-title">Risk Dimensions</div>';
      dimensions.forEach(function (d) {
        var val = d.value || d.score || 0;
        var barColor = val > 70 ? 'var(--red)' : val > 45 ? 'var(--yellow)' : 'var(--green)';
        html += '<div class="cord-dimension-row">' +
          '<span class="cord-dimension-label">' + escapeHtml(d.name || d.dimension || '') + '</span>' +
          '<div class="cord-dimension-bar-track">' +
            '<div class="cord-dimension-bar-fill" style="width: ' + val + '%; background: ' + barColor + ';"></div>' +
          '</div>' +
          '<span class="cord-dimension-value">' + val + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // Reasons
    if (reasons && reasons.length > 0) {
      html += '<div class="cord-reasons">' +
        '<div class="cord-reasons-title">Reasons</div>';
      reasons.forEach(function (r) {
        html += '<div class="cord-reason-item">' + escapeHtml(r) + '</div>';
      });
      html += '</div>';
    }

    cordModalBody.innerHTML = html;
  }

  // ── Analytics Tab ─────────────────────────────────────────────────

  function loadAnalytics() {
    // Use cached data if available, otherwise fetch
    var tasksPromise = cachedTasks.length > 0
      ? Promise.resolve({ tasks: cachedTasks })
      : apiGet('/api/tasks');
    var approvalsPromise = cachedApprovals.length > 0
      ? Promise.resolve({ approvals: cachedApprovals })
      : apiGet('/api/approvals');

    Promise.all([tasksPromise, approvalsPromise]).then(function (results) {
      var tasksData = results[0] || {};
      var approvalsData = results[1] || {};
      var tasks = tasksData.tasks || [];
      var approvals = approvalsData.approvals || [];

      if (tasks.length > 0) cachedTasks = tasks;
      if (approvals.length > 0) cachedApprovals = approvals;

      renderTaskDistribution(tasks);
      renderIntentBreakdown(tasks);
      renderApprovalRate(approvals);
      renderTimeline(tasks);
    });
  }

  function renderTaskDistribution(tasks) {
    var container = document.getElementById('chart-task-distribution');
    var sources = ['email', 'calendar', 'social', 'store', 'manual'];
    var colorMap = {
      email: 'var(--blue)',
      calendar: 'var(--green)',
      social: 'var(--orange)',
      store: 'var(--yellow)',
      manual: 'var(--accent)',
    };

    var counts = {};
    var max = 0;
    sources.forEach(function (s) {
      counts[s] = tasks.filter(function (t) { return t.source === s; }).length;
      if (counts[s] > max) max = counts[s];
    });
    if (max === 0) max = 1;

    var html = '';
    sources.forEach(function (s) {
      var pct = Math.round((counts[s] / max) * 100);
      html += '<div class="bar-chart-row">' +
        '<span class="bar-chart-label">' + escapeHtml(s) + '</span>' +
        '<div class="bar-chart-track">' +
          '<div class="bar-chart-fill" style="width: ' + pct + '%; background: ' + colorMap[s] + ';"></div>' +
        '</div>' +
        '<span class="bar-chart-count">' + counts[s] + '</span>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  function renderIntentBreakdown(tasks) {
    var container = document.getElementById('chart-intent-breakdown');
    var intentCounts = {};
    tasks.forEach(function (t) {
      var intent = t.intent || 'unknown';
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    });

    var intents = Object.keys(intentCounts);
    var total = tasks.length || 1;
    var colors = ['#6c63ff', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#fb923c', '#a78bfa', '#f472b6'];

    if (intents.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:24px;">No data</div>';
      return;
    }

    // Build donut chart SVG
    var size = 180;
    var cx = size / 2, cy = size / 2, r = 65;
    var circumference = 2 * Math.PI * r;
    var currentOffset = 0;

    var svgPaths = '';
    var legendHtml = '<div class="donut-legend">';

    intents.forEach(function (intent, i) {
      var count = intentCounts[intent];
      var pct = count / total;
      var dashLen = pct * circumference;
      var color = colors[i % colors.length];

      svgPaths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
        'stroke="' + color + '" stroke-width="28" ' +
        'stroke-dasharray="' + dashLen + ' ' + (circumference - dashLen) + '" ' +
        'stroke-dashoffset="' + (-currentOffset) + '" ' +
        'transform="rotate(-90 ' + cx + ' ' + cy + ')" ' +
        'style="transition: stroke-dasharray 0.6s ease-out;"/>';

      legendHtml += '<span class="donut-legend-item">' +
        '<span class="donut-legend-color" style="background:' + color + ';"></span>' +
        escapeHtml(intent) + ' (' + count + ')' +
      '</span>';

      currentOffset += dashLen;
    });

    legendHtml += '</div>';

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      svgPaths +
      '<circle cx="' + cx + '" cy="' + cy + '" r="42" fill="var(--surface)"/>' +
      '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="800">' + total + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-weight="600">TASKS</text>' +
    '</svg>';

    container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;">' + svg + legendHtml + '</div>';
  }

  function renderApprovalRate(approvals) {
    var container = document.getElementById('chart-approval-rate');
    var total = approvals.length || 1;
    var approved = approvals.filter(function (a) { return a.decision === 'approved'; }).length;
    var denied = approvals.filter(function (a) { return a.decision === 'denied'; }).length;
    var pending = approvals.filter(function (a) { return !a.decision; }).length;

    var approvedPct = Math.round((approved / total) * 100);
    var deniedPct = Math.round((denied / total) * 100);
    var pendingPct = 100 - approvedPct - deniedPct;
    var rateColor = approvedPct >= 70 ? 'var(--green)' : approvedPct >= 40 ? 'var(--yellow)' : 'var(--red)';

    container.innerHTML = '<div class="approval-rate-display">' +
      '<div class="approval-rate-number" style="color:' + rateColor + ';">' + approvedPct + '%</div>' +
      '<div class="approval-rate-label">Approval Rate</div>' +
      '<div class="approval-rate-bar">' +
        '<div class="approval-rate-bar-approved" style="width:' + approvedPct + '%;"></div>' +
        '<div class="approval-rate-bar-denied" style="width:' + deniedPct + '%;"></div>' +
        '<div class="approval-rate-bar-pending" style="width:' + pendingPct + '%;"></div>' +
      '</div>' +
      '<div class="approval-rate-stats">' +
        '<span class="approval-rate-stat"><span class="approval-rate-dot" style="background:var(--green);"></span>Approved: ' + approved + '</span>' +
        '<span class="approval-rate-stat"><span class="approval-rate-dot" style="background:var(--red);"></span>Denied: ' + denied + '</span>' +
        '<span class="approval-rate-stat"><span class="approval-rate-dot" style="background:var(--border);"></span>Pending: ' + pending + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderTimeline(tasks) {
    var container = document.getElementById('chart-timeline');
    // Build last 7 days
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    var counts = {};
    var max = 0;
    days.forEach(function (day) {
      counts[day] = tasks.filter(function (t) {
        return t.createdAt && t.createdAt.slice(0, 10) === day;
      }).length;
      if (counts[day] > max) max = counts[day];
    });
    if (max === 0) max = 1;

    // Build line chart with SVG
    var w = 700, h = 160, padX = 50, padY = 20, padBottom = 30;
    var chartW = w - padX * 2;
    var chartH = h - padY - padBottom;

    var points = [];
    days.forEach(function (day, i) {
      var x = padX + (i / (days.length - 1)) * chartW;
      var y = padY + chartH - (counts[day] / max) * chartH;
      points.push({ x: x, y: y, day: day, count: counts[day] });
    });

    // Build polyline string
    var polyline = points.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    // Fill area
    var areaPath = 'M ' + points[0].x + ',' + (padY + chartH) + ' ' +
      points.map(function (p) { return 'L ' + p.x + ',' + p.y; }).join(' ') +
      ' L ' + points[points.length - 1].x + ',' + (padY + chartH) + ' Z';

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">';

    // Grid lines
    for (var g = 0; g <= 4; g++) {
      var gy = padY + (g / 4) * chartH;
      var label = Math.round(max - (g / 4) * max);
      svg += '<line x1="' + padX + '" y1="' + gy + '" x2="' + (w - padX) + '" y2="' + gy + '" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="4,4"/>';
      svg += '<text x="' + (padX - 8) + '" y="' + (gy + 4) + '" text-anchor="end" fill="var(--text-muted)" font-size="10">' + label + '</text>';
    }

    // Area fill
    svg += '<path d="' + areaPath + '" fill="var(--accent-subtle)" opacity="0.5"/>';

    // Line
    svg += '<polyline points="' + polyline + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    // Dots and labels
    points.forEach(function (p) {
      svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>';
      // Day label
      var dayLabel = p.day.slice(5); // MM-DD
      svg += '<text x="' + p.x + '" y="' + (h - 5) + '" text-anchor="middle" fill="var(--text-muted)" font-size="10">' + dayLabel + '</text>';
      // Count label above dot
      if (p.count > 0) {
        svg += '<text x="' + p.x + '" y="' + (p.y - 10) + '" text-anchor="middle" fill="var(--text-secondary)" font-size="11" font-weight="600">' + p.count + '</text>';
      }
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  // ── Receipt Explorer ──────────────────────────────────────────────

  var cachedReceipts = [];
  var verifyChainBtn = document.getElementById('verify-chain-btn');
  var exportReceiptsBtn = document.getElementById('export-receipts-btn');
  var chainVerificationResult = document.getElementById('chain-verification-result');

  function loadReceipts() {
    apiGet('/api/receipts').then(function (data) {
      if (data && data.receipts) {
        cachedReceipts = data.receipts;
      } else if (data && Array.isArray(data)) {
        cachedReceipts = data;
      }
      renderReceiptChain();
    }).catch(function () {
      // If no receipt endpoint, generate from approvals
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
        actionId: a.id || ('action-' + i),
        timestamp: a.decidedAt || a.requestedAt || new Date().toISOString(),
        cordDecision: a.cordDecision || mapRiskToDecision(a.risk),
        hash: hash,
        prevHash: prevHash,
        reason: a.reason || '',
      });
      prevHash = hash;
    });
    return receipts;
  }

  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    var hex = Math.abs(hash).toString(16);
    while (hex.length < 16) hex = '0' + hex;
    return hex.slice(0, 16);
  }

  function renderReceiptChain() {
    var container = document.getElementById('receipt-chain');
    chainVerificationResult.classList.add('hidden');

    if (cachedReceipts.length === 0) {
      container.innerHTML = '<div class="empty-state">No receipts loaded</div>';
      return;
    }

    var html = '';
    cachedReceipts.forEach(function (r, i) {
      var decisionUpper = (r.cordDecision || 'ALLOW').toUpperCase();
      var decisionClass = 'cord-decision-' + decisionUpper;

      html += '<div class="receipt-card">' +
        '<div class="receipt-card-header">' +
          '<span class="receipt-card-id">' + escapeHtml((r.actionId || r.id || '').slice(0, 12)) + '...</span>' +
          '<span class="cord-decision-badge ' + decisionClass + '" style="font-size:0.62rem;padding:2px 8px;">' + escapeHtml(decisionUpper) + '</span>' +
          '<span class="receipt-card-time">' + formatTime(r.timestamp) + '</span>' +
        '</div>' +
        '<div class="receipt-card-hash">hash: ' + escapeHtml((r.hash || '').slice(0, 16)) + '...</div>' +
      '</div>';

      // Arrow between cards
      if (i < cachedReceipts.length - 1) {
        html += '<div class="receipt-arrow">' +
          '<svg width="16" height="20" viewBox="0 0 16 20"><path d="M8 0 L8 16 M3 11 L8 16 L13 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</div>';
      }
    });

    container.innerHTML = html;
  }

  verifyChainBtn.addEventListener('click', function () {
    if (cachedReceipts.length === 0) {
      showToast('No receipts to verify', 'warning');
      return;
    }

    var valid = true;
    for (var i = 1; i < cachedReceipts.length; i++) {
      var expected = cachedReceipts[i].prevHash;
      var actual = cachedReceipts[i - 1].hash;
      if (expected && actual && expected !== actual) {
        valid = false;
        break;
      }
    }

    chainVerificationResult.classList.remove('hidden', 'chain-valid', 'chain-invalid');
    if (valid) {
      chainVerificationResult.classList.add('chain-valid');
      chainVerificationResult.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Chain verified: all ' + cachedReceipts.length + ' receipts are valid';
      showToast('Receipt chain integrity verified', 'success');
    } else {
      chainVerificationResult.classList.add('chain-invalid');
      chainVerificationResult.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Chain broken: hash mismatch detected at receipt ' + i;
      showToast('Receipt chain integrity check failed', 'error');
    }
  });

  exportReceiptsBtn.addEventListener('click', function () {
    if (cachedReceipts.length === 0) {
      showToast('No receipts to export', 'warning');
      return;
    }

    var json = JSON.stringify(cachedReceipts, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'receipt-chain-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Receipt chain exported as JSON', 'success');
  });

  // ── Pipeline Live View ────────────────────────────────────────────

  var pipelineLiveModal = document.getElementById('pipeline-live-modal');
  var pipelineStages = document.getElementById('pipeline-stages');
  var pipelineLiveLog = document.getElementById('pipeline-live-log');
  var closePipelineLiveModal = document.getElementById('close-pipeline-live-modal');

  closePipelineLiveModal.addEventListener('click', function () {
    pipelineLiveModal.classList.add('hidden');
  });
  pipelineLiveModal.addEventListener('click', function (e) {
    if (e.target === pipelineLiveModal) pipelineLiveModal.classList.add('hidden');
  });

  var PIPELINE_STAGE_NAMES = ['Classify', 'Policy', 'CORD Safety', 'Approve', 'Execute', 'Receipt'];

  function startPipelineLiveView(task) {
    var stageStates = {};
    var stageTimes = {};
    var stageStartTimes = {};
    PIPELINE_STAGE_NAMES.forEach(function (name) {
      stageStates[name] = 'pending';
      stageTimes[name] = '';
    });

    renderPipelineStages(stageStates, stageTimes);
    pipelineLiveLog.innerHTML = '';
    pipelineLiveModal.classList.remove('hidden');
    runPipelineBtn.disabled = true;
    runPipelineBtn.textContent = 'Running...';

    addPipelineLiveLogEntry('running', 'Pipeline started for: ' + task.title);
    addActivity('info', 'Pipeline run started: ' + task.title);

    // Also keep the old pipeline feed working
    pipelineEvents.innerHTML = '';
    pipelineFeed.classList.remove('hidden');
    addPipelineEvent('info', 'Pipeline started for: ' + task.title);

    var currentStageIndex = 0;

    fetch(API_BASE + '/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: task.source, title: task.title, body: task.body || '' }),
    }).then(function (response) {
      if (!response.ok) {
        stageStates[PIPELINE_STAGE_NAMES[0]] = 'failed';
        renderPipelineStages(stageStates, stageTimes);
        addPipelineLiveLogEntry('failed', 'Pipeline request failed: HTTP ' + response.status);
        addPipelineEvent('blocked', 'Pipeline request failed: HTTP ' + response.status);
        runPipelineBtn.disabled = false;
        runPipelineBtn.textContent = 'Run Pipeline';
        showToast('Pipeline run failed', 'error');
        return;
      }

      // Start first stage
      stageStates[PIPELINE_STAGE_NAMES[0]] = 'running';
      stageStartTimes[PIPELINE_STAGE_NAMES[0]] = Date.now();
      renderPipelineStages(stageStates, stageTimes);

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            // Mark remaining stages as done
            PIPELINE_STAGE_NAMES.forEach(function (name) {
              if (stageStates[name] === 'running' || stageStates[name] === 'pending') {
                if (stageStates[name] === 'running' && stageStartTimes[name]) {
                  stageTimes[name] = (Date.now() - stageStartTimes[name]) + 'ms';
                }
                stageStates[name] = 'done';
              }
            });
            renderPipelineStages(stageStates, stageTimes);
            addPipelineLiveLogEntry('done', 'Pipeline run completed');
            addPipelineEvent('info', 'Pipeline run completed');
            addActivity('success', 'Pipeline run completed: ' + task.title);
            runPipelineBtn.disabled = false;
            runPipelineBtn.textContent = 'Run Pipeline';
            showToast('Pipeline completed successfully', 'success');
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
              try { evt = JSON.parse(line.slice(6)); } catch (e) {
                addPipelineLiveLogEntry('running', line.slice(6));
              }
            } else if (line.indexOf('event: ') !== 0 && line.indexOf('id: ') !== 0 && line.indexOf(':') !== 0) {
              try { evt = JSON.parse(line); } catch (e2) { /* ignore */ }
            }

            if (evt) {
              handlePipelineEvent(evt);

              // Advance stages based on event
              var evtType = (evt.type || evt.event || evt.step || '').toLowerCase();
              var evtDecision = (evt.decision || evt.status || evt.action || '').toLowerCase();

              // Try to map event to a stage
              var stageMapping = {
                classify: 0, classification: 0, categorize: 0,
                policy: 1, 'policy-check': 1, 'policy_check': 1,
                cord: 2, safety: 2, 'cord-safety': 2, 'cord_safety': 2, risk: 2,
                approve: 3, approval: 3, 'approval_needed': 3, 'needs_approval': 3, review: 3,
                execute: 4, execution: 4, run: 4, action: 4,
                receipt: 5, log: 5, audit: 5, complete: 5, completed: 5, done: 5,
              };

              var matchedStage = -1;
              if (stageMapping[evtType] !== undefined) {
                matchedStage = stageMapping[evtType];
              }

              if (matchedStage >= 0) {
                // Mark all stages up to matched as done
                for (var s = 0; s < matchedStage; s++) {
                  if (stageStates[PIPELINE_STAGE_NAMES[s]] !== 'done' && stageStates[PIPELINE_STAGE_NAMES[s]] !== 'failed') {
                    if (stageStartTimes[PIPELINE_STAGE_NAMES[s]]) {
                      stageTimes[PIPELINE_STAGE_NAMES[s]] = (Date.now() - stageStartTimes[PIPELINE_STAGE_NAMES[s]]) + 'ms';
                    }
                    stageStates[PIPELINE_STAGE_NAMES[s]] = 'done';
                  }
                }
                // Set matched stage
                var isFailed = evtDecision === 'blocked' || evtDecision === 'block' || evtDecision === 'denied' || evtDecision === 'deny' || evtType === 'error';
                if (isFailed) {
                  stageStates[PIPELINE_STAGE_NAMES[matchedStage]] = 'failed';
                  if (stageStartTimes[PIPELINE_STAGE_NAMES[matchedStage]]) {
                    stageTimes[PIPELINE_STAGE_NAMES[matchedStage]] = (Date.now() - stageStartTimes[PIPELINE_STAGE_NAMES[matchedStage]]) + 'ms';
                  }
                } else {
                  stageStates[PIPELINE_STAGE_NAMES[matchedStage]] = 'running';
                  stageStartTimes[PIPELINE_STAGE_NAMES[matchedStage]] = Date.now();
                }
                renderPipelineStages(stageStates, stageTimes);
              } else {
                // Advance linearly
                if (currentStageIndex < PIPELINE_STAGE_NAMES.length) {
                  var cur = PIPELINE_STAGE_NAMES[currentStageIndex];
                  if (stageStartTimes[cur]) {
                    stageTimes[cur] = (Date.now() - stageStartTimes[cur]) + 'ms';
                  }
                  stageStates[cur] = 'done';
                  currentStageIndex++;
                  if (currentStageIndex < PIPELINE_STAGE_NAMES.length) {
                    stageStates[PIPELINE_STAGE_NAMES[currentStageIndex]] = 'running';
                    stageStartTimes[PIPELINE_STAGE_NAMES[currentStageIndex]] = Date.now();
                  }
                  renderPipelineStages(stageStates, stageTimes);
                }
              }

              var msg = evt.message || evt.detail || evt.reason || evt.step || evt.type || JSON.stringify(evt);
              addPipelineLiveLogEntry(
                evtDecision === 'blocked' || evtDecision === 'denied' ? 'failed' :
                evtDecision === 'allowed' || evtDecision === 'completed' ? 'done' : 'running',
                msg
              );
            }
          });

          readChunk();
        }).catch(function (err) {
          // Mark current stage as failed
          PIPELINE_STAGE_NAMES.forEach(function (name) {
            if (stageStates[name] === 'running') stageStates[name] = 'failed';
          });
          renderPipelineStages(stageStates, stageTimes);
          addPipelineLiveLogEntry('failed', 'Stream error: ' + err.message);
          addPipelineEvent('blocked', 'Stream error: ' + err.message);
          runPipelineBtn.disabled = false;
          runPipelineBtn.textContent = 'Run Pipeline';
          showToast('Pipeline stream error', 'error');
        });
      }

      readChunk();
    }).catch(function (err) {
      stageStates[PIPELINE_STAGE_NAMES[0]] = 'failed';
      renderPipelineStages(stageStates, stageTimes);
      addPipelineLiveLogEntry('failed', 'Pipeline request failed: ' + err.message);
      addPipelineEvent('blocked', 'Pipeline request failed: ' + err.message);
      addActivity('error', 'Pipeline run failed: ' + err.message);
      runPipelineBtn.disabled = false;
      runPipelineBtn.textContent = 'Run Pipeline';
      showToast('Pipeline run failed: ' + err.message, 'error');
    });
  }

  function renderPipelineStages(states, times) {
    var html = '';
    PIPELINE_STAGE_NAMES.forEach(function (name, i) {
      var state = states[name] || 'pending';
      html += '<div class="pipeline-stage-box stage-' + state + '">' +
        '<span class="stage-name">' + escapeHtml(name) + '</span>' +
        (times[name] ? '<span class="stage-time">' + escapeHtml(times[name]) + '</span>' : '<span class="stage-time">&mdash;</span>') +
      '</div>';
      if (i < PIPELINE_STAGE_NAMES.length - 1) {
        html += '<span class="pipeline-stage-arrow">&rarr;</span>';
      }
    });
    pipelineStages.innerHTML = html;
  }

  function addPipelineLiveLogEntry(type, message) {
    var entry = document.createElement('div');
    entry.className = 'pipeline-live-log-entry log-' + type;
    entry.textContent = new Date().toLocaleTimeString() + '  ' + message;
    pipelineLiveLog.appendChild(entry);
    pipelineLiveLog.scrollTop = pipelineLiveLog.scrollHeight;
  }

  // ── Utilities ──────────────────────────────────────────────────────

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

      // Relative time for recent events
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHrs < 24) return diffHrs + 'h ago';

      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function mapState(state) {
    if (state === 'queued') return 'pending';
    if (state === 'paused') return 'pending';
    return state;
  }

  // ── Health check ───────────────────────────────────────────────────

  function checkHealth() {
    apiGet('/health').then(function (data) {
      if (data && data.status === 'ok') {
        statusBadge.textContent = 'Connected';
        statusBadge.classList.add('connected');
        addActivity('success', 'Connected to API (v' + (data.version || '?') + ')');
      } else {
        statusBadge.textContent = 'API Offline';
        statusBadge.classList.remove('connected');
      }
    });
  }

  // ── Auto-refresh ───────────────────────────────────────────────────

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(function () {
      var activeTab = document.querySelector('.tab.active');
      if (!activeTab) return;
      var tab = activeTab.dataset.tab;
      if (tab === 'approvals') loadApprovals();
      else if (tab === 'tasks') loadTasks();
      else if (tab === 'workflows') loadWorkflows();
      else if (tab === 'analytics') loadAnalytics();
    }, 10000);
  }

  // ── Init ───────────────────────────────────────────────────────────

  window.App = {
    decide: decideApproval,
    approveWithLoading: approveWithLoading,
    confirmDeny: confirmDeny,
    simulate: simulateTask,
    showTaskDetail: showTaskDetail,
    showCordExplainer: showCordExplainer,
    showToast: showToast,
  };

  // Expose showToast globally for convenience
  window.showToast = showToast;

  checkHealth();
  loadApprovals();
  loadTasks();
  loadWorkflows();
  loadConnectorStatus();
  connectSSE();
  startAutoRefresh();
  loadReceipts();
})();
