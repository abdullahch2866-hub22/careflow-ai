from pathlib import Path
import re

path = Path("index.html")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


def regex_once(pattern: str, replacement: str, label: str):
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, found {count}")


replace_once(
    '    .status[data-status="Correction Required"] { background: #fef3c7; color: #92400e; }\n',
    '    .status[data-status="Correction Required"] { background: #fef3c7; color: #92400e; }\n'
    '    .status[data-status="Processing"] { background: #e0f2fe; color: #075985; }\n'
    '    .status[data-status="Waiting to process"] { background: #f1f5f9; color: #475569; }\n'
    '    .status[data-status="Processing failed"] { background: #fee2e2; color: #991b1b; }\n'
    '    .status[data-status="Ready"] { background: #dcfce7; color: #166534; }\n',
    "processing status CSS",
)

replace_once(
'''    <div class="recent-header">
        Patient Document Review
        <div id="reviewFileName" class="case-type" style="margin-top:8px;"></div>
    </div>

   <div class="case">''',
'''    <div class="recent-header">
        Patient Document Review
        <div id="reviewFileName" class="case-type" style="margin-top:8px;"></div>
    </div>

    <div class="case">
      <div>
        <div class="case-name">AI Processing</div>
        <div id="reviewProcessingText" class="case-type">—</div>
      </div>
      <div id="reviewProcessingBadge" class="status" data-status="Waiting to process">Waiting to process</div>
    </div>

   <div class="case">''',
    "review processing block",
)

replace_once(
'''    <div style="padding:20px; display:flex; gap:12px; flex-wrap:wrap;">
      <button type="button" id="viewSourceBtn" class="button secondary" disabled>View Source PDF</button>
      <button type="button" id="editDetailsBtn" class="button" disabled>Edit Details</button>
    </div>''',
'''    <div style="padding:20px; display:flex; gap:12px; flex-wrap:wrap;">
      <button type="button" id="viewSourceBtn" class="button secondary" disabled>View Source PDF</button>
      <button type="button" id="retryProcessingBtn" class="button secondary" hidden>Retry Processing</button>
      <button type="button" id="editDetailsBtn" class="button" disabled>Edit Details</button>
    </div>''',
    "review retry button",
)

replace_once(
'const CASE_COLUMNS = "id, document_id, organization_id, file_name, document_type, status, created_at, patient_name, document_date, insurance_information, missing_information, review_notes, review_revision, review_confirmed, updated_at, updated_by";',
'const CASE_COLUMNS = "id, document_id, organization_id, file_name, document_type, status, created_at, patient_name, document_date, insurance_information, missing_information, review_notes, review_revision, review_confirmed, updated_at, updated_by, processing_status, processing_error_code, processing_error_message, processing_attempts, processing_started_at, processing_completed_at, processing_retryable";',
    "CASE_COLUMNS",
)

replace_once(
'''let sourceViewerLoading = false;
let sourceViewerRequest = 0;
let currentAuthUserId = null;''',
'''let sourceViewerLoading = false;
let sourceViewerRequest = 0;
let processingRequestPending = false;
let currentAuthUserId = null;
const PROCESSING_STALE_MS = 10 * 60 * 1000;''',
    "processing globals",
)

