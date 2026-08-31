from pathlib import Path

index_path = Path("index.html")
text = index_path.read_text()

old_actions = '''    <div style="padding:20px;">\n      <button type="button" id="editDetailsBtn" class="button" disabled>Edit Details</button>\n    </div>'''
new_actions = '''    <div style="padding:20px; display:flex; gap:12px; flex-wrap:wrap;">\n      <button type="button" id="viewSourceBtn" class="button secondary" disabled>View Source PDF</button>\n      <button type="button" id="editDetailsBtn" class="button" disabled>Edit Details</button>\n    </div>'''
if new_actions not in text:
    if old_actions not in text:
        raise SystemExit("Review action anchor not found")
    text = text.replace(old_actions, new_actions, 1)

modal_anchor = '''  <p id="reviewActionStatus" role="status" style="padding:0 20px 20px;"></p>\n</section>\n    </main>'''
modal_block = '''  <p id="reviewActionStatus" role="status" style="padding:0 20px 20px;"></p>\n</section>\n\n<div id="sourceViewerModal" hidden role="dialog" aria-modal="true" aria-labelledby="sourceViewerTitle" style="position:fixed; inset:0; z-index:1000; background:rgba(15,23,42,.72); padding:24px;">\n  <div style="background:white; width:min(1100px, 100%); height:min(90vh, 900px); margin:0 auto; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 70px rgba(15,23,42,.35);">\n    <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid #e5e7eb;">\n      <div>\n        <div id="sourceViewerTitle" style="font-size:20px; font-weight:700;">Secure Source PDF</div>\n        <div id="sourceViewerFileName" style="color:#64748b; margin-top:4px;"></div>\n      </div>\n      <button type="button" id="closeSourceViewerBtn" class="button secondary">Close</button>\n    </div>\n    <p id="sourceViewerStatus" role="status" style="padding:10px 20px; margin:0; color:#475569; border-bottom:1px solid #e5e7eb;">Creating a protected document view...</p>\n    <iframe id="sourcePdfFrame" title="Secure source PDF viewer" referrerpolicy="no-referrer" style="border:0; width:100%; flex:1; background:#f8fafc;" src="about:blank"></iframe>\n  </div>\n</div>\n    </main>'''
if 'id="sourceViewerModal"' not in text:
    if modal_anchor not in text:
        raise SystemExit("Viewer modal anchor not found")
    text = text.replace(modal_anchor, modal_block, 1)

var_old = '''let activeView = "dashboard";\nlet editing = false;\nlet currentAuthUserId = null;'''
var_new = '''let activeView = "dashboard";\nlet editing = false;\nlet sourceViewerLoading = false;\nlet sourceViewerRequest = 0;\nlet currentAuthUserId = null;'''
if var_new not in text:
    if var_old not in text:
        raise SystemExit("Viewer variable anchor not found")
    text = text.replace(var_old, var_new, 1)

