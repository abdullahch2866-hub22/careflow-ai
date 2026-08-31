import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(
`    .current-user-badge { margin-left: 8px; color: #166534; font-size: 12px; font-weight: 700; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }`,
`    .current-user-badge { margin-left: 8px; color: #166534; font-size: 12px; font-weight: 700; }
    .account-badge { margin-left: 8px; color: #475569; font-size: 12px; font-weight: 700; }
    .staff-admin-panel { padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
    .staff-admin-panel h3 { margin-bottom: 6px; }
    .staff-invite-form { display: grid; grid-template-columns: minmax(220px, 1fr) 150px auto; gap: 12px; align-items: end; margin-top: 16px; }
    .staff-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: #334155; }
    .staff-field input, .staff-field select, .member-actions select { padding: 10px 11px; border: 1px solid #94a3b8; border-radius: 7px; font-size: 15px; background: white; color: #172033; }
    .member-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .member-action-btn { padding: 8px 12px; }
    .button.danger { background: #dc2626; color: white; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }`,
'add staff management styles');

replaceOnce(
`    @media (max-width: 600px) {
      .case { align-items: flex-start; flex-direction: column; }
      .review-grid { grid-template-columns: 1fr; }`,
`    @media (max-width: 600px) {
      .case { align-items: flex-start; flex-direction: column; }
      .review-grid { grid-template-columns: 1fr; }
      .staff-invite-form { grid-template-columns: 1fr; }
      .member-row { align-items: flex-start; flex-direction: column; }
      .member-actions { width: 100%; justify-content: flex-start; }`,
'mobile staff styles');

replaceOnce(
`      <section id="usersSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Users</span>
          <button type="button" id="reloadUsersBtn" class="button" disabled>Reload users</button>
        </div>
        <p id="usersStatus" role="status" style="padding:12px 20px;"></p>
        <div id="usersList"></div>
        <p class="review-help" style="padding:0 20px 20px;">Only members of this hospital are shown. Inviting, changing roles, and removing users will be added as a separate secured workflow.</p>
      </section>`,
`      <section id="usersSection" class="recent" hidden>
        <div class="recent-header case-list-header">
          <span>Users</span>
          <button type="button" id="reloadUsersBtn" class="button" disabled>Reload users</button>
        </div>
        <p id="usersStatus" role="status" style="padding:12px 20px;"></p>
        <div id="staffAdminPanel" class="staff-admin-panel" hidden>
          <h3>Invite hospital staff</h3>
          <p class="review-help">Admins can invite staff or another admin. Permissions are enforced by the CareFlow backend, not only by these controls.</p>
          <form id="inviteUserForm" class="staff-invite-form" autocomplete="off">
            <label class="staff-field" for="inviteUserEmail">Email address
              <input id="inviteUserEmail" type="email" maxlength="320" required placeholder="staff@example.com">
            </label>
            <label class="staff-field" for="inviteUserRole">Role
              <select id="inviteUserRole"><option value="staff">Staff</option><option value="admin">Admin</option></select>
            </label>
            <button type="submit" id="inviteUserBtn" class="button">Send invite</button>
          </form>
          <p id="staffActionStatus" role="status" class="review-help" style="margin-top:12px;"></p>
        </div>
        <div id="usersList"></div>
        <p class="review-help" style="padding:0 20px 20px;">Only members of this hospital are shown. Admin actions are protected on the backend, self-removal and self-demotion are blocked, and the hospital must always retain an admin.</p>
      </section>`,
'upgrade users section');

replaceOnce(
`let loadingSettings = false;
let settingsRequest = 0;
let activeView = "dashboard";`,
`let loadingSettings = false;
let settingsRequest = 0;
let staffActionPending = false;
let activeView = "dashboard";`,
'add staff action state');

replaceOnce(
`  if (view === "activity") await loadActivityLog();
  if (view === "organization") await loadOrganizationSettings();
  if (view === "users") await loadOrganizationMembers();`,
`  if (view === "activity") await loadActivityLog();
  if (view === "organization") await loadOrganizationSettings();
  if (view === "users") {
    await loadOrganizationSettings();
    await loadOrganizationMembers();
  }`,
'load permissions before users');

