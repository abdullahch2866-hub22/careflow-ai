from pathlib import Path

path = Path("index.html")
text = path.read_text()

login_buttons_old = '''  <button type="button" id="loginBtn" class="button">Sign In</button>\n  <button type="button" id="forgotPasswordBtn" class="button secondary" style="margin-left:8px;">Forgot password</button>\n\n  <p id="loginStatus" role="status" style="margin-top:12px;"></p>'''
login_buttons_new = '''  <button type="button" id="loginBtn" class="button">Sign In</button>\n  <button type="button" id="forgotPasswordBtn" class="button secondary" style="margin-left:8px;">Forgot password</button>\n  <button type="button" id="showSignupBtn" class="button secondary" style="margin-left:8px;">Create hospital workspace</button>\n\n  <p id="loginStatus" role="status" style="margin-top:12px;"></p>'''
if login_buttons_new not in text:
    if login_buttons_old not in text:
        raise SystemExit("Login button anchor not found")
    text = text.replace(login_buttons_old, login_buttons_new, 1)

signup_anchor = '''</div>\n\n<div id="passwordPanel" hidden'''
signup_block = '''</div>\n\n<div id="signupPanel" hidden style="background:white; padding:25px; margin:25px; border:1px solid #e5e7eb; border-radius:12px; max-width:760px;">\n  <h2 style="margin-bottom:8px;">Create a hospital workspace</h2>\n  <p style="color:#64748b; margin-bottom:18px; line-height:1.5;">For a new hospital or clinic. The first account becomes that hospital's Admin. Existing staff should use an invitation from their hospital Admin.</p>\n  <form id="signupForm" autocomplete="off">\n    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; max-width:700px;">\n      <label class="staff-field" for="signupHospitalName">Hospital / clinic name\n        <input id="signupHospitalName" maxlength="120" required placeholder="Example Medical Center">\n      </label>\n      <label class="staff-field" for="signupEmail">Admin email address\n        <input id="signupEmail" type="email" maxlength="320" autocomplete="email" required placeholder="admin@example.com">\n      </label>\n      <label class="staff-field" for="signupPassword">Password\n        <input id="signupPassword" type="password" minlength="15" autocomplete="new-password" required placeholder="Create a strong password">\n      </label>\n      <label class="staff-field" for="signupPasswordConfirm">Confirm password\n        <input id="signupPasswordConfirm" type="password" minlength="15" autocomplete="new-password" required placeholder="Confirm password">\n      </label>\n    </div>\n    <p style="color:#64748b; margin-top:12px; line-height:1.5;">Use at least 15 characters with uppercase, lowercase, a number, and a symbol.</p>\n    <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">\n      <button type="submit" id="signupBtn" class="button">Create hospital account</button>\n      <button type="button" id="signupCancelBtn" class="button secondary">Back to login</button>\n    </div>\n  </form>\n  <p id="signupStatus" role="status" style="margin-top:12px;"></p>\n</div>\n\n<div id="passwordPanel" hidden'''
if 'id="signupPanel"' not in text:
    if signup_anchor not in text:
        raise SystemExit("Signup panel anchor not found")
    text = text.replace(signup_anchor, signup_block, 1)

