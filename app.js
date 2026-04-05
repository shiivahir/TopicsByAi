/* ═══════════════════════════════════════════════════════════════
   STUDYTRACK · app.js
   AI-powered study companion
   ─────────────────────────────────────────────────────────────
   HOW TO ACTIVATE GEMINI AI:
   1. Go to https://aistudio.google.com/app/apikey
   2. Click "Create API Key" (free)
   3. Replace "YOUR_GEMINI_KEY_HERE" below with your key
   4. Save this file & reload the page
═══════════════════════════════════════════════════════════════ */

// ────────────────────────────────────────────────────────────
// ⚙️  CONFIGURATION  — edit these two lines
// ────────────────────────────────────────────────────────────
const GEMINI_API_KEY = "AIzaSyDWjuEJJeUgWNvKDIIatO8Zs0APIadW0dk";
const GEMINI_MODEL = "gemini-2.5-flash";          // gemini-2.5-flash

// Formspree endpoint for contact form (optional)
const FORMSPREE_URL = "https://formspree.io/f/YOUR_FORM_ID";

// ────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────
let guestId = "";
let currentUser = null;           // for future Google Auth
let uploadedFiles = {};             // { fileName: { name, size, date } }  — NO dataUrl here (in IDB)
let topicsData = {};             // { fileName: { remaining:[], covered:[], important:[] } }
let notesData = {};             // { fileName: "html string" }

let currentFile = null;           // active fileName
let currentPdfDoc = null;           // PDF.js doc
let currentPage = 1;
let totalPages = 0;
let pdfScale = 1.4;
let currentTopicTab = "remaining";
let topicFilter = "all";
let notesTimer = null;
let isRenderingPDF = false;

const MAX_FILES_GUEST = 5;

// ────────────────────────────────────────────────────────────
// PDF.js WORKER  (must be set before any getDocument call)
// ────────────────────────────────────────────────────────────
if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* ═══════════════════════════════════════════════════════════════
   INDEXEDDB — PDF STORAGE
   PDFs are stored here instead of localStorage (no size limit hit)
═══════════════════════════════════════════════════════════════ */
const IDB_NAME = "StudyTrackDB";
const IDB_STORE = "pdfs";
let _idb = null;

function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}

async function savePDFToIDB(key, dataUrl) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(dataUrl, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function getPDFFromIDB(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

async function deletePDFFromIDB(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

function idbKey(fileName) { return `${guestId}::${fileName}`; }

/* ═══════════════════════════════════════════════════════════════
   LOCAL STORAGE  — metadata, topics, notes (small data)
═══════════════════════════════════════════════════════════════ */
function storageKey() { return `studytrack_${guestId}`; }

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const d = JSON.parse(raw);
    uploadedFiles = d.uploadedFiles || {};
    notesData = d.notesData || {};
    topicsData = {};
    for (const fn in (d.topicsData || {})) {
      const td = d.topicsData[fn];
      topicsData[fn] = {
        remaining: td.remaining || [],
        covered: td.covered || [],
        important: td.important || []   // stored as array, used as array (simpler than Set for JSON)
      };
    }
  } catch (e) { console.warn("Load failed", e); }
}

function saveToStorage() {
  try {
    const d = { uploadedFiles, notesData, topicsData };
    localStorage.setItem(storageKey(), JSON.stringify(d));
  } catch (e) {
    toast("Storage nearly full. Consider removing older files.", "error");
  }
}

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  initGuestId();
  loadFromStorage();
  setupUploadZone();
  renderFileList();
  renderTopicsFilePicker();
  renderInsights();
  updateQuickStats();
});

/* ═══════════════════════════════════════════════════════════════
   GUEST ID
═══════════════════════════════════════════════════════════════ */
function initGuestId() {
  guestId = localStorage.getItem("st_guest_id");
  if (!guestId) {
    guestId = "ST-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem("st_guest_id", guestId);
  }
  document.getElementById("guestIdDisplay").textContent = guestId;
}

