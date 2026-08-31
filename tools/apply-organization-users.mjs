import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(`      <h3>Settings</h3>
      <div class="nav-item">Organization</div>
      <div class="nav-item">Users</div>`, `      <h3>Settings</h3>
      <button type="button" id="navOrganization" class="nav-item" data-view="organization">Organization</button>
      <button type="button" id="navUsers" class="nav-item" data-view="users">Users</button>`, 'settings navigation buttons');

replaceOnce(`    .activity-entry { padding: 18px 20px; border-bottom: 1px solid #f1f5f9; }
    .activity-entry:last-child { border-bottom: none; }
    .activity-title { font-weight: bold; margin-bottom: 6px; }
    .activity-meta { color: #64748b; font-size: 13px; line-height: 1.5; }`, `    .activity-entry { padding: 18px 20px; border-bottom: 1px solid #f1f5f9; }
    .activity-entry:last-child { border-bottom: none; }
    .activity-title { font-weight: bold; margin-bottom: 6px; }
    .activity-meta { color: #64748b; font-size: 13px; line-height: 1.5; }
    .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 20px; }
    .settings-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; background: #fff; }
    .settings-label { color: #64748b; font-size: 13px; margin-bottom: 6px; }
    .settings-value { color: #172033; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
    .member-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #f1f5f9; }
    .member-row:last-child { border-bottom: none; }
    .member-email { font-weight: 700; overflow-wrap: anywhere; }
    .member-meta { color: #64748b; font-size: 13px; margin-top: 5px; }
    .role-badge { padding: 6px 12px; border-radius: 999px; background: #e0e7ff; color: #3730a3; font-size: 12px; font-weight: 700; text-transform: capitalize; }
    .current-user-badge { margin-left: 8px; color: #166534; font-size: 12px; font-weight: 700; }`, 'settings styles');

replaceOnce(`      <section id="activityLogSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Activity Log</span>
          <button type="button" id="reloadActivityBtn" class="button" disabled>Reload activity</button>
        </div>
        <p id="activityLogStatus" role="status" style="padding:12px 20px;"></p>
        <div id="activityLogList"></div>
      </section>

<section id="reviewPanel"`, `      <section id="activityLogSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Activity Log</span>
          <button type="button" id="reloadActivityBtn" class="button" disabled>Reload activity</button>
        </div>
        <p id="activityLogStatus" role="status" style="padding:12px 20px;"></p>
        <div id="activityLogList"></div>
      </section>

      <section id="organizationSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Organization</span>
          <button type="button" id="reloadOrganizationBtn" class="button" disabled>Reload organization</button>
        </div>
        <p id="organizationStatus" role="status" style="padding:12px 20px;"></p>
        <div class="settings-grid">
          <div class="settings-card"><div class="settings-label">Hospital / organization</div><div id="organizationName" class="settings-value">—</div></div>
          <div class="settings-card"><div class="settings-label">Your role</div><div id="organizationRole" class="settings-value">—</div></div>
          <div class="settings-card"><div class="settings-label">Active members</div><div id="organizationMemberCount" class="settings-value">—</div></div>
          <div class="settings-card"><div class="settings-label">Workspace created</div><div id="organizationCreatedAt" class="settings-value">—</div></div>
        </div>
        <p class="review-help" style="padding:0 20px 20px;">Organization settings are read-only while CareFlow's staff-management controls are being completed.</p>
      </section>

      <section id="usersSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Users</span>
          <button type="button" id="reloadUsersBtn" class="button" disabled>Reload users</button>
        </div>
        <p id="usersStatus" role="status" style="padding:12px 20px;"></p>
        <div id="usersList"></div>
        <p class="review-help" style="padding:0 20px 20px;">Only members of this hospital are shown. Inviting, changing roles, and removing users will be added as a separate secured workflow.</p>
      </section>

<section id="reviewPanel"`, 'settings sections');

replaceOnce(`let loadingActivity = false;
let activeView = "dashboard";
let editing = false;`, `let loadingActivity = false;
let organizationSettings = null;
let organizationMembers = [];
let loadingSettings = false;
let settingsRequest = 0;
let activeView = "dashboard";
let editing = false;`, 'settings state');

replaceOnce(`const WORKSPACE_NAV_IDS = ["navDashboard", "navDocuments", "navReview", "navCompleted", "navActivity"];
const NAV_VIEW_BY_ID = {
  navDashboard: "dashboard",
  navDocuments: "documents",
  navReview: "review",
  navCompleted: "completed",
  navActivity: "activity"
};`, `const WORKSPACE_NAV_IDS = ["navDashboard", "navDocuments", "navReview", "navCompleted", "navActivity", "navOrganization", "navUsers"];
const NAV_VIEW_BY_ID = {
  navDashboard: "dashboard",
  navDocuments: "documents",
  navReview: "review",
  navCompleted: "completed",
  navActivity: "activity",
  navOrganization: "organization",
  navUsers: "users"
};`, 'settings nav map');

