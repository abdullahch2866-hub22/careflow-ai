from pathlib import Path

script_path = Path('.github/scripts/apply_password_flow.py')
source = script_path.read_text()
start_marker = "replace_once(\n'''WORKSPACE_NAV_IDS.forEach(function(id) {''',"
end_marker = "\n\nreplace_once(\n'''supabaseClient.auth.onAuthStateChange(function(event) {"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate navigation replacement in password patch script.')
replacement = """replace_once(
'''WORKSPACE_NAV_IDS.forEach(function(id) {
  const button = document.getElementById(id);
  if (button) button.addEventListener(\"click\", function() { switchWorkspaceView(NAV_VIEW_BY_ID[id]); });
});''',
'''document.getElementById(\"forgotPasswordBtn\").addEventListener(\"click\", requestPasswordReset);
document.getElementById(\"passwordSetupForm\").addEventListener(\"submit\", saveNewPassword);
document.getElementById(\"passwordCancelBtn\").addEventListener(\"click\", leavePasswordFlow);
document.getElementById(\"signOutBtn\").addEventListener(\"click\", async function() {
  this.disabled = true;
  try {
    await supabaseClient.auth.signOut();
  } finally {
    this.disabled = false;
  }
});

WORKSPACE_NAV_IDS.forEach(function(id) {
  const button = document.getElementById(id);
  if (button) button.addEventListener(\"click\", function() { switchWorkspaceView(NAV_VIEW_BY_ID[id]); });
});''')"""
source = source[:start] + replacement + source[end:]
exec(compile(source, str(script_path), 'exec'), {})