function showUserPanel() {
  const body = document.getElementById("userModalBody");
  body.innerHTML = `
    <div style="background:var(--parchment);border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;color:var(--text-light);margin-bottom:4px;">Your Guest ID</div>
      <div style="font-size:18px;font-weight:700;font-family:'Lora',serif;color:var(--accent-dark);letter-spacing:1px;">${guestId}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:6px;">Save this ID to restore your data on this browser.</div>
    </div>
    <div class="form-group">
      <label>Enter a different Guest ID</label>
      <input class="form-input" id="guestIdInput" value="${guestId}" placeholder="e.g. ST-ABC123"/>
    </div>
    <p style="font-size:12px;color:var(--text-light);">
      Switching IDs loads a different data set. Files are stored locally in your browser.
    </p>`;

  const actions = document.getElementById("userModalActions");
  actions.innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="closeModal('userModal')">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="applyGuestId()">Apply ID</button>`;

  openModal("userModal");
}

function applyGuestId() {
  const val = (document.getElementById("guestIdInput")?.value || "").trim();
  if (!val) { toast("Please enter a valid ID.", "warning"); return; }
  guestId = val;
  localStorage.setItem("st_guest_id", guestId);
  document.getElementById("guestIdDisplay").textContent = guestId;
  loadFromStorage();
  renderFileList();
  renderTopicsFilePicker();
  renderInsights();
  updateQuickStats();
  closeModal("userModal");
  toast("Guest ID applied! Data loaded for " + guestId, "success");
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════ */
function navTo(page) {
  // Hide all pages
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  // Deactivate all nav links
  document.querySelectorAll(".nav-link").forEach(a => a.classList.remove("active"));

  const pageEl = document.getElementById("page-" + page);
  const navEl = document.getElementById("nav-" + page);
  if (!pageEl) { console.warn("Page not found:", page); return; }

  pageEl.classList.add("active");
  if (navEl) navEl.classList.add("active");
  window.scrollTo(0, 0);

  // Side effects per page
  if (page === "insights") { renderInsights(); updateQuickStats(); }
  if (page === "topics") { renderTopicsFilePicker(); renderTopicList(); }
  if (page === "home") { updateQuickStats(); }
}

function mobileNavTo(page) {
  document.getElementById("mobileMenu").classList.remove("open");
  document.getElementById("hamburgerBtn").classList.remove("open");
  navTo(page);
}

function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  const btn = document.getElementById("hamburgerBtn");
  const isOpen = menu.classList.toggle("open");
  btn.classList.toggle("open", isOpen);
  menu.setAttribute("aria-hidden", String(!isOpen));
}

/* ═══════════════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════════════ */
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function handleOverlayClick(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

/* ═══════════════════════════════════════════════════════════════
   FILE UPLOAD
═══════════════════════════════════════════════════════════════ */
function setupUploadZone() {
  const zone = document.getElementById("uploadZone");
  if (!zone) return;

  // Click → trigger file input
  zone.addEventListener("click", () => document.getElementById("fileInput").click());
  zone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") document.getElementById("fileInput").click(); });

  // Drag & Drop
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (!files.length) { toast("Only PDF files are supported.", "error"); return; }
    processFiles(files);
  });
}

function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  event.target.value = "";   // reset so same file can be re-uploaded
  processFiles(files);
}

async function processFiles(files) {
  const max = MAX_FILES_GUEST;   // extend for Google users later
  let added = 0;

  for (const file of files) {
    if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
      toast(`"${file.name}" is not a PDF. Skipped.`, "error"); continue;
    }

    // Duplicate filename → reuse existing data
    if (uploadedFiles[file.name]) {
      toast(`"${file.name}" already exists. Opening it.`, "warning");
      currentFile = file.name;
      continue;
    }

    // Guest file limit
    if (Object.keys(uploadedFiles).length >= max) {
      toast(`Guest limit (${max} files) reached. Remove a file or sign in with Google.`, "error");
      break;
    }

    toast(`Uploading "${file.name}"…`);
    try {
      const dataUrl = await readFileAsDataURL(file);
      // Store PDF in IndexedDB
      await savePDFToIDB(idbKey(file.name), dataUrl);

      // Store metadata in memory + localStorage
      uploadedFiles[file.name] = {
        name: file.name,
        size: file.size,
        uploadDate: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      };
      if (!topicsData[file.name]) {
        topicsData[file.name] = { remaining: [], covered: [], important: [] };
      }
      added++;
      toast(`"${file.name}" uploaded!`, "success");
    } catch (err) {
      toast(`Failed to save "${file.name}": ${err.message}`, "error");
    }
  }

  saveToStorage();
  renderFileList();
  renderTopicsFilePicker();
  renderInsights();
  updateQuickStats();
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result);
    fr.onerror = () => rej(new Error("FileReader error"));
    fr.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════════════════
   FILE LIST RENDER
═══════════════════════════════════════════════════════════════ */
function renderFileList() {
  const list = document.getElementById("fileList");
  const noMsg = document.getElementById("noFilesMsg");
  const chip = document.getElementById("fileCountChip");
  const count = Object.keys(uploadedFiles).length;
  const max = MAX_FILES_GUEST;

  chip.textContent = `${count} / ${max} files`;
  chip.style.background = count >= max ? "var(--red-light)" : "var(--parchment)";
  chip.style.color = count >= max ? "var(--red)" : "var(--text-mid)";

  // Remove previous file items (keep the empty state msg)
  list.querySelectorAll(".file-item").forEach(el => el.remove());
  noMsg.style.display = count ? "none" : "block";

  Object.values(uploadedFiles).forEach(f => {
    const item = document.createElement("div");
    item.className = "file-item" + (currentFile === f.name ? " active" : "");
    item.dataset.filename = f.name;

    item.innerHTML = `
      <div class="file-thumb">📄</div>
      <div class="file-info">
        <div class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
        <div class="file-meta">${(f.size / 1024).toFixed(1)} KB · Added ${f.uploadDate}</div>
      </div>
      <div class="file-actions">
        <button class="btn btn-success btn-sm" onclick="openFile(event,'${escAttr(f.name)}')">Open</button>
        <button class="btn btn-danger  btn-sm" onclick="confirmDelete(event,'${escAttr(f.name)}')">✕</button>
      </div>`;

    list.insertBefore(item, noMsg);
  });
}

function openFile(e, fileName) {
  if (e) e.stopPropagation();
  saveNotes(true);          // auto-save current notes
  currentFile = fileName;
  navTo("viewer");
  loadPDF(fileName);
  loadNotesForFile(fileName);
  document.getElementById("pdfFileName").textContent = fileName;
  document.getElementById("notesFileLabel").textContent = fileName;
  document.getElementById("viewerSubtitle").textContent = `Reading: ${fileName}`;
  const sb = document.getElementById("summaryBox");
  if (sb) sb.style.display = "none";
  renderFileList();  // refresh active highlight
}

function confirmDelete(e, fileName) {
  if (e) e.stopPropagation();
  document.getElementById("deleteModalMsg").textContent =
    `Delete "${fileName}" and all its topics and notes? This cannot be undone.`;
  const btn = document.getElementById("confirmDeleteBtn");
  btn.onclick = () => { deleteFile(fileName); closeModal("deleteModal"); };
  openModal("deleteModal");
}

async function deleteFile(fileName) {
  await deletePDFFromIDB(idbKey(fileName)).catch(() => { });
  delete uploadedFiles[fileName];
  delete topicsData[fileName];
  delete notesData[fileName];
  if (currentFile === fileName) {
    currentFile = null;
    currentPdfDoc = null;
    document.getElementById("pdfCanvas").style.display = "none";
    document.getElementById("pdfPlaceholder").style.display = "flex";
    document.getElementById("pdfFileName").textContent = "No file selected";
    document.getElementById("pageInfo").textContent = "— / —";
    document.getElementById("prevPageBtn").disabled = true;
    document.getElementById("nextPageBtn").disabled = true;
  }
  saveToStorage();
  renderFileList();
  renderTopicsFilePicker();
  renderInsights();
  updateQuickStats();
  toast(`"${fileName}" deleted.`);
}

/* ═══════════════════════════════════════════════════════════════
   PDF VIEWER
═══════════════════════════════════════════════════════════════ */
async function loadPDF(fileName) {
  if (typeof pdfjsLib === "undefined") {
    toast("PDF.js not loaded. Check your internet connection.", "error"); return;
  }

  const canvas = document.getElementById("pdfCanvas");
  const placeholder = document.getElementById("pdfPlaceholder");
  const loadingEl = document.getElementById("pdfLoadingOverlay");

  placeholder.style.display = "none";
  canvas.style.display = "none";
  loadingEl.style.display = "flex";

  try {
    const dataUrl = await getPDFFromIDB(idbKey(fileName));
    if (!dataUrl) {
      toast("PDF data not found. Please re-upload the file.", "error");
      placeholder.style.display = "flex";
      loadingEl.style.display = "none";
      return;
    }

    currentPdfDoc = await pdfjsLib.getDocument(dataUrl).promise;
    totalPages = currentPdfDoc.numPages;
    currentPage = 1;

    loadingEl.style.display = "none";
    canvas.style.display = "block";

    await renderPDFPage();
  } catch (err) {
    loadingEl.style.display = "none";
    placeholder.style.display = "flex";
    toast("Failed to load PDF: " + err.message, "error");
    console.error("PDF load error:", err);
  }
}

async function renderPDFPage() {
  if (!currentPdfDoc || isRenderingPDF) return;
  isRenderingPDF = true;

  try {
    const page = await currentPdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: pdfScale });
    const canvas = document.getElementById("pdfCanvas");
    const ctx = canvas.getContext("2d");

    // Set canvas dimensions to match viewport
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";
    ctx.scale(ratio, ratio);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Update toolbar info
    document.getElementById("pageInfo").textContent = `${currentPage} / ${totalPages}`;
    document.getElementById("zoomDisplay").textContent = Math.round(pdfScale * 100) + "%";
    document.getElementById("prevPageBtn").disabled = (currentPage <= 1);
    document.getElementById("nextPageBtn").disabled = (currentPage >= totalPages);
  } catch (err) {
    toast("Page render error: " + err.message, "error");
    console.error("Render error:", err);
  } finally {
    isRenderingPDF = false;
  }
}

function changePage(delta) {
  const np = currentPage + delta;
  if (!currentPdfDoc || np < 1 || np > totalPages) return;
  currentPage = np;
  renderPDFPage();
}

function zoomPDF(delta) {
  pdfScale = Math.max(0.4, Math.min(3.5, pdfScale + delta));
  if (currentPdfDoc) renderPDFPage();
}

/* ═══════════════════════════════════════════════════════════════
   NOTES EDITOR
═══════════════════════════════════════════════════════════════ */
function loadNotesForFile(fileName) {
  const editor = document.getElementById("notesEditor");
  editor.innerHTML = notesData[fileName] || "";
  updateWordCount();
  document.getElementById("noteSavedAt").textContent = "Loaded";
}

function onNotesInput() {
  updateWordCount();
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => saveNotes(true), 1800);
}

function saveNotes(auto = false) {
  if (!currentFile) return;
  const content = document.getElementById("notesEditor").innerHTML;
  notesData[currentFile] = content;
  saveToStorage();
  if (!auto) toast("Notes saved!", "success");
  const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("noteSavedAt").textContent = "Saved " + ts;
}

function clearNotes() {
  if (!currentFile) return;
  if (!confirm("Clear all notes for this file?")) return;
  document.getElementById("notesEditor").innerHTML = "";
  saveNotes();
  updateWordCount();
  toast("Notes cleared.");
}

function updateWordCount() {
  const text = document.getElementById("notesEditor").innerText || "";
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById("wordCount").textContent = `${wc} word${wc !== 1 ? "s" : ""}`;
}

function execCmd(cmd, val = null) {
  document.getElementById("notesEditor").focus();
  document.execCommand(cmd, false, val);
}

function insertRule() {
  execCmd("insertHTML", "<hr style='border:none;border-top:2px solid #e2d9cc;margin:12px 0;'/>");
}

/* ═══════════════════════════════════════════════════════════════
   TOPICS TRACKER
═══════════════════════════════════════════════════════════════ */
function renderTopicsFilePicker() {
  const container = document.getElementById("topicsFilePicker");
  const files = Object.keys(uploadedFiles);
  if (!files.length) {
    container.innerHTML = '<div class="empty-state small"><p>Upload a file first</p></div>';
    return;
  }
  container.innerHTML = "";
  files.forEach(fn => {
    const btn = document.createElement("button");
    btn.textContent = "📄 " + fn;
    btn.title = fn;
    btn.className = (currentFile === fn) ? "active-file" : "";
    btn.onclick = () => {
      currentFile = fn;
      document.querySelectorAll("#topicsFilePicker button").forEach(b => b.classList.remove("active-file"));
      btn.classList.add("active-file");
      renderTopicList();
    };
    container.appendChild(btn);
  });
}

function switchTopicTab(tab) {
  currentTopicTab = tab;
  document.getElementById("tab-remaining").classList.toggle("active", tab === "remaining");
  document.getElementById("tab-covered").classList.toggle("active", tab === "covered");
  renderTopicList();
}

function setTopicFilter(filter) {
  topicFilter = filter;
  document.getElementById("filterAll").classList.toggle("active", filter === "all");
  document.getElementById("filterImportant").classList.toggle("active", filter === "important");
  renderTopicList();
}

function renderTopicList() {
  const container = document.getElementById("topicListContainer");
  if (!container) return;

  if (!currentFile || !topicsData[currentFile]) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div><p>Select a file on the left, then extract or add topics.</p></div>';
    return;
  }

  const td = topicsData[currentFile];
  const search = (document.getElementById("topicSearchInput")?.value || "").toLowerCase();
  let list = td[currentTopicTab] || [];

  // Apply search filter
  if (search) list = list.filter(t => t.toLowerCase().includes(search));

  // Apply important filter
  if (topicFilter === "important") list = list.filter(t => td.important.includes(t));

  // Update counts (always full, not filtered)
  document.getElementById("remainingCount").textContent = td.remaining.length;
  document.getElementById("coveredCount").textContent = td.covered.length;

  if (!list.length) {
    const emptyMsg = currentTopicTab === "covered"
      ? "No topics covered yet — check some off!"
      : search ? "No topics match your search."
        : topicFilter === "important" ? "No important topics in this tab."
          : "No remaining topics. Great job! 🎉";
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${currentTopicTab === "covered" ? "✅" : "📋"}</div><p>${emptyMsg}</p></div>`;
    return;
  }

  const ul = document.createElement("div");
  ul.className = "topic-list";

  list.forEach(topic => {
    const isImportant = td.important.includes(topic);
    const isCovered = currentTopicTab === "covered";
    const safe = escAttr(topic);

    const item = document.createElement("div");
    item.className = ["topic-item", isImportant ? "important" : "", isCovered ? "covered" : ""].filter(Boolean).join(" ");

    item.innerHTML = `
      <div class="topic-check ${isCovered ? "checked" : ""}"
           onclick="toggleCover('${safe}')"
           title="${isCovered ? "Mark as remaining" : "Mark as covered"}">
        ${isCovered ? "✓" : ""}
      </div>
      <span class="topic-name ${isCovered ? "covered" : ""}">${escHtml(topic)}</span>
      ${isImportant ? '<span class="chip important" style="font-size:11px;flex-shrink:0;">★</span>' : ""}
      <button class="star-btn ${isImportant ? "starred" : ""}"
              title="${isImportant ? "Remove from important" : "Mark as important"}"
              onclick="toggleImportant('${safe}')">★</button>
      <button class="del-btn" title="Delete topic" onclick="deleteTopic('${safe}')">🗑</button>`;

    ul.appendChild(item);
  });

  container.innerHTML = "";
  container.appendChild(ul);
}

