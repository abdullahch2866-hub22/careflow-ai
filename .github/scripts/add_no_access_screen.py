from pathlib import Path

path = Path("index.html")
text = path.read_text()

html_anchor = '''</div>\n  <header class="header" style="display:none;">'''
html_insert = '''</div>\n\n<div id="noAccessPanel" hidden style="background:white; padding:32px; margin:25px; border:1px solid #e5e7eb; border-radius:14px; max-width:720px;">\n  <div style="font-size:14px; font-weight:700; color:#2563eb; margin-bottom:10px;">CareFlow AI</div>\n  <h2 style="margin-bottom:10px;">No hospital workspace access</h2>\n  <p style="color:#475569; line-height:1.6; margin-bottom:8px;">You no longer have access to a CareFlow hospital workspace. Contact your hospital administrator if you believe this is a mistake.</p>\n  <p id="noAccessEmail" style="color:#64748b; margin-bottom:20px;"></p>\n  <button type="button" id="noAccessSignOutBtn" class="button secondary">Sign Out</button>\n</div>\n\n  <header class="header" style="display:none;">'''
if 'id="noAccessPanel"' not in text:
    if html_anchor not in text:
        raise SystemExit("HTML insertion anchor not found")
    text = text.replace(html_anchor, html_insert, 1)

password_anchor = '''async function requestPasswordReset() {'''
no_access_fn = '''function setNoAccessVisible(visible, email = "") {\n  const panel = document.getElementById("noAccessPanel");\n  if (!panel) return;\n  panel.hidden = !visible;\n  if (!visible) return;\n  clearWorkspaceState();\n  activeView = "dashboard";\n  organizationId = null;\n  savedCases = [];\n  organizationSettings = null;\n  organizationMembers = [];\n  resetDashboardMetrics();\n  clearReview();\n  document.getElementById("noAccessEmail").textContent = email ? "Signed in as " + email : "";\n  document.getElementById("loginPanel").style.display = "none";\n  document.getElementById("passwordPanel").hidden = true;\n  document.querySelector(".header").style.display = "none";\n  document.querySelector(".layout").style.display = "none";\n}\n\n'''
if 'function setNoAccessVisible(' not in text:
    if password_anchor not in text:
        raise SystemExit("Function insertion anchor not found")
    text = text.replace(password_anchor, no_access_fn + password_anchor, 1)

start_anchor = '''  document.getElementById("caseListStatus").textContent = "";\n  document.querySelector(".header").style.display = "none";'''
start_replacement = '''  document.getElementById("caseListStatus").textContent = "";\n  setNoAccessVisible(false);\n  document.querySelector(".header").style.display = "none";'''
if start_replacement not in text:
    if start_anchor not in text:
        raise SystemExit("updateAuthUI start anchor not found")
    text = text.replace(start_anchor, start_replacement, 1)

membership_old = '''    const { data: membership, error: membershipError } = await supabaseClient\n      .from("organization_members").select("organization_id").eq("user_id", user.id).single();\n    if (request !== authRequest) return;\n    if (membershipError || !membership) throw membershipError || new Error("Hospital account not found.");\n    organizationId = membership.organization_id;'''
membership_new = '''    const { data: membership, error: membershipError } = await supabaseClient\n      .from("organization_members").select("organization_id").eq("user_id", user.id).maybeSingle();\n    if (request !== authRequest) return;\n    if (membershipError) throw membershipError;\n    if (!membership) {\n      setNoAccessVisible(true, user.email || "");\n      return;\n    }\n    organizationId = membership.organization_id;'''
if membership_new not in text:
    if membership_old not in text:
        raise SystemExit("Membership block not found")
    text = text.replace(membership_old, membership_new, 1)

listener_anchor = '''document.getElementById("signOutBtn").addEventListener("click", async function() {\n  this.disabled = true;\n  try {\n    await supabaseClient.auth.signOut();\n  } finally {\n    this.disabled = false;\n  }\n});'''
listener_replacement = listener_anchor + '''\n\ndocument.getElementById("noAccessSignOutBtn").addEventListener("click", async function() {\n  this.disabled = true;\n  try {\n    await supabaseClient.auth.signOut();\n  } finally {\n    this.disabled = false;\n  }\n});'''
if 'noAccessSignOutBtn").addEventListener' not in text:
    if listener_anchor not in text:
        raise SystemExit("Sign-out listener anchor not found")
    text = text.replace(listener_anchor, listener_replacement, 1)

signed_out_anchor = '''    document.getElementById("loginPanel").style.display = "block";\n    document.querySelector(".header").style.display = "none";\n    document.querySelector(".layout").style.display = "none";'''
signed_out_replacement = '''    setNoAccessVisible(false);\n    document.getElementById("loginPanel").style.display = "block";\n    document.querySelector(".header").style.display = "none";\n    document.querySelector(".layout").style.display = "none";'''
if signed_out_replacement not in text:
    if signed_out_anchor not in text:
        raise SystemExit("SIGNED_OUT anchor not found")
    text = text.replace(signed_out_anchor, signed_out_replacement, 1)

path.write_text(text)