regex_once(
    r'function approvalProblem\(row\) \{.*?\n\}\n\nfunction setStatusBadge',
'''function processingIsStale(row) {
  if (row?.processing_status !== "processing" || !row.processing_started_at) return false;
  const started = new Date(row.processing_started_at).getTime();
  return Number.isFinite(started) && Date.now() - started >= PROCESSING_STALE_MS;
}

function canRetryProcessing(row) {
  const attempts = Number(row?.processing_attempts ?? 0);
  if (!row?.document_id || row.processing_retryable === false || attempts >= 5) return false;
  return row.processing_status === "pending" ||
    row.processing_status === "failed" ||
    processingIsStale(row);
}

function processingLabel(row) {
  if (!row) return "Waiting to process";
  if (row.processing_status === "processing") return "Processing";
  if (row.processing_status === "failed") return "Processing failed";
  if (row.processing_status === "pending") return "Waiting to process";
  return row.status || "Review";
}

function processingDetail(row) {
  const attempt = Number(row?.processing_attempts ?? 0);
  if (row?.processing_status === "ready") return "Ready for human review" + (attempt ? " · Attempt " + attempt : "");
  if (row?.processing_status === "processing") {
    return processingIsStale(row)
      ? "Processing appears interrupted. Retry processing to continue."
      : "AI processing attempt " + Math.max(1, attempt) + " is running. You can safely leave this page.";
  }
  if (row?.processing_status === "failed") {
    return (row.processing_error_message || "AI processing failed.") + (attempt ? " · Attempt " + attempt + "/5" : "");
  }
  return "Waiting for AI processing to begin.";
}

function approvalProblem(row) {
  if (!row?.document_id) return "This case has no linked source document.";
  if (row.processing_status !== "ready") {
    if (row.processing_status === "failed") return row.processing_error_message || "AI processing failed. Retry processing before review.";
    if (row.processing_status === "processing") return processingIsStale(row) ? "AI processing appears interrupted. Retry processing." : "AI is still processing this document.";
    return "This document is waiting for AI processing. Retry processing to continue.";
  }
  if (typeof row.review_revision !== "number") return "The review update is not available yet. Refresh after deployment.";
  if ((row.missing_information || "").trim()) return "Resolve the missing information using Edit Details before approving.";
  if (!(row.patient_name || "").trim() || !(row.document_type || "").trim() || !row.document_date) return "Add the patient name, document type, and document date before approving.";
  return "";
}

function setStatusBadge''',
    "processing helpers and approval gate",
)

regex_once(
    r'function updateControls\(\) \{.*?\n\}\n\nfunction clearReview',
'''function updateControls() {
  const busy = uploading || saving || loadingCases || loadingActivity || loadingSettings || staffActionPending || sourceViewerLoading || processingRequestPending;
  document.getElementById("uploadBtn").disabled = busy || editing || !organizationId;
  document.getElementById("reloadCasesBtn").disabled = busy || editing || !organizationId;
  const reloadActivityBtn = document.getElementById("reloadActivityBtn");
  if (reloadActivityBtn) reloadActivityBtn.disabled = busy || editing || !organizationId;
  const reloadOrganizationBtn = document.getElementById("reloadOrganizationBtn");
  if (reloadOrganizationBtn) reloadOrganizationBtn.disabled = busy || editing || !organizationId;
  const reloadUsersBtn = document.getElementById("reloadUsersBtn");
  if (reloadUsersBtn) reloadUsersBtn.disabled = busy || editing || !organizationId;
  const inviteUserBtn = document.getElementById("inviteUserBtn");
  const inviteUserEmail = document.getElementById("inviteUserEmail");
  const inviteUserRole = document.getElementById("inviteUserRole");
  if (inviteUserBtn) inviteUserBtn.disabled = busy || !isOrganizationAdmin();
  if (inviteUserEmail) inviteUserEmail.disabled = busy || !isOrganizationAdmin();
  if (inviteUserRole) inviteUserRole.disabled = busy || !isOrganizationAdmin();
  WORKSPACE_NAV_IDS.forEach(function(id) {
    const button = document.getElementById(id);
    if (button) button.disabled = busy || editing || !organizationId;
  });
  document.querySelectorAll(".review-btn, .retry-processing-btn").forEach(function(button) {
    button.disabled = busy || editing;
  });

  const sourceUnavailable = busy || editing || !currentCase?.document_id;
  const unavailable = sourceUnavailable || currentCase?.processing_status !== "ready" || typeof currentCase?.review_revision !== "number";
  const problem = approvalProblem(currentCase);
  document.getElementById("approveBtn").disabled = unavailable || !!problem || currentCase?.status === "Completed" || !document.getElementById("reviewConfirmed").checked;
  document.getElementById("correctionBtn").disabled = unavailable || currentCase?.status === "Correction Required";
  document.getElementById("viewSourceBtn").disabled = sourceUnavailable || sourceViewerLoading;
  document.getElementById("editDetailsBtn").disabled = unavailable;
  document.getElementById("reviewConfirmed").disabled = unavailable || !!problem || currentCase?.status === "Completed";
  const retryButton = document.getElementById("retryProcessingBtn");
  if (retryButton) {
    retryButton.hidden = !canRetryProcessing(currentCase);
    retryButton.disabled = busy || editing || !canRetryProcessing(currentCase);
  }
  document.getElementById("approvalGuidance").textContent = currentCase ? problem || (currentCase.status === "Completed" ? "This case is completed. Editing details will reopen it for review." : "Check the saved details, then tick the confirmation box to enable approval.") : "";
  ["saveDetailsBtn", "cancelEditBtn", "correctionsConfirmed", ...Object.keys(EDIT_FIELDS)].forEach(function(id) { document.getElementById(id).disabled = busy || !editing; });
}

function clearReview''',
    "update controls",
)