function toggleCover(topic) {
  if (!currentFile) return;
  const td = topicsData[currentFile];
  if (td.remaining.includes(topic)) {
    td.remaining = td.remaining.filter(t => t !== topic);
    td.covered.push(topic);
    toast(`"${topic}" marked as covered! ✓`, "success");
  } else if (td.covered.includes(topic)) {
    td.covered = td.covered.filter(t => t !== topic);
    td.remaining.push(topic);
    toast(`"${topic}" moved back to remaining.`);
  }
  saveToStorage();
  renderTopicList();
  renderInsights();
  updateQuickStats();
}

function toggleImportant(topic) {
  if (!currentFile) return;
  const td = topicsData[currentFile];
  const idx = td.important.indexOf(topic);
  if (idx !== -1) { td.important.splice(idx, 1); toast("Removed from important."); }
  else { td.important.push(topic); toast("Marked as important! ⭐", "success"); }
  saveToStorage();
  renderTopicList();
  renderInsights();
}

function deleteTopic(topic) {
  if (!currentFile) return;
  const td = topicsData[currentFile];
  td.remaining = td.remaining.filter(t => t !== topic);
  td.covered = td.covered.filter(t => t !== topic);
  td.important = td.important.filter(t => t !== topic);
  saveToStorage();
  renderTopicList();
  renderInsights();
  updateQuickStats();
  toast(`"${topic}" deleted.`);
}

