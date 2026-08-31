import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(`    .nav-item {
      padding: 13px 15px;
      border-radius: 8px;
      margin-bottom: 7px;
      cursor: pointer;
    }

    .nav-item.active {
      background: #2563eb;
    }`, `    .nav-item {
      display: block;
      width: 100%;
      padding: 13px 15px;
      border-radius: 8px;
      margin-bottom: 7px;
      cursor: pointer;
      border: 0;
      background: transparent;
      color: white;
      text-align: left;
      font: inherit;
    }

    button.nav-item:hover:not(:disabled) {
      background: #1f2937;
    }

    .nav-item.active {
      background: #2563eb;
    }

    button.nav-item:disabled {
      opacity: 0.6;
      cursor: wait;
    }`, 'sidebar button styles');

replaceOnce(`    .review-btn { padding: 8px 14px; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }`, `    .review-btn { padding: 8px 14px; }
    .empty-state { padding: 26px 20px; color: #64748b; }
    .activity-entry { padding: 18px 20px; border-bottom: 1px solid #f1f5f9; }
    .activity-entry:last-child { border-bottom: none; }
    .activity-title { font-weight: bold; margin-bottom: 6px; }
    .activity-meta { color: #64748b; font-size: 13px; line-height: 1.5; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }`, 'activity styles');

replaceOnce(`      <div class="nav-item active">Dashboard</div>
      <div class="nav-item">Documents</div>
      <div class="nav-item">Review Queue</div>
      <div class="nav-item">Completed</div>
      <div class="nav-item">Activity Log</div>`, `      <button type="button" class="nav-item active" data-view="dashboard" aria-current="page">Dashboard</button>
      <button type="button" class="nav-item" data-view="documents">Documents</button>
      <button type="button" class="nav-item" data-view="review">Review Queue</button>
      <button type="button" class="nav-item" data-view="completed">Completed</button>
      <button type="button" class="nav-item" data-view="activity">Activity Log</button>`, 'workspace navigation');

replaceOnce(`      <section class="welcome">
        <h1>Good evening</h1>
        <p>Welcome to your CareFlow AI workspace.</p>
      </section>

      <section class="cards">`, `      <section class="welcome" id="workspaceWelcome">
        <h1 id="workspaceTitle">Good evening</h1>
        <p id="workspaceSubtitle">Welcome to your CareFlow AI workspace.</p>
      </section>

      <section class="cards" id="dashboardCards">`, 'workspace heading');

replaceOnce(`      <section class="upload">`, `      <section class="upload" id="uploadSection">`, 'upload section id');

replaceOnce(`      <section class="recent">

        <div class="recent-header case-list-header">
          <span>Recent Cases</span>`, `      <section class="recent" id="caseListSection">

        <div class="recent-header case-list-header">
          <span id="caseListTitle">Recent Cases</span>`, 'case list section id');

replaceOnce(`        <div id="uploadedCase"></div>
      </section>
<section id="reviewPanel" class="recent" style="display:none; margin-top:30px;">`, `        <div id="uploadedCase"></div>
      </section>

      <section id="activityLogSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Activity Log</span>
          <button type="button" id="reloadActivityBtn" class="button" disabled>Reload activity</button>
        </div>
        <p id="activityLogStatus" role="status" style="padding:12px 20px;"></p>
        <div id="activityLogList"></div>
      </section>

<section id="reviewPanel" class="recent" style="display:none; margin-top:30px;">`, 'activity log section');

replaceOnce(`let dashboardRequest = 0;
let editing = false;`, `let dashboardRequest = 0;
let activityRequest = 0;
let activityLogEntries = [];
let loadingActivity = false;
let activeView = "dashboard";
let editing = false;`, 'navigation state');