replaceOnce(`  activity: {
    title: "Activity Log",
    subtitle: "Protected review activity for this hospital. Patient values are not shown here.",
    listTitle: "Activity Log"
  }
};`, `  activity: {
    title: "Activity Log",
    subtitle: "Protected review activity for this hospital. Patient values are not shown here.",
    listTitle: "Activity Log"
  },
  organization: {
    title: "Organization",
    subtitle: "View the hospital workspace connected to your account.",
    listTitle: "Organization"
  },
  users: {
    title: "Users",
    subtitle: "View the staff accounts connected to this hospital.",
    listTitle: "Users"
  }
};`, 'settings view config');

replaceOnce(`  const isDashboard = activeView === "dashboard";
  const isActivity = activeView === "activity";
  const cards = document.getElementById("dashboardCards");
  const metricsStatus = document.getElementById("dashboardMetricsStatus");
  const uploadSection = document.getElementById("uploadSection");
  const caseListSection = document.getElementById("caseListSection");
  const activitySection = document.getElementById("activityLogSection");
  if (cards) cards.hidden = !isDashboard;
  if (metricsStatus) metricsStatus.hidden = !isDashboard;
  if (uploadSection) uploadSection.hidden = !(activeView === "dashboard" || activeView === "documents");
  if (caseListSection) caseListSection.hidden = isActivity;
  if (activitySection) activitySection.hidden = !isActivity;`, `  const isDashboard = activeView === "dashboard";
  const isActivity = activeView === "activity";
  const isOrganization = activeView === "organization";
  const isUsers = activeView === "users";
  const isSettings = isOrganization || isUsers;
  const cards = document.getElementById("dashboardCards");
  const metricsStatus = document.getElementById("dashboardMetricsStatus");
  const uploadSection = document.getElementById("uploadSection");
  const caseListSection = document.getElementById("caseListSection");
  const activitySection = document.getElementById("activityLogSection");
  const organizationSection = document.getElementById("organizationSection");
  const usersSection = document.getElementById("usersSection");
  if (cards) cards.hidden = !isDashboard;
  if (metricsStatus) metricsStatus.hidden = !isDashboard;
  if (uploadSection) uploadSection.hidden = !(activeView === "dashboard" || activeView === "documents");
  if (caseListSection) caseListSection.hidden = isActivity || isSettings;
  if (activitySection) activitySection.hidden = !isActivity;
  if (organizationSection) organizationSection.hidden = !isOrganization;
  if (usersSection) usersSection.hidden = !isUsers;`, 'settings section visibility');

replaceOnce(`  if (!isActivity) renderCases();
}`, `  if (!isActivity && !isSettings) renderCases();
}`, 'skip case rendering on settings');

replaceOnce(`  if (uploading || saving || loadingCases || loadingActivity) return;
  activeView = view;
  clearReview();
  renderWorkspaceView();
  if (view === "activity") await loadActivityLog();
}`, `  if (uploading || saving || loadingCases || loadingActivity || loadingSettings) return;
  activeView = view;
  clearReview();
  renderWorkspaceView();
  if (view === "activity") await loadActivityLog();
  if (view === "organization") await loadOrganizationSettings();
  if (view === "users") await loadOrganizationMembers();
}`, 'settings view loading');