// ── Add Topic Modal
function openAddTopicModal() {
  if (!currentFile) { toast("Select a file in the Topics sidebar first.", "warning"); return; }
  const input = document.getElementById("addTopicInput");
  if (input) input.value = "";
  openModal("addTopicModal");
  setTimeout(() => input?.focus(), 120);
}

function confirmAddTopic() {
  const val = (document.getElementById("addTopicInput")?.value || "").trim();
  if (!val) { toast("Topic name cannot be empty.", "warning"); return; }
  if (!currentFile) { toast("Select a file first.", "warning"); return; }
  const td = topicsData[currentFile];
  if (td.remaining.includes(val) || td.covered.includes(val)) {
    toast("This topic already exists.", "warning"); return;
  }
  td.remaining.push(val);
  saveToStorage();
  renderTopicList();
  renderInsights();
  updateQuickStats();
  closeModal("addTopicModal");
  toast(`"${val}" added!`, "success");
}

/* ═══════════════════════════════════════════════════════════════
   AI FEATURES — GEMINI 2.5 FLASH
═══════════════════════════════════════════════════════════════ */
function checkApiKey() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_KEY_HERE") {
    toast("Please add your Gemini API key in app.js (see CONFIGURATION section at the top).", "error");
    return false;
  }
  return true;
}

