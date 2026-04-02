# NotebookLM 2nd Brain

This repository now includes a GitHub Pages-compatible version of the project in the repo root. It runs entirely in the browser, uses Google's popup-based token flow, and searches across your Google Drive-readable sources without asking for your Google password inside the site.

This is the practical workaround for a current NotebookLM limitation: Google's official help describes notebooks as separate workspaces, and I could not find an official public NotebookLM API in Google's developer docs as of April 2, 2026. Because GitHub Pages cannot safely host a server-side client secret, the live site uses Google Identity Services in the browser instead of the earlier server prototype.

## Live site

```text
https://marcdshark666.github.io/NotebookLM-2nd-brain/
```

## What the GitHub Pages version does

- Uses Google OAuth in the browser through the Google Identity Services token model
- Requires only a Google Web Client ID, not a client secret
- Requests only `https://www.googleapis.com/auth/drive.readonly`, not email or profile scopes
- Does not persist access tokens across page loads, so Google authorization is required again on the next login
- Searches across Drive files using Drive metadata and full-text search
- Extracts text from:
  - Google Docs
  - Google Slides
  - Google Sheets as CSV
  - plain text, Markdown, CSV, JSON, HTML, XML, and similar text files
- Returns one combined answer plus source citations

## What it does not do yet

- It does not call a real NotebookLM API
- It does not read private NotebookLM notebook internals directly
- It does not yet extract PDFs, images, audio, or video
- It does not keep long-lived background auth on GitHub Pages

## Setup for the live GitHub Pages site

### 1. Create a Google Cloud OAuth client

1. Open Google Cloud Console.
2. Enable the Google Drive API.
3. Create OAuth credentials of type **Web application**.
4. Add this authorized JavaScript origin:

```text
https://marcdshark666.github.io
```

If your OAuth consent screen is in testing mode, add the Google account you plan to use as a test user.

### 2. Open the Pages site

Go to:

```text
https://marcdshark666.github.io/NotebookLM-2nd-brain/
```

### 3. Paste the Google Web Client ID into the page

The site stores only the client ID locally in the browser. When you click **Connect Google**, Google opens its own popup and returns a short-lived access token to the page.

## How auth works on GitHub Pages

- The site never asks for your Google password directly
- The site can be configured to avoid requesting your email/profile scope entirely
- Access tokens are not persisted across page loads in the current version
- If the token expires, you reconnect with one button click
- Because this is a static site, there is no server-side refresh token store

## Repository layout

- `index.html`, `styles.css`, `app.js`, `.nojekyll`
  - The live GitHub Pages app
- `server.js`, `package.json`, `public/`
  - The earlier local server prototype, kept for reference

## Next useful upgrades

1. Add PDF extraction in the browser or via a small backend service
2. Add allowlists so you can choose folders or file groups per question
3. Add website and YouTube ingestion
4. Add a local chunk index for faster repeated questions
5. Add shared NotebookLM link ingestion for notebooks you explicitly expose

## Official references used for the design

- NotebookLM overview and limits:
  - https://support.google.com/notebooklm/answer/16213268
- NotebookLM source types:
  - https://support.google.com/notebooklm/answer/16215270
- Google Identity Services token model:
  - https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Google Drive file search:
  - https://developers.google.com/drive/api/guides/search-files
- Google Drive export formats:
  - https://developers.google.com/workspace/drive/api/guides/ref-export-formats