regex_once(
    r'function clearReview\(\) \{.*?\n\}\n\nfunction renderCases',
'''function clearReview() {
  reviewRequest += 1;
  if (!document.getElementById("sourceViewerModal").hidden) closeSourceViewer();
  currentCase = null;
  closeEditor();
  document.getElementById("reviewConfirmed").checked = false;
  document.getElementById("reviewPanel").style.display = "none";
  document.getElementById("reviewActionStatus").textContent = "";
  ["reviewFileName", "reviewProcessingText", "reviewPatientName", "reviewDocumentType", "reviewDocumentDate", "reviewInsurance", "reviewMissingInfo", "reviewStatusText", "reviewStatusBadge", "reviewNotes"].forEach(function(id) {
    const element = document.getElementById(id);
    if (element) element.textContent = "";
  });
  const processingBadge = document.getElementById("reviewProcessingBadge");
  if (processingBadge) {
    processingBadge.textContent = "Waiting to process";
    processingBadge.dataset.status = "Waiting to process";
  }
  updateControls();
}

function renderCases''',
    "clear review",
)

regex_once(
    r'function renderCases\(\) \{.*?\n\}\n\nasync function loadCases',
'''function renderCases() {
  const container = document.getElementById("uploadedCase");
  container.replaceChildren();
  const visibleCases = casesForActiveView();
  if (visibleCases.length === 0) {
    if (activeView !== "dashboard") {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyMessageForActiveView();
      container.append(empty);
    }
    updateControls();
    return;
  }
  visibleCases.forEach(function(caseRow) {
    const row = document.createElement("div");
    row.className = "case";
    const details = document.createElement("div");
    const name = document.createElement("div");
    name.className = "case-name";
    name.textContent = caseRow.file_name || "Untitled document";
    const type = document.createElement("div");
    type.className = "case-type";
    type.textContent = (caseRow.document_type || "Healthcare document") + " · Case #" + caseRow.id;
    details.append(name, type);
    const actions = document.createElement("div");
    actions.className = "case-actions";
    const badge = document.createElement("span");
    badge.className = "status";
    if (caseRow.processing_status === "ready") {
      setStatusBadge(badge, caseRow.status);
    } else {
      const label = processingLabel(caseRow);
      badge.textContent = label;
      badge.dataset.status = label;
    }
    if (canRetryProcessing(caseRow)) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button secondary retry-processing-btn";
      retry.textContent = "Retry Processing";
      retry.setAttribute("aria-label", "Retry AI processing for case " + caseRow.id);
      retry.addEventListener("click", function() { retryCaseProcessing(caseRow.id); });
      actions.append(retry);
    }
    const review = document.createElement("button");
    review.type = "button";
    review.className = "button review-btn";
    review.textContent = "Review";
    review.setAttribute("aria-label", "Review case " + caseRow.id + ": " + (caseRow.file_name || "Untitled document"));
    review.addEventListener("click", function() { openCase(caseRow.id); });
    actions.append(badge, review);
    row.append(details, actions);
    container.append(row);
  });
  updateControls();
}

async function loadCases''',
    "render cases",
)