render_anchor = '''function renderReview(caseRow) {'''
viewer_functions = '''function closeSourceViewer() {\n  sourceViewerRequest += 1;\n  sourceViewerLoading = false;\n  const modal = document.getElementById("sourceViewerModal");\n  const frame = document.getElementById("sourcePdfFrame");\n  const status = document.getElementById("sourceViewerStatus");\n  if (modal) modal.hidden = true;\n  if (frame) frame.src = "about:blank";\n  if (status) status.textContent = "";\n  updateControls();\n}\n\nasync function openSourceViewer() {\n  if (sourceViewerLoading || saving || uploading || loadingCases || editing || !organizationId || !currentCase?.document_id) return;\n  const request = ++sourceViewerRequest;\n  const requestedOrganization = organizationId;\n  const selectedCaseId = currentCase.id;\n  const selectedDocumentId = currentCase.document_id;\n  const modal = document.getElementById("sourceViewerModal");\n  const frame = document.getElementById("sourcePdfFrame");\n  const status = document.getElementById("sourceViewerStatus");\n  const fileName = document.getElementById("sourceViewerFileName");\n\n  sourceViewerLoading = true;\n  modal.hidden = false;\n  frame.src = "about:blank";\n  fileName.textContent = currentCase.file_name || "Source document";\n  status.textContent = "Creating a protected document view...";\n  updateControls();\n\n  try {\n    const { data, error } = await supabaseClient.functions.invoke("view-document", {\n      body: { document_id: selectedDocumentId, case_id: selectedCaseId }\n    });\n    if (request !== sourceViewerRequest || requestedOrganization !== organizationId || currentCase?.document_id !== selectedDocumentId) return;\n    if (error) {\n      let details = error.message || "Could not open the source document.";\n      try {\n        if (error.context) {\n          const body = await error.context.clone().json();\n          details = body.error || body.message || details;\n        }\n      } catch (_) { /* Keep the original function error. */ }\n      throw new Error(details);\n    }\n    if (!data?.success || !data?.signed_url) throw new Error(data?.error || "Secure document link was not returned.");\n    frame.src = data.signed_url;\n    fileName.textContent = data.file_name || currentCase.file_name || "Source document";\n    const minutes = Math.max(1, Math.round((Number(data.expires_in) || 300) / 60));\n    status.textContent = "Protected viewer loaded. The temporary access link expires in about " + minutes + " minute" + (minutes === 1 ? "" : "s") + ". Close the viewer when finished.";\n    document.getElementById("closeSourceViewerBtn").focus();\n  } catch (error) {\n    if (request === sourceViewerRequest && requestedOrganization === organizationId) {\n      frame.src = "about:blank";\n      status.textContent = "Could not open the source PDF. " + (error.message || "Please try again.");\n    }\n  } finally {\n    if (request === sourceViewerRequest) {\n      sourceViewerLoading = false;\n      updateControls();\n    }\n  }\n}\n\n'''
if 'async function openSourceViewer()' not in text:
    if render_anchor not in text:
        raise SystemExit("Viewer function anchor not found")
    text = text.replace(render_anchor, viewer_functions + render_anchor, 1)

busy_old = '''  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings || staffActionPending;'''
busy_new = '''  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings || staffActionPending || sourceViewerLoading;'''
if busy_new not in text:
    if busy_old not in text:
        raise SystemExit("Busy-state anchor not found")
    text = text.replace(busy_old, busy_new, 1)

controls_old = '''  document.getElementById("editDetailsBtn").disabled = unavailable;\n  document.getElementById("reviewConfirmed").disabled = unavailable || !!problem || currentCase?.status === "Completed";'''
controls_new = '''  document.getElementById("viewSourceBtn").disabled = unavailable || sourceViewerLoading;\n  document.getElementById("editDetailsBtn").disabled = unavailable;\n  document.getElementById("reviewConfirmed").disabled = unavailable || !!problem || currentCase?.status === "Completed";'''
if controls_new not in text:
    if controls_old not in text:
        raise SystemExit("Viewer control anchor not found")
    text = text.replace(controls_old, controls_new, 1)

clear_old = '''function clearReview() {\n  reviewRequest += 1;\n  currentCase = null;'''
clear_new = '''function clearReview() {\n  reviewRequest += 1;\n  if (!document.getElementById("sourceViewerModal").hidden) closeSourceViewer();\n  currentCase = null;'''
if clear_new not in text:
    if clear_old not in text:
        raise SystemExit("Clear-review anchor not found")
    text = text.replace(clear_old, clear_new, 1)

listeners_old = '''document.getElementById("approveBtn").addEventListener("click", function() { saveCaseStatus("Completed"); });\ndocument.getElementById("correctionBtn").addEventListener("click", function() { saveCaseStatus("Correction Required"); });\ndocument.getElementById("editDetailsBtn").addEventListener("click", editDetails);'''
listeners_new = '''document.getElementById("approveBtn").addEventListener("click", function() { saveCaseStatus("Completed"); });\ndocument.getElementById("correctionBtn").addEventListener("click", function() { saveCaseStatus("Correction Required"); });\ndocument.getElementById("viewSourceBtn").addEventListener("click", openSourceViewer);\ndocument.getElementById("closeSourceViewerBtn").addEventListener("click", closeSourceViewer);\ndocument.getElementById("sourceViewerModal").addEventListener("click", function(event) { if (event.target === this) closeSourceViewer(); });\nwindow.addEventListener("keydown", function(event) { if (event.key === "Escape" && !document.getElementById("sourceViewerModal").hidden) closeSourceViewer(); });\ndocument.getElementById("editDetailsBtn").addEventListener("click", editDetails);'''
if listeners_new not in text:
    if listeners_old not in text:
        raise SystemExit("Viewer listener anchor not found")
    text = text.replace(listeners_old, listeners_new, 1)

