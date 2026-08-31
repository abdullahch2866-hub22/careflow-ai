// Synthetic data only. This file is served by serve-fixture.mjs, never the app.
const fixtureOrg = "fixture-hospital-a";
let fixtureCases = JSON.parse(sessionStorage.getItem("careflow-fixture-cases") || "null") || [
  { id: 8, document_id: "fixture-document-8", organization_id: fixtureOrg, file_name: "Example_A.pdf", document_type: "Healthcare document", status: "Correction Required", created_at: "2026-08-31T00:22:45Z", patient_name: "Sample Patient A", document_date: "2026-08-12", insurance_information: "Sample insurer A", missing_information: "Sample missing contact" },
  { id: 7, document_id: "fixture-document-7", organization_id: fixtureOrg, file_name: "<img src=x onerror=alert(1)>.pdf", document_type: "Healthcare document", status: "Review", created_at: "2026-08-26T00:00:00Z", patient_name: "Sample Patient B", document_date: "2026-08-12", insurance_information: "Sample insurer B", missing_information: null },
  { id: 6, document_id: "fixture-document-6", organization_id: "fixture-hospital-b", file_name: "OTHER_HOSPITAL_PRIVATE.pdf", status: "Review", created_at: "2026-08-20T00:00:00Z" }
];
fixtureCases.forEach(row => { row.review_revision ??= 1; row.review_confirmed ??= false; row.review_notes ??= null; });
let fixtureFailSave = false;
let fixtureFailList = false;
let fixtureEmpty = false;
let fixtureSignedOut = new URLSearchParams(location.search).has("signed-out");
let fixtureAuthCallback = function() {};
let fixtureLog = [];

function recordFixtureQuery(entry) {
  fixtureLog.push(entry);
  const output = document.getElementById("fixtureLog");
  if (output) output.textContent = fixtureLog.join("\n");
}
function storeFixtureCases() { sessionStorage.setItem("careflow-fixture-cases", JSON.stringify(fixtureCases)); }
function fixtureQuery(table) {
  let filters = [], action = "select", payload, single = false, limit = 1000, order = [];
  const builder = {
    select() { return builder; },
    eq(column, value) { filters.push([column, value]); return builder; },
    order(column, options) { order.push([column, options.ascending]); return builder; },
    limit(value) { limit = value; return builder; },
    single() { single = true; return builder; },
    insert(value) { action = "insert"; payload = value; return builder; },
    update(value) { action = "update"; payload = value; return builder; },
    async then(resolve, reject) {
      try {
        recordFixtureQuery(action + " " + table + " " + JSON.stringify(filters));
        if (table === "organization_members") return resolve({ data: { organization_id: fixtureOrg }, error: null });
        if (table === "documents" && action === "insert") return resolve({ data: { id: "fixture-document-new" }, error: null });
        if (table !== "cases") throw new Error("Unexpected fixture table");
        if (action === "insert") {
          fixtureCases.push({ ...payload[0], id: 9, created_at: "2026-09-01T00:00:00Z", review_revision: 0, review_confirmed: false, review_notes: null });
          storeFixtureCases();
          return resolve({ data: null, error: null });
        }
        if (action === "update" && fixtureFailSave) {
          fixtureFailSave = false;
          return resolve({ data: null, error: { message: "Fixture: save rejected" } });
        }
        if (action === "select" && !single && fixtureFailList) {
          fixtureFailList = false;
          return resolve({ data: null, error: { message: "Fixture: list unavailable" } });
        }
        let rows = fixtureEmpty ? [] : fixtureCases.filter(row => filters.every(([key, value]) => row[key] === value));
        if (action === "update") {
          rows.forEach(row => Object.assign(row, payload, { review_revision: row.review_revision + 1, updated_by: "fixture-user", updated_at: "2026-08-31T12:00:00Z" }));
          storeFixtureCases();
        }
        rows = [...rows].sort((a, b) => {
          for (const [key, ascending] of order) {
            if (a[key] < b[key]) return ascending ? -1 : 1;
            if (a[key] > b[key]) return ascending ? 1 : -1;
          }
          return 0;
        }).slice(0, limit);
        if (single && rows.length !== 1) return resolve({ data: null, error: { message: "Fixture: expected one row" } });
        return resolve({ data: structuredClone(single ? rows[0] : rows), error: null });
      } catch (error) { return reject(error); }
    }
  };
  return builder;
}
window.supabase = { createClient() { return {
  auth: {
    async getUser() { return { data: { user: fixtureSignedOut ? null : { id: "fixture-user" } }, error: null }; },
    async signInWithPassword() { throw new Error("Fixture does not accept credentials"); },
    onAuthStateChange(callback) { fixtureAuthCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; }
  },
  from: fixtureQuery,
  storage: { from() { return { async upload() { recordFixtureQuery("storage upload"); return { data: {}, error: null }; } }; } },
  functions: { async invoke() {
    recordFixtureQuery("invoke process-document");
    const extracted = { patient_name: "Uploaded Sample Patient", document_date: "2026-08-31", insurance_information: "Uploaded sample insurer", missing_information: "Sample missing contact" };
    Object.assign(fixtureCases.find(row => row.id === 9), extracted, { review_revision: 1 });
    storeFixtureCases();
    return { data: { success: true, extracted }, error: null };
  } }
}; } };

document.addEventListener("DOMContentLoaded", function() {
  const controls = document.createElement("aside");
  controls.style.cssText = "padding:20px;background:#fff7ed;border:3px solid #c2410c;margin:20px;";
  const title = document.createElement("h2");
  title.textContent = "Local test fixture — synthetic data, no live backend";
  controls.append(title);
  const actions = {
    "Fail next save": () => { fixtureFailSave = true; },
    "Fail next list": () => { fixtureFailList = true; },
    "Toggle empty results": () => { fixtureEmpty = !fixtureEmpty; },
    "Expire session": () => { fixtureSignedOut = true; fixtureAuthCallback("SIGNED_OUT"); },
    "Simulate PDF selection": () => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["Synthetic fixture"], "Example_Upload.pdf", { type: "application/pdf" }));
      const input = document.getElementById("documentInput");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  for (const [label, handler] of Object.entries(actions)) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "padding:10px;margin:6px;";
    button.onclick = handler;
    controls.append(button);
  }
  const log = document.createElement("pre");
  log.id = "fixtureLog";
  log.style.whiteSpace = "pre-wrap";
  log.textContent = fixtureLog.join("\n");
  controls.append(log);
  document.body.append(controls);
});