replaceOnce(`function updateControls() {
  const busy = uploading || saving || loadingCases;
  document.getElementById("uploadBtn").disabled = busy || editing || !organizationId;
  document.getElementById("reloadCasesBtn").disabled = busy || editing || !organizationId;`, `const VIEW_CONFIG = {
  dashboard: {
    title: "Good evening",
    subtitle: "Welcome to your CareFlow AI workspace.",
    listTitle: "Recent Cases"
  },
  documents: {
    title: "Documents",
    subtitle: "Browse the saved documents for this hospital.",
    listTitle: "All Documents"
  },
  review: {
    title: "Review Queue",
    subtitle: "Cases that still need human review or correction.",
    listTitle: "Cases Awaiting Review"
  },
  completed: {
    title: "Completed",
    subtitle: "Approved cases completed by this hospital.",
    listTitle: "Completed Cases"
  },
  activity: {
    title: "Activity Log",
    subtitle: "Protected review activity for this hospital. Patient values are not shown here.",
    listTitle: "Activity Log"
  }
};

function casesForActiveView() {
  if (activeView === "review") {
    return savedCases.filter(function(row) { return ["Review", "Correction Required"].includes(row.status); });
  }
  if (activeView === "completed") {
    return savedCases.filter(function(row) { return row.status === "Completed"; });
  }
  if (activeView === "dashboard") return savedCases.slice(0, 10);
  return savedCases;
}

function emptyMessageForActiveView() {
  if (activeView === "review") return "No cases are waiting for review.";
  if (activeView === "completed") return "No completed cases yet.";
  if (activeView === "documents") return "No saved documents yet.";
  return "No recent cases yet. Upload a test document to begin.";
}

function renderWorkspaceView() {
  const config = VIEW_CONFIG[activeView] || VIEW_CONFIG.dashboard;
  document.getElementById("workspaceTitle").textContent = config.title;
  document.getElementById("workspaceSubtitle").textContent = config.subtitle;
  document.getElementById("caseListTitle").textContent = config.listTitle;

  const isDashboard = activeView === "dashboard";
  const isActivity = activeView === "activity";
  document.getElementById("dashboardCards").hidden = !isDashboard;
  document.getElementById("dashboardMetricsStatus").hidden = !isDashboard;
  document.getElementById("uploadSection").hidden = !(activeView === "dashboard" || activeView === "documents");
  document.getElementById("caseListSection").hidden = isActivity;
  document.getElementById("activityLogSection").hidden = !isActivity;

  document.querySelectorAll("[data-view]").forEach(function(button) {
    const selected = button.dataset.view === activeView;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (!isActivity) renderCases();
}

async function switchWorkspaceView(view) {
  if (!VIEW_CONFIG[view] || !organizationId) return;
  if (editing) {
    document.getElementById("reviewActionStatus").textContent = "Save Corrections or Cancel before leaving this case.";
    return;
  }
  if (uploading || saving || loadingCases || loadingActivity) return;
  activeView = view;
  clearReview();
  renderWorkspaceView();
  if (view === "activity") await loadActivityLog();
}

function changedActivityFields(entry) {
  const labels = {
    status: "Status",
    patient_name: "Patient name",
    document_type: "Document type",
    document_date: "Document date",
    insurance_information: "Insurance information",
    missing_information: "Missing information",
    review_notes: "Correction note",
    review_confirmed: "Review confirmation"
  };
  const before = entry.before_values || {};
  const after = entry.after_values || {};
  return Object.keys(labels).filter(function(key) {
    return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  }).map(function(key) { return labels[key]; });
}

function renderActivityLog() {
  const container = document.getElementById("activityLogList");
  container.replaceChildren();
  if (activityLogEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No review activity has been recorded yet.";
    container.append(empty);
    return;
  }
  activityLogEntries.forEach(function(entry) {
    const row = document.createElement("div");
    row.className = "activity-entry";
    const title = document.createElement("div");
    title.className = "activity-title";
    title.textContent = "Case #" + entry.case_id + (entry.operation === "INSERT" ? " created" : " updated");
    const meta = document.createElement("div");
    meta.className = "activity-meta";
    const changed = changedActivityFields(entry);
    const timestamp = entry.changed_at ? new Date(entry.changed_at).toLocaleString() : "Time unavailable";
    meta.textContent = timestamp + (changed.length ? " · Changed: " + changed.join(", ") : " · Review record saved");
    row.append(title, meta);
    container.append(row);
  });
}

async function loadActivityLog() {
  if (!organizationId) return false;
  const request = ++activityRequest;
  const requestedOrganization = organizationId;
  const status = document.getElementById("activityLogStatus");
  status.textContent = "Loading protected activity...";
  loadingActivity = true;
  updateControls();
  try {
    const { data, error } = await supabaseClient.from("case_review_history")
      .select("id, case_id, changed_at, operation, before_values, after_values")
      .eq("organization_id", requestedOrganization)
      .order("changed_at", { ascending: false })
      .limit(50);
    if (request !== activityRequest || requestedOrganization !== organizationId) return false;
    if (error) throw error;
    activityLogEntries = data || [];
    renderActivityLog();
    status.textContent = activityLogEntries.length === 50 ? "Showing the 50 most recent review events." : "";
    return true;
  } catch (error) {
    if (request === activityRequest && requestedOrganization === organizationId) {
      activityLogEntries = [];
      renderActivityLog();
      status.textContent = "Could not load activity. " + (error.message || "Please try again.");
    }
    return false;
  } finally {
    if (request === activityRequest && requestedOrganization === organizationId) {
      loadingActivity = false;
      updateControls();
    }
  }
}

function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity;
  document.getElementById("uploadBtn").disabled = busy || editing || !organizationId;
  document.getElementById("reloadCasesBtn").disabled = busy || editing || !organizationId;
  document.getElementById("reloadActivityBtn").disabled = busy || editing || !organizationId;
  document.querySelectorAll("[data-view]").forEach(function(button) { button.disabled = busy || editing || !organizationId; });`, 'workspace navigation logic');

