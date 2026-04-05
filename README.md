# 📚 StudyTrack — AI-Powered Study Companion

Upload PDFs, let Gemini AI extract topics, track your progress, take notes, and get instant summaries.

---

## 📁 Files

```
studytrack/
├── index.html   ← Page structure (HTML only)
├── styles.css   ← All styling (warm cream/parchment theme)
├── app.js       ← All logic (PDF viewer, AI, topics, notes)
└── README.md    ← This file
```

---

## 🤖 Step 1 — Activate Gemini 2.5 Flash API

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"** → Copy the key
4. Open `app.js` in any text editor (TextEdit, VS Code, etc.)
5. Find this line near the top:
   ```js
   const GEMINI_API_KEY = "YOUR_GEMINI_KEY_HERE";
   ```
6. Replace `YOUR_GEMINI_KEY_HERE` with your actual key
7. Save the file

> **Important:** Gemini API is called directly from your browser — no backend server is needed. The free tier is generous enough for personal study use.

---

## 🚀 Step 2 — Deploy to GitHub Pages (Free)

### A. Create a GitHub Repository

1. Go to **https://github.com** and sign in (or create an account)
2. Click **"New repository"** (the green button or + icon)
3. Name it `studytrack` (or anything you like)
4. Set it to **Public**, leave everything else default
5. Click **"Create repository"**

### B. Upload Your Files

**Option 1 — GitHub Web Interface (easiest):**
1. In your new repo, click **"Add file" → "Upload files"**
2. Drag and drop `index.html`, `styles.css`, `app.js`
3. Click **"Commit changes"**

**Option 2 — Git from Terminal (Mac):**
```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/studytrack.git
cd studytrack

# Copy your files here, then:
git add .
git commit -m "Initial deploy"
git push
```

### C. Enable GitHub Pages

1. In your repo, click **Settings** (top menu)
2. Scroll to **"Pages"** in the left sidebar
3. Under **Source**, select **"Deploy from a branch"**
4. Branch: **main** / Folder: **/ (root)**
5. Click **Save**
6. Wait ~2 minutes, then your site is live at:
   ```
   https://YOUR_USERNAME.github.io/studytrack/
   ```

> ✅ No backend server needed. GitHub Pages is free and handles everything.

---

## 💬 Step 3 — (Optional) Contact Form via Formspree

To make the contact form actually send emails:

1. Go to **https://formspree.io** and create a free account
2. Create a new form → copy the endpoint URL (looks like `https://formspree.io/f/xyzabcde`)
3. Open `app.js` and find:
   ```js
   const FORMSPREE_URL = "https://formspree.io/f/YOUR_FORM_ID";
   ```
4. Replace `YOUR_FORM_ID` with your actual form ID
5. Push the updated `app.js` to GitHub

---

## 🔄 Updating the Site

After making any changes to your files:
```bash
git add .
git commit -m "Update something"
git push
```
GitHub Pages auto-deploys within ~1 minute.

---

## 📂 Data Storage Architecture

| Data | Where Stored | Why |
|------|-------------|-----|
| PDF files | Browser IndexedDB | Large size, no 5MB limit |
| Topics, Notes, Metadata | Browser localStorage | Small data, fast access |
| Guest ID | localStorage | Persistent session identifier |

All data is stored **locally on your device** — no cloud, no account required for basic use.

---

## 🐛 Known Issues & Fixes

| Issue | Fix |
|-------|-----|
| Can only see first PDF page | ✅ Fixed — use Prev/Next buttons in PDF toolbar |
| Tabs not switching | ✅ Fixed — all nav uses proper click handlers |
| AI not working | Set your Gemini API key in `app.js` |
| PDF not loading after re-visit | Re-upload the PDF (IndexedDB may be cleared) |

---

## 📱 Browser Compatibility

Works in all modern browsers: Chrome, Firefox, Safari, Edge.
Requires JavaScript enabled.

---

*Built for students, by a student.*