regex_once(
    r'function renderReview\(caseRow\) \{.*?\n\}\n\nasync function openCase',
'''function renderReview(caseRow) {
  currentCase = caseRow;
  document.getElementById("reviewConfirmed").checked = false;
  document.getElementById("reviewFileName").textContent = (caseRow.file_name || "Untitled document") + " · Case #" + caseRow.id;
  document.getElementById("reviewProcessingText").textContent = processingDetail(caseRow);
  const processingBadge = document.getElementById("reviewProcessingBadge");
  if (caseRow.processing_status === "ready") {
    processingBadge.textContent = "Ready";
    processingBadge.dataset.status = "Ready";
  } else {
    const label = processingLabel(caseRow);
    processingBadge.textContent = label;
    processingBadge.dataset.status = label;
  }
  document.getElementById("reviewPatientName").textContent = caseRow.patient_name || "Not found";
  document.getElementById("reviewDocumentType").textContent = caseRow.document_type || "Healthcare document";
  document.getElementById("reviewDocumentDate").textContent = caseRow.document_date || "Not found";
  document.getElementById("reviewInsurance").textContent = caseRow.insurance_information || "Not found";
  document.getElementById("reviewMissingInfo").textContent = caseRow.missing_information || "None recorded";
  document.getElementById("reviewNotes").textContent = caseRow.review_notes || "No corrections recorded.";
  const missingBadge = document.getElementById("missingInfoBadge");
  missingBadge.hidden = caseRow.processing_status !== "ready" || !(caseRow.missing_information || "").trim();
  document.getElementById("reviewStatusText").textContent = caseRow.status || "Review";
  setStatusBadge(document.getElementById("reviewStatusBadge"), caseRow.status);
  document.getElementById("reviewPanel").style.display = "block";
  updateControls();
}

async function openCase''',
    "render review",
)

replace_once(
'''    message.textContent = !data.document_id ? "This older case has no linked document. Review decisions are unavailable." :
      !data.patient_name && !data.document_date && !data.insurance_information && !data.missing_information ?
        "No extraction details are saved for this case. Check the source document before approving." : "";''',
'''    message.textContent = !data.document_id ? "This older case has no linked document. Review decisions are unavailable." :
      data.processing_status === "failed" ? (data.processing_error_message || "AI processing failed. Retry processing to continue.") :
      data.processing_status === "processing" ? (processingIsStale(data) ? "AI processing appears interrupted. Retry processing." : "AI processing is still running.") :
      data.processing_status === "pending" ? "This document is waiting for AI processing." : "";''',
    "open case processing message",
)

replace_once(
'  if (uploading || saving || loadingCases || loadingActivity || loadingSettings) return;',
'  if (uploading || saving || loadingCases || loadingActivity || loadingSettings || processingRequestPending) return;',
    "view switch processing guard",
)

replace_once(
'  if (sourceViewerLoading || saving || uploading || loadingCases || editing || !organizationId || !currentCase?.document_id) return;',
'  if (sourceViewerLoading || saving || uploading || loadingCases || processingRequestPending || editing || !organizationId || !currentCase?.document_id) return;',
    "source viewer processing guard",
)

replace_once(
'''document.getElementById("uploadBtn").addEventListener("click", function() {
  document.getElementById("documentInput").click();
});''',
'''async function invokeDocumentProcessing(documentId) {
  const { data, error } = await supabaseClient.functions.invoke("process-document", {
    body: { document_id: documentId }
  });
  if (error) {
    let details = error.message || "Document processing failed.";
    try {
      if (error.context) {
        const body = await error.context.clone().json();
        details = body.error || body.message || details;
      }
    } catch (_) { /* Keep the original function error. */ }
    throw new Error(details);
  }
  return data || {};
}

async function retryCaseProcessing(caseId) {
  const row = savedCases.find(function(item) { return String(item.id) === String(caseId); });
  if (!row || !canRetryProcessing(row) || processingRequestPending || !organizationId) return;
  const selectedWasOpen = currentCase && String(currentCase.id) === String(row.id);
  const requestedOrganization = organizationId;
  const message = selectedWasOpen ? document.getElementById("reviewActionStatus") : document.getElementById("caseListStatus");
  processingRequestPending = true;
  message.textContent = "Retrying AI processing for Case #" + row.id + "...";
  updateControls();
  try {
    const result = await invokeDocumentProcessing(row.document_id);
    if (requestedOrganization !== organizationId) return;
    message.textContent = result?.processing_status === "processing"
      ? "AI processing is already running. Reload in a moment."
      : "AI processing finished. Reloading the saved case...";
  } catch (error) {
    if (requestedOrganization === organizationId) {
      message.textContent = error.message || "Processing retry failed. The saved case was not lost.";
    }
  } finally {
    processingRequestPending = false;
    if (requestedOrganization === organizationId) {
      await Promise.all([loadCases(), loadDashboardMetrics()]);
      if (selectedWasOpen) await openCase(row.id);
    }
    updateControls();
  }
}

document.getElementById("uploadBtn").addEventListener("click", function() {
  document.getElementById("documentInput").click();
});''',
    "processing invoke helpers",
)