password_fn_anchor = '''function setPasswordPanelVisible(visible, mode = "setup") {'''
signup_functions = '''function setSignupPanelVisible(visible) {\n  const panel = document.getElementById("signupPanel");\n  if (!panel) return;\n  panel.hidden = !visible;\n  if (!visible) return;\n  document.getElementById("loginPanel").style.display = "none";\n  document.getElementById("passwordPanel").hidden = true;\n  document.getElementById("noAccessPanel").hidden = true;\n  document.querySelector(".header").style.display = "none";\n  document.querySelector(".layout").style.display = "none";\n  document.getElementById("signupStatus").textContent = "";\n  setTimeout(function() { document.getElementById("signupHospitalName").focus(); }, 0);\n}\n\nasync function createHospitalAccount(event) {\n  event.preventDefault();\n  const hospitalInput = document.getElementById("signupHospitalName");\n  const emailInput = document.getElementById("signupEmail");\n  const passwordInput = document.getElementById("signupPassword");\n  const confirmationInput = document.getElementById("signupPasswordConfirm");\n  const button = document.getElementById("signupBtn");\n  const status = document.getElementById("signupStatus");\n  const hospitalName = hospitalInput.value.trim().replace(/\\s+/g, " ");\n  const email = emailInput.value.trim().toLowerCase();\n  const password = passwordInput.value;\n  const confirmation = confirmationInput.value;\n\n  if (hospitalName.length < 2 || hospitalName.length > 120) {\n    status.textContent = "Enter a hospital or clinic name between 2 and 120 characters.";\n    hospitalInput.focus();\n    return;\n  }\n  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {\n    status.textContent = "Enter a valid admin email address.";\n    emailInput.focus();\n    return;\n  }\n  if (password.length < 15 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {\n    status.textContent = "Use at least 15 characters with uppercase, lowercase, a number, and a symbol.";\n    passwordInput.focus();\n    return;\n  }\n  if (password !== confirmation) {\n    status.textContent = "The two passwords do not match.";\n    confirmationInput.focus();\n    return;\n  }\n\n  button.disabled = true;\n  status.textContent = "Creating your CareFlow account...";\n  try {\n    const { data, error } = await supabaseClient.auth.signUp({\n      email,\n      password,\n      options: {\n        emailRedirectTo: CAREFLOW_APP_URL,\n        data: {\n          careflow_signup_type: "hospital_owner",\n          careflow_hospital_name: hospitalName,\n          careflow_password_set: true\n        }\n      }\n    });\n    if (error) throw error;\n    passwordInput.value = "";\n    confirmationInput.value = "";\n    if (data?.session) {\n      status.textContent = "Account created. Creating your hospital workspace...";\n      setSignupPanelVisible(false);\n      await updateAuthUI();\n    } else {\n      status.textContent = "Account created. Check the newest verification email, verify the address, then return to CareFlow. Your hospital workspace will be created automatically after verification.";\n    }\n  } catch (error) {\n    status.textContent = "Could not create the hospital account. " + (error.message || "Please try again.");\n  } finally {\n    button.disabled = false;\n  }\n}\n\n'''
if 'async function createHospitalAccount(' not in text:
    if password_fn_anchor not in text:
        raise SystemExit("Password function anchor not found")
    text = text.replace(password_fn_anchor, signup_functions + password_fn_anchor, 1)

password_visible_old = '''  if (!visible) return;\n  document.getElementById("loginPanel").style.display = "none";\n  document.querySelector(".header").style.display = "none";'''
password_visible_new = '''  if (!visible) return;\n  setSignupPanelVisible(false);\n  document.getElementById("loginPanel").style.display = "none";\n  document.querySelector(".header").style.display = "none";'''
if password_visible_new not in text:
    if password_visible_old not in text:
        raise SystemExit("Password visibility anchor not found")
    text = text.replace(password_visible_old, password_visible_new, 1)

no_access_old = '''  if (!visible) return;\n  clearWorkspaceState();\n  activeView = "dashboard";'''
no_access_new = '''  if (!visible) return;\n  setSignupPanelVisible(false);\n  clearWorkspaceState();\n  activeView = "dashboard";'''
if no_access_new not in text:
    if no_access_old not in text:
        raise SystemExit("No-access visibility anchor not found")
    text = text.replace(no_access_old, no_access_new, 1)

user_anchor_old = '''    if (error) throw error;\n    currentAuthUserId = user.id;\n    const restoreState = readWorkspaceState(user.id);'''
user_anchor_new = '''    if (error) throw error;\n    currentAuthUserId = user.id;\n    setSignupPanelVisible(false);\n    const restoreState = readWorkspaceState(user.id);'''
if user_anchor_new not in text:
    if user_anchor_old not in text:
        raise SystemExit("Authenticated user anchor not found")
    text = text.replace(user_anchor_old, user_anchor_new, 1)

