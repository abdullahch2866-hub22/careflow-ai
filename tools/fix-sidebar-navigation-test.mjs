import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(
  '<button type="button" class="nav-item active" data-view="dashboard" aria-current="page">Dashboard</button>',
  '<button type="button" id="navDashboard" class="nav-item active" data-view="dashboard" aria-current="page">Dashboard</button>',
  'dashboard nav id'
);
replaceOnce(
  '<button type="button" class="nav-item" data-view="documents">Documents</button>',
  '<button type="button" id="navDocuments" class="nav-item" data-view="documents">Documents</button>',
  'documents nav id'
);
replaceOnce(
  '<button type="button" class="nav-item" data-view="review">Review Queue</button>',
  '<button type="button" id="navReview" class="nav-item" data-view="review">Review Queue</button>',
  'review nav id'
);
replaceOnce(
  '<button type="button" class="nav-item" data-view="completed">Completed</button>',
  '<button type="button" id="navCompleted" class="nav-item" data-view="completed">Completed</button>',
  'completed nav id'
);
replaceOnce(
  '<button type="button" class="nav-item" data-view="activity">Activity Log</button>',
  '<button type="button" id="navActivity" class="nav-item" data-view="activity">Activity Log</button>',
  'activity nav id'
);

replaceOnce(
  'const VIEW_CONFIG = {',
  'const WORKSPACE_NAV_IDS = ["navDashboard", "navDocuments", "navReview", "navCompleted", "navActivity"];\n\nconst VIEW_CONFIG = {',
  'nav id constant'
);

replaceOnce(`  document.querySelectorAll("[data-view]").forEach(function(button) {
    const selected = button.dataset.view === activeView;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });`, `  WORKSPACE_NAV_IDS.forEach(function(id) {
    const button = document.getElementById(id);
    const selected = button.dataset.view === activeView;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });`, 'render nav buttons');

replaceOnce(
  '  document.querySelectorAll("[data-view]").forEach(function(button) { button.disabled = busy || editing || !organizationId; });',
  '  WORKSPACE_NAV_IDS.forEach(function(id) { document.getElementById(id).disabled = busy || editing || !organizationId; });',
  'disable nav buttons'
);

replaceOnce(`document.querySelectorAll("[data-view]").forEach(function(button) {
  button.addEventListener("click", function() { switchWorkspaceView(this.dataset.view); });
});`, `WORKSPACE_NAV_IDS.forEach(function(id) {
  const button = document.getElementById(id);
  button.addEventListener("click", function() { switchWorkspaceView(this.dataset.view); });
});`, 'nav listeners');

fs.writeFileSync(path, text);
