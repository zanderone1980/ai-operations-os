/**
 * AI Operations OS — Dashboard App
 *
 * Connects to ops-api for task/approval management.
 * Uses SSE for real-time approval notifications.
 */

(function () {
  'use strict';

  var API_BASE = window.location.origin.replace(/:\d+$/, ':3100');
  var statusBadge = document.getElementById('status-badge');

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
        return '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + escapeHtml(t.title) + '</span>' +
            '<span class="status status-' + t.status + '">' + t.status + '</span>' +
          '</div>' +
          '<div class="card-meta">' + t.source + ' | ' + t.intent + ' | ' + t.priority + '</div>' +
          (t.body ? '<div class="card-body">' + escapeHtml(t.body.slice(0, 200)) + '</div>' : '') +
        '</div>';
      }).join('');
    });
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
          // New approval — reload list
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
        addActivity('green', 'Connected to API (v' + data.version + ')');
      } else {
        statusBadge.textContent = 'API Offline';
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────

  window.App = {
    decide: decideApproval,
  };

  checkHealth();
  loadApprovals();
  connectSSE();
})();