membership_old = '''    setPasswordPanelVisible(false);\n    document.getElementById("loginPanel").style.display = "none";\n    document.querySelector(".header").style.display = "flex";\n    document.querySelector(".layout").style.display = "flex";\n    const { data: membership, error: membershipError } = await supabaseClient\n      .from("organization_members").select("organization_id").eq("user_id", user.id).single();\n    if (request !== authRequest) return;\n    const noMembership = membershipError?.code === "PGRST116" || /0 rows|no rows|multiple \\(or no\\) rows/i.test(membershipError?.details || membershipError?.message || "");\n    if (membershipError && !noMembership) throw membershipError;\n    if (!membership || noMembership) {\n      setNoAccessVisible(true, user.email || "");\n      return;\n    }\n    organizationId = membership.organization_id;\n    renderWorkspaceView();'''
membership_new = '''    setPasswordPanelVisible(false);\n    document.getElementById("loginPanel").style.display = "none";\n    const { data: membership, error: membershipError } = await supabaseClient\n      .from("organization_members").select("organization_id").eq("user_id", user.id).single();\n    if (request !== authRequest) return;\n    const noMembership = membershipError?.code === "PGRST116" || /0 rows|no rows|multiple \\(or no\\) rows/i.test(membershipError?.details || membershipError?.message || "");\n    if (membershipError && !noMembership) throw membershipError;\n\n    let resolvedOrganizationId = membership && !noMembership ? membership.organization_id : null;\n    if (!resolvedOrganizationId) {\n      if (user.user_metadata?.careflow_signup_type === "hospital_owner") {\n        document.getElementById("loginStatus").textContent = "Creating your hospital workspace...";\n        const { data: onboardingData, error: onboardingError } = await supabaseClient.rpc("complete_hospital_onboarding");\n        if (request !== authRequest) return;\n        if (onboardingError) throw onboardingError;\n        const onboarding = Array.isArray(onboardingData) ? onboardingData[0] : onboardingData;\n        if (onboarding?.organization_id) {\n          resolvedOrganizationId = onboarding.organization_id;\n        } else if (onboarding?.onboarding_state === "already_completed") {\n          setNoAccessVisible(true, user.email || "");\n          return;\n        } else {\n          throw new Error("Hospital onboarding did not return a workspace.");\n        }\n      } else {\n        setNoAccessVisible(true, user.email || "");\n        return;\n      }\n    }\n\n    organizationId = resolvedOrganizationId;\n    document.querySelector(".header").style.display = "flex";\n    document.querySelector(".layout").style.display = "flex";\n    renderWorkspaceView();'''
if membership_new not in text:
    if membership_old not in text:
        raise SystemExit("Membership onboarding anchor not found")
    text = text.replace(membership_old, membership_new, 1)

listener_anchor = '''document.getElementById("forgotPasswordBtn").addEventListener("click", requestPasswordReset);\ndocument.getElementById("passwordSetupForm").addEventListener("submit", saveNewPassword);'''
listener_new = '''document.getElementById("forgotPasswordBtn").addEventListener("click", requestPasswordReset);\ndocument.getElementById("showSignupBtn").addEventListener("click", function() { setSignupPanelVisible(true); });\ndocument.getElementById("signupForm").addEventListener("submit", createHospitalAccount);\ndocument.getElementById("signupCancelBtn").addEventListener("click", function() {\n  setSignupPanelVisible(false);\n  document.getElementById("loginPanel").style.display = "block";\n});\ndocument.getElementById("passwordSetupForm").addEventListener("submit", saveNewPassword);'''
if listener_new not in text:
    if listener_anchor not in text:
        raise SystemExit("Signup listener anchor not found")
    text = text.replace(listener_anchor, listener_new, 1)

signed_out_old = '''  if (event === "SIGNED_OUT") {\n    recoveryFlowRequested = false;\n    setPasswordPanelVisible(false);'''
signed_out_new = '''  if (event === "SIGNED_OUT") {\n    recoveryFlowRequested = false;\n    setSignupPanelVisible(false);\n    setPasswordPanelVisible(false);'''
if signed_out_new not in text:
    if signed_out_old not in text:
        raise SystemExit("SIGNED_OUT anchor not found")
    text = text.replace(signed_out_old, signed_out_new, 1)

path.write_text(text)
