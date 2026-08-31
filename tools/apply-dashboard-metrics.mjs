import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText) {
  const first = text.indexOf(oldText);
  if (first === -1) throw new Error(`Patch target not found: ${oldText.slice(0, 80)}`);
  if (text.indexOf(oldText, first + oldText.length) !== -1) throw new Error(`Patch target is not unique: ${oldText.slice(0, 80)}`);
  text = text.slice(0, first) + newText + text.slice(first + oldText.length);
}

replaceOnce(`        <div class="card">
          <div class="card-title">Documents Today</div>
          <div class="card-number">24</div>
        </div>

        <div class="card">
          <div class="card-title">Awaiting Review</div>
          <div class="card-number">7</div>
        </div>

        <div class="card">
          <div class="card-title">Completed</div>
          <div class="card-number">17</div>
        </div>

        <div class="card">
          <div class="card-title">Time Saved</div>
          <div class="card-number">6.4h</div>
        </div>`, `        <div class="card">
          <div class="card-title">Documents Today</div>
          <div class="card-number" id="metricDocumentsToday" aria-live="polite">—</div>
        </div>

        <div class="card">
          <div class="card-title">Awaiting Review</div>
          <div class="card-number" id="metricAwaitingReview" aria-live="polite">—</div>
        </div>

        <div class="card">
          <div class="card-title">Completed</div>
          <div class="card-number" id="metricCompleted" aria-live="polite">—</div>
        </div>

        <div class="card" title="Estimated at 15 minutes saved per completed case.">
          <div class="card-title">Estimated Time Saved</div>
          <div class="card-number" id="metricTimeSaved" aria-live="polite">—</div>
        </div>`);

replaceOnce(`      </section>

      <section class="upload">`, `      </section>
      <p id="dashboardMetricsStatus" role="status" style="margin-top:-18px; margin-bottom:24px; color:#b91c1c;"></p>

      <section class="upload">`);

replaceOnce(`    #caseListStatus:empty { display: none; }`, `    #caseListStatus:empty, #dashboardMetricsStatus:empty { display: none; }`);
replaceOnce(`const CASE_LIST_LIMIT = 50;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;`, `const CASE_LIST_LIMIT = 50;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ESTIMATED_MINUTES_SAVED_PER_COMPLETED_CASE = 15;`);
replaceOnce(`let authRequest = 0;
let listRequest = 0;
let reviewRequest = 0;`, `let authRequest = 0;
let listRequest = 0;
let reviewRequest = 0;
let dashboardRequest = 0;`);

replaceOnce(`function updateControls() {`, `function resetDashboardMetrics(message = "") {
  document.getElementById("metricDocumentsToday").textContent = "—";
  document.getElementById("metricAwaitingReview").textContent = "—";
  document.getElementById("metricCompleted").textContent = "—";
  document.getElementById("metricTimeSaved").textContent = "—";
  document.getElementById("dashboardMetricsStatus").textContent = message;
}

function localDayBoundsIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatEstimatedTimeSaved(completedCount) {
  const minutes = completedCount * ESTIMATED_MINUTES_SAVED_PER_COMPLETED_CASE;
  if (minutes < 60) return minutes + "m";
  const hours = minutes / 60;
  return (Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)) + "h";
}

async function loadDashboardMetrics() {
  if (!organizationId) {
    resetDashboardMetrics();
    return false;
  }
  const request = ++dashboardRequest;
  const requestedOrganization = organizationId;
  const bounds = localDayBoundsIso();
  const status = document.getElementById("dashboardMetricsStatus");
  status.textContent = "Updating dashboard totals...";
  try {
    const [todayResult, awaitingResult, completedResult] = await Promise.all([
      supabaseClient.from("cases").select("id", { count: "exact", head: true })
        .eq("organization_id", requestedOrganization)
        .gte("created_at", bounds.start).lt("created_at", bounds.end),
      supabaseClient.from("cases").select("id", { count: "exact", head: true })
        .eq("organization_id", requestedOrganization)
        .in("status", ["Review", "Correction Required"]),
      supabaseClient.from("cases").select("id", { count: "exact", head: true })
        .eq("organization_id", requestedOrganization)
        .eq("status", "Completed")
    ]);
    if (request !== dashboardRequest || requestedOrganization !== organizationId) return false;
    const failed = [todayResult, awaitingResult, completedResult].find(result => result.error);
    if (failed) throw failed.error;
    const documentsToday = todayResult.count ?? 0;
    const awaitingReview = awaitingResult.count ?? 0;
    const completed = completedResult.count ?? 0;
    document.getElementById("metricDocumentsToday").textContent = String(documentsToday);
    document.getElementById("metricAwaitingReview").textContent = String(awaitingReview);
    document.getElementById("metricCompleted").textContent = String(completed);
    document.getElementById("metricTimeSaved").textContent = formatEstimatedTimeSaved(completed);
    status.textContent = "";
    return true;
  } catch (error) {
    if (request === dashboardRequest && requestedOrganization === organizationId) {
      resetDashboardMetrics("Could not load dashboard totals. Use Reload cases to retry.");
      console.error("Dashboard metrics load failed:", error);
    }
    return false;
  }
}

function updateControls() {`);

replaceOnce(`  listRequest += 1;
  clearReview();`, `  listRequest += 1;
  dashboardRequest += 1;
  resetDashboardMetrics();
  clearReview();`);
replaceOnce(`    updateControls();
    await loadCases();`, `    updateControls();
    await Promise.all([loadCases(), loadDashboardMetrics()]);`);
replaceOnce(`document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await loadCases();
});`, `document.getElementById("reloadCasesBtn").addEventListener("click", async function() {
  clearReview();
  await Promise.all([loadCases(), loadDashboardMetrics()]);
});`);
replaceOnce(`    if (caseSaved && requestedAuth === authRequest && requestedOrganization === organizationId) await loadCases();`, `    if (caseSaved && requestedAuth === authRequest && requestedOrganization === organizationId) {
      await Promise.all([loadCases(), loadDashboardMetrics()]);
    }`);
replaceOnce(`    renderCases();
    renderReview(currentCase);
    message.textContent = fromEditor ?`, `    renderCases();
    renderReview(currentCase);
    await loadDashboardMetrics();
    message.textContent = fromEditor ?`);
replaceOnce(`    listRequest += 1;
    organizationId = null;`, `    listRequest += 1;
    dashboardRequest += 1;
    organizationId = null;`);
replaceOnce(`    loadingCases = false;
    clearReview();`, `    loadingCases = false;
    resetDashboardMetrics();
    clearReview();`);

fs.writeFileSync(path, text);