replaceOnce(
`function renderOrganizationSettings() {
  document.getElementById("organizationName").textContent = organizationSettings?.organization_name || "Not available";
  document.getElementById("organizationRole").textContent = organizationSettings?.my_role || "Not available";
  document.getElementById("organizationMemberCount").textContent = organizationSettings?.member_count == null ? "—" : String(organizationSettings.member_count);
  document.getElementById("organizationCreatedAt").textContent = formatWorkspaceDate(organizationSettings?.organization_created_at);
}`,
`function isOrganizationAdmin() {
  return organizationSettings?.my_role === "admin";
}

function renderStaffAdminVisibility() {
  const panel = document.getElementById("staffAdminPanel");
  if (panel) panel.hidden = !isOrganizationAdmin();
}

function renderOrganizationSettings() {
  document.getElementById("organizationName").textContent = organizationSettings?.organization_name || "Not available";
  document.getElementById("organizationRole").textContent = organizationSettings?.my_role || "Not available";
  document.getElementById("organizationMemberCount").textContent = organizationSettings?.member_count == null ? "—" : String(organizationSettings.member_count);
  document.getElementById("organizationCreatedAt").textContent = formatWorkspaceDate(organizationSettings?.organization_created_at);
  renderStaffAdminVisibility();
}`,
'add admin visibility helper');

const oldRenderMembers = `function renderOrganizationMembers() {
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
}`;

const newRenderMembers = `function renderOrganizationMembers() {
  const list = document.getElementById("usersList");
  list.replaceChildren();
  renderStaffAdminVisibility();
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
    const account = document.createElement("span");
    account.className = "account-badge";
    account.textContent = member.account_status || "Active";
    email.append(account);
    const meta = document.createElement("div");
    meta.className = "member-meta";
    meta.textContent = "Joined " + formatWorkspaceDate(member.joined_at);
    details.append(email, meta);

    const actions = document.createElement("div");
    actions.className = "member-actions";
    if (isOrganizationAdmin() && !member.is_current) {
      const roleSelect = document.createElement("select");
      roleSelect.className = "staff-manage-control";
      roleSelect.setAttribute("aria-label", "Role for " + (member.email || "hospital user"));
      ["staff", "admin"].forEach(function(value) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === "admin" ? "Admin" : "Staff";
        if (member.role === value) option.selected = true;
        roleSelect.append(option);
      });

      const saveRole = document.createElement("button");
      saveRole.type = "button";
      saveRole.className = "button member-action-btn staff-manage-control";
      saveRole.textContent = "Save role";
      saveRole.addEventListener("click", function() {
        if (roleSelect.value === member.role) {
          document.getElementById("staffActionStatus").textContent = "No role change is needed for " + member.email + ".";
          return;
        }
        runStaffAction({ action: "change_role", email: member.email, role: roleSelect.value }, "Updating role...");
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button danger member-action-btn staff-manage-control";
      remove.textContent = "Remove";
      remove.addEventListener("click", function() {
        if (!window.confirm("Remove " + member.email + " from this hospital? Their CareFlow sign-in account will not be deleted.")) return;
        runStaffAction({ action: "remove", email: member.email }, "Removing user...");
      });
      actions.append(roleSelect, saveRole, remove);
    } else {
      const role = document.createElement("span");
      role.className = "role-badge";
      role.textContent = member.role || "member";
      actions.append(role);
    }

    row.append(details, actions);
    list.append(row);
  });
  updateControls();
}`;
replaceOnce(oldRenderMembers, newRenderMembers, 'upgrade member rendering');

replaceOnce(
`    const { data, error } = await supabaseClient.rpc("careflow_my_organization_members");`,
`    const { data, error } = await supabaseClient.rpc("careflow_my_organization_members_v2");`,
'use secure members v2 RPC');