signed_out_old = '''  if (event === "SIGNED_OUT") {\n    recoveryFlowRequested = false;\n    setSignupPanelVisible(false);'''
signed_out_new = '''  if (event === "SIGNED_OUT") {\n    recoveryFlowRequested = false;\n    closeSourceViewer();\n    setSignupPanelVisible(false);'''
if signed_out_new not in text:
    if signed_out_old not in text:
        raise SystemExit("Signed-out viewer anchor not found")
    text = text.replace(signed_out_old, signed_out_new, 1)

index_path.write_text(text)

mock_path = Path("tests/mock-supabase.js")
mock = mock_path.read_text()
mock_old = '''  functions: { async invoke() {\n    recordFixtureQuery("invoke process-document");\n    const extracted = { patient_name: "Uploaded Sample Patient", document_date: "2026-08-31", insurance_information: "Uploaded sample insurer", missing_information: "Sample missing contact" };\n    Object.assign(fixtureCases.find(row => row.id === 9), extracted, { review_revision: 1 });\n    storeFixtureCases();\n    return { data: { success: true, extracted }, error: null };\n  } }'''
mock_new = '''  functions: { async invoke(name, options = {}) {\n    if (name === "view-document") {\n      const documentId = options?.body?.document_id;\n      const caseId = options?.body?.case_id;\n      recordFixtureQuery("invoke view-document " + documentId + " case " + caseId);\n      const row = fixtureCases.find(item => item.id === caseId && item.document_id === documentId && item.organization_id === fixtureOrg);\n      if (!row) return { data: null, error: { message: "Fixture: source access denied" } };\n      return { data: { success: true, signed_url: "https://fixture.invalid/secure-source.pdf?token=temporary", expires_in: 300, file_name: row.file_name }, error: null };\n    }\n    recordFixtureQuery("invoke process-document");\n    const extracted = { patient_name: "Uploaded Sample Patient", document_date: "2026-08-31", insurance_information: "Uploaded sample insurer", missing_information: "Sample missing contact" };\n    Object.assign(fixtureCases.find(row => row.id === 9), extracted, { review_revision: 1 });\n    storeFixtureCases();\n    return { data: { success: true, extracted }, error: null };\n  } }'''
if mock_new not in mock:
    if mock_old not in mock:
        raise SystemExit("Mock function anchor not found")
    mock = mock.replace(mock_old, mock_new, 1)
mock_path.write_text(mock)

test_path = Path("tests/cases.test.mjs")
tests = test_path.read_text()
viewer_test = '''\ntest('opens the source PDF through the secure viewer function and clears it when closed', async () => {\n  const p = await page();\n  await p.review(7);\n  await p.click('viewSourceBtn');\n  assert.equal(p.element('sourceViewerModal').hidden, false);\n  assert.match(p.element('sourcePdfFrame').src, /fixture\\.invalid\\/secure-source\\.pdf\\?token=temporary/);\n  assert.match(p.text('sourceViewerStatus'), /temporary access link expires/i);\n  assert.ok(p.queries().some(query => query === 'invoke view-document fixture-document-7 case 7'));\n  await p.click('closeSourceViewerBtn');\n  assert.equal(p.element('sourceViewerModal').hidden, true);\n  assert.equal(p.element('sourcePdfFrame').src, 'about:blank');\n});\n'''
if "opens the source PDF through the secure viewer function" not in tests:
    anchor = "\ntest('failed saves keep the previous status and re-enable the controls'"
    if anchor not in tests:
        raise SystemExit("Viewer test anchor not found")
    tests = tests.replace(anchor, viewer_test + anchor, 1)
test_path.write_text(tests)