replace_once(
'  if (!file || uploading || saving || loadingCases || editing || !organizationId) return;',
'  if (!file || uploading || saving || loadingCases || processingRequestPending || editing || !organizationId) return;',
    "upload processing guard",
)

replace_once(
'''    caseSaved = true;
    if (requestedAuth !== authRequest || requestedOrganization !== organizationId) return;
    uploadStatus.textContent = "Uploaded successfully. AI is processing the document...";
    const { data: aiResult, error: aiError } = await supabaseClient.functions.invoke("process-document", {
      body: { document_id: documentRow.id }
    });
    if (aiError) {
      let details = aiError.message;
      try {
        if (aiError.context) {
          const body = await aiError.context.clone().json();
          details += " | " + (body.details || body.error || "Processing error");
        }
      } catch (_) { /* Keep the original error if the body cannot be read. */ }
      throw new Error("AI processing failed: " + details);
    }
    if (!aiResult || aiResult.success !== true) throw new Error("AI processing did not confirm success.");
    if (requestedAuth === authRequest && requestedOrganization === organizationId) {
      uploadStatus.textContent = "Uploaded and processed successfully: " + file.name + " ✓";
    }''',
'''    caseSaved = true;
    if (requestedAuth !== authRequest || requestedOrganization !== organizationId) return;
    await loadCases();
    uploadStatus.textContent = "Upload saved. AI is processing the document... You can safely leave this page.";
    try {
      const aiResult = await invokeDocumentProcessing(documentRow.id);
      if (requestedAuth === authRequest && requestedOrganization === organizationId) {
        uploadStatus.textContent = aiResult?.processing_status === "ready"
          ? "Uploaded and processed successfully: " + file.name + " ✓"
          : "Upload saved. AI processing is still running. Reload cases in a moment.";
      }
    } catch (processingError) {
      if (requestedAuth === authRequest && requestedOrganization === organizationId) {
        uploadStatus.textContent = "Upload saved. " + (processingError.message || "AI processing did not finish.") + " Use Retry Processing on the saved case.";
      }
    }''',
    "recoverable upload processing",
)

replace_once(
'function editDetails() {\n  if (saving || uploading || loadingCases || editing || !currentCase?.document_id) return;',
'function editDetails() {\n  if (saving || uploading || loadingCases || processingRequestPending || editing || !currentCase?.document_id || currentCase.processing_status !== "ready") return;',
    "edit processing gate",
)

replace_once(
'  if (!editing || saving || uploading || loadingCases || !currentCase?.document_id || !organizationId) return;',
'  if (!editing || saving || uploading || loadingCases || processingRequestPending || !currentCase?.document_id || currentCase.processing_status !== "ready" || !organizationId) return;',
    "save corrections processing gate",
)

replace_once(
'  if (editing || saving || uploading || loadingCases || !currentCase?.document_id || !organizationId || currentCase.status === newStatus) return;',
'  if (editing || saving || uploading || loadingCases || processingRequestPending || !currentCase?.document_id || currentCase.processing_status !== "ready" || !organizationId || currentCase.status === newStatus) return;',
    "save status processing gate",
)

replace_once(
'''document.getElementById("viewSourceBtn").addEventListener("click", openSourceViewer);
document.getElementById("closeSourceViewerBtn").addEventListener("click", closeSourceViewer);''',
'''document.getElementById("viewSourceBtn").addEventListener("click", openSourceViewer);
document.getElementById("retryProcessingBtn").addEventListener("click", function() { if (currentCase) retryCaseProcessing(currentCase.id); });
document.getElementById("closeSourceViewerBtn").addEventListener("click", closeSourceViewer);''',
    "retry event listener",
)

replace_once(
'''  loadingSettings = false;
  staffActionPending = false;
  resetDashboardMetrics();''',
'''  loadingSettings = false;
  staffActionPending = false;
  processingRequestPending = false;
  resetDashboardMetrics();''',
    "auth reset processing flag",
)

replace_once(
'''    loadingSettings = false;
    staffActionPending = false;
    currentAuthUserId = null;''',
'''    loadingSettings = false;
    staffActionPending = false;
    processingRequestPending = false;
    currentAuthUserId = null;''',
    "signout reset processing flag",
)

path.write_text(text, encoding="utf-8")
print("Processing reliability frontend patch applied")