replaceOnce(`function renderCases() {
  const container = document.getElementById("uploadedCase");
  container.replaceChildren();
  savedCases.forEach(function(caseRow) {`, `function renderCases() {
  const container = document.getElementById("uploadedCase");
  container.replaceChildren();
  const visibleCases = casesForActiveView();
  if (visibleCases.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyMessageForActiveView();
    container.append(empty);
    updateControls();
    return;
  }
  visibleCases.forEach(function(caseRow) {`, 'filtered case rendering');

replaceOnce(`    savedCases = data || [];
    renderCases();`, `    savedCases = data || [];
    renderWorkspaceView();`, 'load cases view rendering');

replaceOnce(`  dashboardRequest += 1;
  resetDashboardMetrics();
  clearReview();
  renderCases();`, `  dashboardRequest += 1;
  activityRequest += 1;
  activityLogEntries = [];
  loadingActivity = false;
  activeView = "dashboard";
  resetDashboardMetrics();
  clearReview();
  renderWorkspaceView();`, 'auth reset navigation');

replaceOnce(`    organizationId = membership.organization_id;
    updateControls();
    await Promise.all([loadCases(), loadDashboardMetrics()]);`, `    organizationId = membership.organization_id;
    renderWorkspaceView();
    updateControls();
    await Promise.all([loadCases(), loadDashboardMetrics()]);`, 'auth success navigation');

replaceOnce(`document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await Promise.all([loadCases(), loadDashboardMetrics()]);
});`, `document.querySelectorAll("[data-view]").forEach(function(button) {
  button.addEventListener("click", function() { switchWorkspaceView(this.dataset.view); });
});

document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await Promise.all([loadCases(), loadDashboardMetrics()]);
});

document.getElementById("reloadActivityBtn").addEventListener("click", loadActivityLog);`, 'navigation listeners');

replaceOnce(`    dashboardRequest += 1;
    organizationId = null;
    savedCases = [];
    loadingCases = false;
    resetDashboardMetrics();
    clearReview();
    renderCases();`, `    dashboardRequest += 1;
    activityRequest += 1;
    organizationId = null;
    savedCases = [];
    activityLogEntries = [];
    loadingCases = false;
    loadingActivity = false;
    activeView = "dashboard";
    resetDashboardMetrics();
    clearReview();
    renderWorkspaceView();`, 'signout navigation reset');

fs.writeFileSync(path, text);
