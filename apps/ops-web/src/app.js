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
    apiGet('/api/approvals').then(function (data) {
      if (!data) return;
      var list = document.getElementById('approval-list');
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
                '<button class="btn btn-approve" onclick="App.decide(\'' + a.id + '\', \'approved\')">Approve</button>' +
                '<button class="btn btn-deny" onclick="App.confirmDeny(\'' + a.id + '\', \'' + escapeHtml(a.reason || '') + '\')">Deny</button>' +
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

  function decideApproval(id, decision) {
    apiPost('/api/approvals/' + id + '/decide', { decision: decision }).then(function () {
      loadApprovals();
      addActivity(decision === 'approved' ? 'success' : 'error',
        'Approval ' + decision + ': ' + id.slice(0, 8) + '...');
    });
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
      decideApproval(pendingDenyId, 'denied');
      pendingDenyId = null;
    }
    denyModal.classList.add('hidden');
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
    apiGet('/api/tasks').then(function (data) {
      if (!data) return;
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
      } else {
        addActivity('error', 'Failed to create task: ' + title);
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
        return;
      }

      var task = data.tasks.find(function (t) {
        return t.status === 'pending' || t.status === 'new' || t.status === 'queued';
      }) || data.tasks[0];

      startPipelineRun(task);
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
    apiGet('/api/workflows').then(function (data) {
      if (!data) return;
      var list = document.getElementById('workflow-list');

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
    }, 10000);
  }

  // ── Init ───────────────────────────────────────────────────────────

  window.App = {
    decide: decideApproval,
    confirmDeny: confirmDeny,
    simulate: simulateTask,
    showTaskDetail: showTaskDetail,
  };

  checkHealth();
  loadApprovals();
  loadTasks();
  loadWorkflows();
  loadConnectorStatus();
  connectSSE();
  startAutoRefresh();
})();