replaceOnce(
`function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings;`,
`async function invokeStaffManagement(payload) {
  const { data, error } = await supabaseClient.functions.invoke("manage-staff", { body: payload });
  if (error) {
    let details = error.message || "Staff management failed.";
    try {
      if (error.context) {
        const body = await error.context.clone().json();
        details = body.error || body.message || details;
      }
    } catch (_) { /* Use the original function error. */ }
    throw new Error(details);
  }
  if (!data?.success) throw new Error(data?.error || "Staff management did not confirm success.");
  return data;
}

async function runStaffAction(payload, pendingMessage) {
  if (!organizationId || !isOrganizationAdmin() || staffActionPending) return false;
  const requestedOrganization = organizationId;
  const status = document.getElementById("staffActionStatus");
  staffActionPending = true;
  status.textContent = pendingMessage;
  updateControls();
  try {
    const result = await invokeStaffManagement(payload);
    if (requestedOrganization !== organizationId) return false;
    await loadOrganizationSettings();
    await loadOrganizationMembers();
    status.textContent = result.message || "Staff settings updated.";
    return true;
  } catch (error) {
    if (requestedOrganization === organizationId) {
      status.textContent = "Could not update staff. " + (error.message || "Please try again.");
    }
    return false;
  } finally {
    staffActionPending = false;
    updateControls();
  }
}

async function inviteHospitalUser(event) {
  event.preventDefault();
  if (!isOrganizationAdmin() || staffActionPending) return;
  const emailInput = document.getElementById("inviteUserEmail");
  const roleInput = document.getElementById("inviteUserRole");
  const email = emailInput.value.trim().toLowerCase();
  if (!email) {
    document.getElementById("staffActionStatus").textContent = "Enter the staff member's email address.";
    return;
  }
  const success = await runStaffAction({ action: "invite", email, role: roleInput.value }, "Sending secure invitation...");
  if (success) emailInput.value = "";
}

function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings || staffActionPending;`,
'add staff action functions');

replaceOnce(
`  const reloadUsersBtn = document.getElementById("reloadUsersBtn");
  if (reloadUsersBtn) reloadUsersBtn.disabled = busy || editing || !organizationId;
  WORKSPACE_NAV_IDS.forEach(function(id) {`,
`  const reloadUsersBtn = document.getElementById("reloadUsersBtn");
  if (reloadUsersBtn) reloadUsersBtn.disabled = busy || editing || !organizationId;
  const inviteUserBtn = document.getElementById("inviteUserBtn");
  const inviteUserEmail = document.getElementById("inviteUserEmail");
  const inviteUserRole = document.getElementById("inviteUserRole");
  if (inviteUserBtn) inviteUserBtn.disabled = busy || !isOrganizationAdmin();
  if (inviteUserEmail) inviteUserEmail.disabled = busy || !isOrganizationAdmin();
  if (inviteUserRole) inviteUserRole.disabled = busy || !isOrganizationAdmin();
  document.querySelectorAll(".staff-manage-control").forEach(function(control) {
    control.disabled = busy || !isOrganizationAdmin();
  });
  WORKSPACE_NAV_IDS.forEach(function(id) {`,
'control staff management buttons');

replaceOnce(
`  loadingSettings = false;
  activeView = "dashboard";`,
`  loadingSettings = false;
  staffActionPending = false;
  activeView = "dashboard";`,
'reset staff state on auth refresh');

replaceOnce(
`const reloadUsersBtn = document.getElementById("reloadUsersBtn");
if (reloadUsersBtn) reloadUsersBtn.addEventListener("click", loadOrganizationMembers);

document.getElementById("uploadBtn")`,
`const reloadUsersBtn = document.getElementById("reloadUsersBtn");
if (reloadUsersBtn) reloadUsersBtn.addEventListener("click", async function() {
  await loadOrganizationSettings();
  await loadOrganizationMembers();
});
const inviteUserForm = document.getElementById("inviteUserForm");
if (inviteUserForm) inviteUserForm.addEventListener("submit", inviteHospitalUser);

document.getElementById("uploadBtn")`,
'wire staff management events');

replaceOnce(
`    loadingSettings = false;
    activeView = "dashboard";`,
`    loadingSettings = false;
    staffActionPending = false;
    activeView = "dashboard";`,
'reset staff state on signout');

replaceOnce(
`    document.getElementById("caseListStatus").textContent = "";
    document.getElementById("loginPanel").style.display = "block";`,
`    document.getElementById("caseListStatus").textContent = "";
    const staffActionStatus = document.getElementById("staffActionStatus");
    if (staffActionStatus) staffActionStatus.textContent = "";
    document.getElementById("loginPanel").style.display = "block";`,
'clear staff message on signout');

fs.writeFileSync(path, text);
