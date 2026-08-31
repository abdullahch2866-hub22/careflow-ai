from pathlib import Path

script_path = Path('.github/scripts/apply_password_flow.py')
source = script_path.read_text()
old = '''replace_once(\n''' + "'''WORKSPACE_NAV_IDS.forEach(function(id) {''',\n'''" + '''document.getElementById("forgotPasswordBtn").addEventListener("click", requestPasswordReset);\ndocument.getElementById("passwordSetupForm").addEventListener("submit", saveNewPassword);\ndocument.getElementById("passwordCancelBtn").addEventListener("click", leavePasswordFlow);\ndocument.getElementById("signOutBtn").addEventListener("click", async function() {\n  this.disabled = true;\n  try {\n    await supabaseClient.auth.signOut();\n  } finally {\n    this.disabled = false;\n  }\n});\n\nWORKSPACE_NAV_IDS.forEach(function(id) {''')'''
new = '''replace_once(\n''' + "'''WORKSPACE_NAV_IDS.forEach(function(id) {\n  const button = document.getElementById(id);\n  if (button) button.addEventListener(\"click\", function() { switchWorkspaceView(NAV_VIEW_BY_ID[id]); });\n});''',\n'''" + '''document.getElementById("forgotPasswordBtn").addEventListener("click", requestPasswordReset);\ndocument.getElementById("passwordSetupForm").addEventListener("submit", saveNewPassword);\ndocument.getElementById("passwordCancelBtn").addEventListener("click", leavePasswordFlow);\ndocument.getElementById("signOutBtn").addEventListener("click", async function() {\n  this.disabled = true;\n  try {\n    await supabaseClient.auth.signOut();\n  } finally {\n    this.disabled = false;\n  }\n});\n\nWORKSPACE_NAV_IDS.forEach(function(id) {\n  const button = document.getElementById(id);\n  if (button) button.addEventListener(\"click\", function() { switchWorkspaceView(NAV_VIEW_BY_ID[id]); });\n});''')'''
if old not in source:
    raise SystemExit('Could not locate the ambiguous navigation replacement in the patch script.')
source = source.replace(old, new, 1)
exec(compile(source, str(script_path), 'exec'), {})
