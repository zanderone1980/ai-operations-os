/**
 * AI Operations OS — Dashboard App
 *
 * Connects to ops-api for task/approval management.
 * Uses SSE for real-time approval notifications.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────
  // API_BASE defaults to localhost:3100 for static-file serving.
  // Override via global window.OPS_API_BASE before this script loads.
  var API_BASE = window.OPS_API_BASE || 'http://localhost:3100';

  var statusBadge = document.getElementById('status-badge');
  var refreshInterval = null;

  // ── Tab switching ────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panelId = 'panel-' + tab.dataset.tab;
      var panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');

      // Load data for the selected tab
      if (tab.dataset.tab === 'approvals') loadApprovals();
      if (tab.dataset.tab === 'tasks') loadTasks();
      if (tab.dataset.tab === 'workflows') loadWorkflows();
    });
  });

  // ── API helpers ──────────────────────────────────────────────────────

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

  // ── Approvals ────────────────────────────────────────────────────────

  function loadApprovals() {
    apiGet('/api/approvals').then(function (data) {
      if (!data) return;
      var list = document.getElementById('approval-list');
      var count = document.getElementById('approval-count');
      count.textContent = data.pending || 0;

      if (!data.approvals || data.approvals.length === 0) {
        list.innerHTML = '<div class="empty-state">No pending approvals</div>';
        return;
      }

      list.innerHTML = data.approvals.map(function (a) {
        return '<div class="card" data-id="' + a.id + '">' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(a.reason) + '</span>' +
            '<span class="risk-badge risk-' + a.risk + '">' + a.risk + '</span>' +
          '</div>' +
          '<div class="card-body">' + escapeHtml(a.preview) + '</div>' +
          '<div class="card-meta">Requested: ' + formatTime(a.requestedAt) + '</div>' +
          (a.decision
            ? '<div class="status status-' + (a.decision === 'approved' ? 'completed' : 'failed') + '">' + a.decision + '</div>'
            : '<div class="card-actions">' +
                '<button class="btn btn-approve" onclick="App.decide(\'' + a.id + '\', \'approved\')">Approve</button>' +
                '<button class="btn btn-deny" onclick="App.decide(\'' + a.id + '\', \'denied\')">Deny</button>' +
              '</div>'
          ) +
        '</div>';
      }).join('');
    });
  }

  function decideApproval(id, decision) {
    apiPost('/api/approvals/' + id + '/decide', { decision: decision }).then(function () {
      loadApprovals();
      addActivity(decision === 'approved' ? 'green' : 'red',
        'Approval ' + decision + ': ' + id.slice(0, 8) + '...');
    });
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  function loadTasks() {
    apiGet('/api/tasks').then(function (data) {
      if (!data) return;
      var list = document.getElementById('task-list');

      if (!data.tasks || data.tasks.length === 0) {
        list.innerHTML = '<div class="empty-state">No tasks yet</div>';
        return;
      }

      list.innerHTML = data.tasks.map(function (t) {
        var taskDataAttr = ' data-source="' + escapeHtml(t.source) + '"' +
          ' data-title="' + escapeHtml(t.title) + '"' +
          ' data-body="' + escapeHtml(t.body || '') + '"';

        return '<div class="card"' + taskDataAttr + '>' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(t.title) + '</span>' +
            '<span class="status status-' + t.status + '">' + t.status + '</span>' +
          '</div>' +
          '<div class="card-meta">' + escapeHtml(t.source) + ' | ' + escapeHtml(t.intent) + ' | ' + escapeHtml(t.priority) + '</div>' +
          (t.body ? '<div class="card-body">' + escapeHtml(t.body.slice(0, 200)) + '</div>' : '') +
          '<div class="card-actions">' +
            '<button class="btn btn-simulate" onclick="App.simulate(this)">Simulate</button>' +
          '</div>' +
        '</div>';
      }).join('');
    });
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
        addActivity('green', 'Created task: ' + title);
      } else {
        addActivity('red', 'Failed to create task: ' + title);
      }
    });
  });

  // ── Pipeline Simulation ───────────────────────────────────────────

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
          addActivity('red', 'Simulation failed for: ' + title);
          return;
        }

        showSimResults(title, data);
        addActivity('blue', 'Simulated pipeline for: ' + title);
      });
  }

  function showSimResults(title, data) {
    // data may have data.steps or data.projectedSteps or be an array
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

  // ── Pipeline Run (SSE) ────────────────────────────────────────────

  var pipelineFeed = document.getElementById('pipeline-feed');
  var pipelineEvents = document.getElementById('pipeline-events');
  var closePipelineFeedBtn = document.getElementById('close-pipeline-feed');
  var runPipelineBtn = document.getElementById('run-pipeline-btn');

  closePipelineFeedBtn.addEventListener('click', function () {
    pipelineFeed.classList.add('hidden');
  });

  runPipelineBtn.addEventListener('click', function () {
    // Use the first task in the list, or prompt user
    apiGet('/api/tasks').then(function (data) {
      if (!data || !data.tasks || data.tasks.length === 0) {
        addActivity('red', 'No tasks available to run pipeline');
        return;
      }

      // Use the first pending/new task, fallback to first task
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
    addActivity('blue', 'Pipeline run started: ' + task.title);

    // POST with SSE response via fetch + ReadableStream
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
            addActivity('green', 'Pipeline run completed: ' + task.title);
            runPipelineBtn.disabled = false;
            runPipelineBtn.textContent = 'Run Pipeline';
            // Refresh data after pipeline completes
            loadTasks();
            loadApprovals();
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;

            // SSE format: "data: {...}"
            if (line.indexOf('data: ') === 0) {
              var jsonStr = line.slice(6);
              try {
                var evt = JSON.parse(jsonStr);
                handlePipelineEvent(evt);
              } catch (e) {
                // Non-JSON data line
                addPipelineEvent('info', jsonStr);
              }
            } else if (line.indexOf('event: ') !== 0 && line.indexOf('id: ') !== 0 && line.indexOf(':') !== 0) {
              // Not an SSE comment or field; try as raw JSON
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
      addActivity('red', 'Pipeline run failed: ' + err.message);
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

    // Also log to activity feed
    var activityColor = 'blue';
    if (eventClass === 'allowed') activityColor = 'green';
    else if (eventClass === 'blocked') activityColor = 'red';
    else if (eventClass === 'approval') activityColor = 'yellow';
    addActivity(activityColor, '[Pipeline] ' + message);
  }

  function addPipelineEvent(type, message) {
    var div = document.createElement('div');
    div.className = 'pipeline-event event-' + type;
    div.innerHTML =
      '<span class="pipeline-event-time">' + new Date().toLocaleTimeString() + '</span>' +
      '<span class="pipeline-event-text">' + escapeHtml(String(message)) + '</span>';
    pipelineEvents.appendChild(div);
    // Auto-scroll to bottom
    pipelineEvents.scrollTop = pipelineEvents.scrollHeight;
  }

  // ── Workflows ────────────────────────────────────────────────────────

  function loadWorkflows() {
    apiGet('/api/workflows').then(function (data) {
      if (!data) return;
      var list = document.getElementById('workflow-list');

      if (!data.runs || data.runs.length === 0) {
        list.innerHTML = '<div class="empty-state">No workflow runs</div>';
        return;
      }

      list.innerHTML = data.runs.map(function (r) {
        var completedSteps = r.steps.filter(function (s) { return s.status === 'completed'; }).length;
        return '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(r.workflowType) + '</span>' +
            '<span class="status status-' + mapState(r.state) + '">' + r.state + '</span>' +
          '</div>' +
          '<div class="card-meta">Steps: ' + completedSteps + '/' + r.steps.length + ' | Started: ' + formatTime(r.startedAt) + '</div>' +
        '</div>';
      }).join('');
    });
  }

  // ── SSE for real-time approvals ──────────────────────────────────────

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
          // New approval — reload list and add to activity feed
          loadApprovals();
          addActivity('yellow', 'New approval request: ' + (data.reason || '').slice(0, 50));
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

  // ── Activity feed ────────────────────────────────────────────────────

  function addActivity(color, message) {
    var log = document.getElementById('activity-log');
    var empty = log.querySelector('.empty-state');
    if (empty) empty.remove();

    var item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML =
      '<span class="activity-time">' + new Date().toLocaleTimeString() + '</span>' +
      '<span class="activity-dot ' + color + '"></span>' +
      '<span>' + escapeHtml(message) + '</span>';

    log.insertBefore(item, log.firstChild);

    // Keep activity feed from growing unbounded (max 200 items)
    var items = log.querySelectorAll('.activity-item');
    if (items.length > 200) {
      items[items.length - 1].remove();
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch (e) { return iso; }
  }

  function mapState(state) {
    if (state === 'queued') return 'pending';
    if (state === 'paused') return 'pending';
    return state;
  }

  // ── Health check ─────────────────────────────────────────────────────

  function checkHealth() {
    apiGet('/health').then(function (data) {
      if (data && data.status === 'ok') {
        statusBadge.textContent = 'Connected';
        statusBadge.classList.add('connected');
        addActivity('green', 'Connected to API (v' + (data.version || '?') + ')');
      } else {
        statusBadge.textContent = 'API Offline';
        statusBadge.classList.remove('connected');
      }
    });
  }

  // ── Auto-refresh ─────────────────────────────────────────────────────

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(function () {
      // Refresh the currently active panel
      var activeTab = document.querySelector('.tab.active');
      if (!activeTab) return;
      var tab = activeTab.dataset.tab;
      if (tab === 'approvals') loadApprovals();
      else if (tab === 'tasks') loadTasks();
      else if (tab === 'workflows') loadWorkflows();
    }, 10000);
  }

  // ── Init ─────────────────────────────────────────────────────────────

  window.App = {
    decide: decideApproval,
    simulate: simulateTask,
  };

  checkHealth();
  loadApprovals();
  connectSSE();
  startAutoRefresh();
})();
