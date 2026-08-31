import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(`function renderWorkspaceView() {
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

  WORKSPACE_NAV_IDS.forEach(function(id) {
    const button = document.getElementById(id);
    const selected = button.dataset.view === activeView;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (!isActivity) renderCases();
}`, `function renderWorkspaceView() {
  const config = VIEW_CONFIG[activeView] || VIEW_CONFIG.dashboard;
  const title = document.getElementById("workspaceTitle");
  const subtitle = document.getElementById("workspaceSubtitle");
  const listTitle = document.getElementById("caseListTitle");
  if (title) title.textContent = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;
  if (listTitle) listTitle.textContent = config.listTitle;

  const isDashboard = activeView === "dashboard";
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
  if (activitySection) activitySection.hidden = !isActivity;

  WORKSPACE_NAV_IDS.forEach(function(id) {
    const button = document.getElementById(id);
    if (!button) return;
    const selected = button.dataset.view === activeView;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (!isActivity) renderCases();
}`, 'null-safe renderWorkspaceView');

replaceOnce(`  document.getElementById("reloadActivityBtn").disabled = busy || editing || !organizationId;
  WORKSPACE_NAV_IDS.forEach(function(id) { document.getElementById(id).disabled = busy || editing || !organizationId; });`, `  const reloadActivityBtn = document.getElementById("reloadActivityBtn");
  if (reloadActivityBtn) reloadActivityBtn.disabled = busy || editing || !organizationId;
  WORKSPACE_NAV_IDS.forEach(function(id) {
    const button = document.getElementById(id);
    if (button) button.disabled = busy || editing || !organizationId;
  });`, 'null-safe navigation controls');

replaceOnce(`WORKSPACE_NAV_IDS.forEach(function(id) {
  const button = document.getElementById(id);
  button.addEventListener("click", function() { switchWorkspaceView(this.dataset.view); });
});

document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await Promise.all([loadCases(), loadDashboardMetrics()]);
});

document.getElementById("reloadActivityBtn").addEventListener("click", loadActivityLog);`, `WORKSPACE_NAV_IDS.forEach(function(id) {
  const button = document.getElementById(id);
  if (button) button.addEventListener("click", function() { switchWorkspaceView(this.dataset.view); });
});

document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await Promise.all([loadCases(), loadDashboardMetrics()]);
});

const reloadActivityBtn = document.getElementById("reloadActivityBtn");
if (reloadActivityBtn) reloadActivityBtn.addEventListener("click", loadActivityLog);`, 'null-safe nav listeners');

fs.writeFileSync(path, text);