replaceOnce(`function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity;`, `function formatWorkspaceDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleDateString();
}

function renderOrganizationSettings() {
  document.getElementById("organizationName").textContent = organizationSettings?.organization_name || "Not available";
  document.getElementById("organizationRole").textContent = organizationSettings?.my_role || "Not available";
  document.getElementById("organizationMemberCount").textContent = organizationSettings?.member_count == null ? "—" : String(organizationSettings.member_count);
  document.getElementById("organizationCreatedAt").textContent = formatWorkspaceDate(organizationSettings?.organization_created_at);
}

async function loadOrganizationSettings() {
  if (!organizationId) return false;
  const request = ++settingsRequest;
  const requestedOrganization = organizationId;
  const status = document.getElementById("organizationStatus");
  status.textContent = "Loading organization...";
  loadingSettings = true;
  updateControls();
  try {
    const { data, error } = await supabaseClient.rpc("careflow_my_organization");
    if (request !== settingsRequest || requestedOrganization !== organizationId) return false;
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.organization_id !== requestedOrganization) throw new Error("Organization details are unavailable.");
    organizationSettings = row;
    renderOrganizationSettings();
    status.textContent = "";
    return true;
  } catch (error) {
    if (request === settingsRequest && requestedOrganization === organizationId) {
      organizationSettings = null;
      renderOrganizationSettings();
      status.textContent = "Could not load organization details. " + (error.message || "Please try again.");
    }
    return false;
  } finally {
    if (request === settingsRequest && requestedOrganization === organizationId) {
      loadingSettings = false;
      updateControls();
    }
  }
}

function renderOrganizationMembers() {
  const list = document.getElementById("usersList");
  list.replaceChildren();
  if (organizationMembers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No hospital users are available.";
    list.append(empty);
    return;
  }
  organizationMembers.forEach(function(member) {
    const row = document.createElement("div");
    row.className = "member-row";
    const details = document.createElement("div");
    const email = document.createElement("div");
    email.className = "member-email";
    email.textContent = member.email || "Email unavailable";
    if (member.is_current) {
      const current = document.createElement("span");
      current.className = "current-user-badge";
      current.textContent = "You";
      email.append(current);
    }
    const meta = document.createElement("div");
    meta.className = "member-meta";
    meta.textContent = "Joined " + formatWorkspaceDate(member.joined_at);
    details.append(email, meta);
    const role = document.createElement("span");
    role.className = "role-badge";
    role.textContent = member.role || "member";
    row.append(details, role);
    list.append(row);
  });
}

async function loadOrganizationMembers() {
  if (!organizationId) return false;
  const request = ++settingsRequest;
  const requestedOrganization = organizationId;
  const status = document.getElementById("usersStatus");
  status.textContent = "Loading hospital users...";
  loadingSettings = true;
  updateControls();
  try {
    const { data, error } = await supabaseClient.rpc("careflow_my_organization_members");
    if (request !== settingsRequest || requestedOrganization !== organizationId) return false;
    if (error) throw error;
    organizationMembers = Array.isArray(data) ? data : [];
    renderOrganizationMembers();
    status.textContent = "";
    return true;
  } catch (error) {
    if (request === settingsRequest && requestedOrganization === organizationId) {
      organizationMembers = [];
      renderOrganizationMembers();
      status.textContent = "Could not load hospital users. " + (error.message || "Please try again.");
    }
    return false;
  } finally {
    if (request === settingsRequest && requestedOrganization === organizationId) {
      loadingSettings = false;
      updateControls();
    }
  }
}

function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings;`, 'settings loaders');

replaceOnce(`  const reloadActivityBtn = document.getElementById("reloadActivityBtn");
  if (reloadActivityBtn) reloadActivityBtn.disabled = busy || editing || !organizationId;
  WORKSPACE_NAV_IDS.forEach(function(id) {`, `  const reloadActivityBtn = document.getElementById("reloadActivityBtn");
  if (reloadActivityBtn) reloadActivityBtn.disabled = busy || editing || !organizationId;
  const reloadOrganizationBtn = document.getElementById("reloadOrganizationBtn");
  if (reloadOrganizationBtn) reloadOrganizationBtn.disabled = busy || editing || !organizationId;
  const reloadUsersBtn = document.getElementById("reloadUsersBtn");
  if (reloadUsersBtn) reloadUsersBtn.disabled = busy || editing || !organizationId;
  WORKSPACE_NAV_IDS.forEach(function(id) {`, 'settings reload controls');

replaceOnce(`  activityRequest += 1;
  activityLogEntries = [];
  loadingActivity = false;
  activeView = "dashboard";`, `  activityRequest += 1;
  settingsRequest += 1;
  activityLogEntries = [];
  organizationSettings = null;
  organizationMembers = [];
  loadingActivity = false;
  loadingSettings = false;
  activeView = "dashboard";`, 'settings auth reset');

replaceOnce(`const reloadActivityBtn = document.getElementById("reloadActivityBtn");
if (reloadActivityBtn) reloadActivityBtn.addEventListener("click", loadActivityLog);`, `const reloadActivityBtn = document.getElementById("reloadActivityBtn");
if (reloadActivityBtn) reloadActivityBtn.addEventListener("click", loadActivityLog);
const reloadOrganizationBtn = document.getElementById("reloadOrganizationBtn");
if (reloadOrganizationBtn) reloadOrganizationBtn.addEventListener("click", loadOrganizationSettings);
const reloadUsersBtn = document.getElementById("reloadUsersBtn");
if (reloadUsersBtn) reloadUsersBtn.addEventListener("click", loadOrganizationMembers);`, 'settings reload listeners');

replaceOnce(`    activityRequest += 1;
    organizationId = null;
    savedCases = [];
    activityLogEntries = [];
    loadingCases = false;
    loadingActivity = false;`, `    activityRequest += 1;
    settingsRequest += 1;
    organizationId = null;
    savedCases = [];
    activityLogEntries = [];
    organizationSettings = null;
    organizationMembers = [];
    loadingCases = false;
    loadingActivity = false;
    loadingSettings = false;`, 'settings signout reset');

fs.writeFileSync(path, text);