async function callGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Gemini API error");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ── Extract Topics from PDF
async function extractTopics() {
  if (!currentFile) { toast("Select a file in the Topics sidebar first.", "warning"); return; }
  if (!checkApiKey()) return;

  const btn = document.getElementById("aiTopicsBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Extracting…';

  try {
    const dataUrl = await getPDFFromIDB(idbKey(currentFile));
    if (!dataUrl) { toast("PDF not found in storage. Please re-upload.", "error"); return; }

    const b64 = dataUrl.split(",")[1];
    const prompt = `Analyse this PDF document carefully.
Extract ALL major topics, chapters, concepts, and subtopics as a flat list.
Return ONLY a JSON array of strings — no markdown, no code fences, no extra text.
Each string should be a clear, concise topic name (e.g. "Chapter 3: Newton's Laws", "Integration by Substitution", "Cell Division: Mitosis").
Aim for 10–40 items depending on document size.
Example output: ["Topic A","Topic B","Topic C"]`;

    const text = await callGemini([
      { inline_data: { mime_type: "application/pdf", data: b64 } },
      { text: prompt }
    ]);

    // Parse the JSON array
    const clean = text.replace(/```json|```/g, "").trim();
    let topics;
    try {
      // Find JSON array in response
      const match = clean.match(/\[[\s\S]*\]/);
      topics = JSON.parse(match ? match[0] : clean);
    } catch {
      throw new Error("Could not parse topic list from AI response.");
    }

    if (!Array.isArray(topics) || !topics.length) throw new Error("No topics returned.");

    // Merge with existing (don't overwrite already covered/important ones)
    const td = topicsData[currentFile];
    let added = 0;
    topics.forEach(t => {
      if (typeof t !== "string" || !t.trim()) return;
      const topic = t.trim();
      if (!td.remaining.includes(topic) && !td.covered.includes(topic)) {
        td.remaining.push(topic);
        added++;
      }
    });

    saveToStorage();
    renderTopicList();
    renderInsights();
    updateQuickStats();
    toast(`AI extracted ${topics.length} topics (${added} new)!`, "success");
  } catch (err) {
    toast("AI extraction failed: " + err.message, "error");
    console.error("AI extract error:", err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "🤖 AI Extract Topics";
  }
}

// ── Generate AI Summary
async function generateSummary() {
  if (!currentFile) { toast("Open a file first.", "warning"); return; }
  if (!checkApiKey()) return;

  const summaryBox = document.getElementById("summaryBox");
  const summaryContent = document.getElementById("summaryContent");

  summaryBox.style.display = "block";
  summaryContent.innerHTML = '<div class="ai-thinking"><div class="spinner"></div> Generating summary — this may take a moment…</div>';
  summaryBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const btn = document.getElementById("aiSummaryBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';

  try {
    const dataUrl = await getPDFFromIDB(idbKey(currentFile));
    if (!dataUrl) { toast("PDF not found. Please re-upload.", "error"); summaryBox.style.display = "none"; return; }

    const b64 = dataUrl.split(",")[1];
    const prompt = `You are an expert study assistant. Analyse this PDF document and write a structured study summary.

Use this exact structure:

**📌 Subject Overview**
1–2 sentences describing what this document is about.

**📚 Key Topics**
A concise bullet list of the major themes/chapters covered.

**💡 Core Concepts**
The most important ideas, definitions, formulas, or facts a student needs to remember.

**📝 Study Tips**
2–3 specific, actionable tips tailored to this material.

Keep the summary clear, informative, and student-friendly.`;

    const text = await callGemini([
      { inline_data: { mime_type: "application/pdf", data: b64 } },
      { text: prompt }
    ]);

    // Convert Markdown-ish to HTML
    const html = text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^#{1,3} (.+)$/gm, "<h4 style='margin:14px 0 6px;color:var(--text);'>$1</h4>")
      .replace(/^- (.+)$/gm, "• $1<br/>")
      .replace(/^\d+\. (.+)$/gm, (_, p) => `&nbsp;&nbsp;${p}<br/>`)
      .replace(/\n\n/g, "<br/><br/>")
      .replace(/\n/g, "<br/>");

    summaryContent.innerHTML = html;
    toast("Summary ready!", "success");
  } catch (err) {
    summaryContent.innerHTML = `<span style="color:var(--red);">Summary failed: ${escHtml(err.message)}</span>`;
    toast("Summary failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "✨ AI Summary";
  }
}

/* ═══════════════════════════════════════════════════════════════
   INSIGHTS
═══════════════════════════════════════════════════════════════ */
function getAggregateStats() {
  const files = Object.keys(uploadedFiles);
  let totalTopics = 0, totalCovered = 0, totalImportant = 0;
  files.forEach(fn => {
    const td = topicsData[fn] || { remaining: [], covered: [], important: [] };
    totalTopics += td.remaining.length + td.covered.length;
    totalCovered += td.covered.length;
    totalImportant += td.important.length;
  });
  const pct = totalTopics ? Math.round(totalCovered / totalTopics * 100) : 0;
  return { files, totalTopics, totalCovered, totalImportant, pct };
}

function updateQuickStats() {
  const { files, totalTopics, totalCovered, pct } = getAggregateStats();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("qs-files", files.length);
  set("qs-topics", totalTopics);
  set("qs-covered", totalCovered);
  set("qs-pct", pct + "%");
}

function renderInsights() {
  const { files, totalTopics, totalCovered, totalImportant, pct } = getAggregateStats();

  // KPI cards
  const grid = document.getElementById("insightsGrid");
  if (grid) {
    grid.innerHTML = [
      { val: files.length, label: "Files Uploaded", barPct: Math.min(files.length / MAX_FILES_GUEST * 100, 100), barClass: "blue" },
      { val: totalTopics, label: "Total Topics", barPct: null },
      { val: totalCovered, label: "Topics Covered", barPct: pct, barClass: "green" },
      { val: totalTopics - totalCovered, label: "Still Remaining", barPct: null },
      { val: totalImportant, label: "Important", barPct: null },
      { val: pct + "%", label: "Overall Progress", barPct: pct, barClass: "" }
    ].map(c => `
      <div class="insight-card">
        <div class="insight-value">${c.val}</div>
        <div class="insight-label">${c.label}</div>
        ${c.barPct !== null ? `
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-fill ${c.barClass || ""}" style="width:${c.barPct}%;"></div>
            </div>
          </div>` : ""}
      </div>`).join("");
  }

  // Per-file progress bars
  const pfb = document.getElementById("fileProgressBars");
  if (pfb) {
    if (!files.length) {
      pfb.innerHTML = '<div class="empty-state small"><p>No files yet.</p></div>';
    } else {
      pfb.innerHTML = files.map(fn => {
        const td = topicsData[fn] || { remaining: [], covered: [] };
        const tot = td.remaining.length + td.covered.length;
        const cov = td.covered.length;
        const p = tot ? Math.round(cov / tot * 100) : 0;
        return `<div class="file-progress-row">
          <div class="file-progress-meta">
            <span class="file-progress-name" title="${escHtml(fn)}">${escHtml(fn)}</span>
            <span class="file-progress-stat">${cov}/${tot} · ${p}%</span>
          </div>
          <div class="progress-bar" style="height:8px;">
            <div class="progress-fill green" style="width:${p}%;"></div>
          </div>
        </div>`;
      }).join("");
    }
  }

  // Bar chart
  const bc = document.getElementById("topicsBarChart");
  if (bc) {
    if (!files.length) {
      bc.innerHTML = '<p style="color:var(--text-light);font-size:13px;padding:10px 0;">No data yet.</p>';
    } else {
      const maxT = Math.max(1, ...files.map(fn => {
        const td = topicsData[fn] || { remaining: [], covered: [] };
        return td.remaining.length + td.covered.length;
      }));
      bc.innerHTML = files.map(fn => {
        const td = topicsData[fn] || { remaining: [], covered: [] };
        const tot = td.remaining.length + td.covered.length;
        const hPct = Math.max(6, Math.round(tot / maxT * 110));
        const lbl = fn.length > 13 ? fn.slice(0, 11) + "…" : fn;
        return `<div class="bar-item" title="${escHtml(fn)}: ${tot} topics">
          <div class="bar-col" style="height:${hPct}px;"></div>
          <span class="bar-label">${escHtml(lbl)}</span>
        </div>`;
      }).join("");
    }
  }

  // Important topics cloud
  const itl = document.getElementById("importantTopicsList");
  if (itl) {
    let html = "";
    files.forEach(fn => {
      (topicsData[fn]?.important || []).forEach(t => {
        html += `<span class="chip important" title="${escHtml(fn)}">★ ${escHtml(t)}</span>`;
      });
    });
    itl.innerHTML = html || '<p style="color:var(--text-light);font-size:13px;">No important topics marked yet.</p>';
  }

  updateQuickStats();
}

/* ═══════════════════════════════════════════════════════════════
   CONTACT FORM
═══════════════════════════════════════════════════════════════ */
async function submitContact() {
  const name = document.getElementById("contactName")?.value.trim();
  const email = document.getElementById("contactEmail")?.value.trim();
  const msg = document.getElementById("contactMsg")?.value.trim();

  if (!name || !email || !msg) { toast("Please fill in all fields.", "warning"); return; }
  if (!email.includes("@")) { toast("Please enter a valid email.", "warning"); return; }

  const btn = document.querySelector(".contact-submit-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

  try {
    if (FORMSPREE_URL.includes("YOUR_FORM_ID")) {
      // Demo mode
      await new Promise(r => setTimeout(r, 800));
      toast("Message sent! (Demo — replace FORMSPREE_URL in app.js to go live)", "success");
    } else {
      const resp = await fetch(FORMSPREE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ name, email, message: msg })
      });
      if (!resp.ok) throw new Error("Form submission failed.");
      toast("Message sent! I'll get back to you soon.", "success");
    }
    ["contactName", "contactEmail", "contactMsg"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
  } catch (err) {
    toast("Failed to send: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send Message →"; }
  }
}

/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
═══════════════════════════════════════════════════════════════ */
function toast(msg, type = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${escHtml(msg)}</span>`;
  container.appendChild(el);
  // Auto-remove
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateX(110%)";
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY HELPERS
═══════════════════════════════════════════════════════════════ */
// Escape HTML special chars to prevent XSS in innerHTML
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Escape for use inside HTML attribute single-quotes
function escAttr(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
