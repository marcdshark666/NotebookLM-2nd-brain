# NotebookBridge

NotebookBridge is a small web app that sits between your Google account and an answer engine. You sign in with Google OAuth, the app searches across your Drive-accessible sources, pulls text from supported file types, and returns one combined answer with citations.

This is the practical workaround for a current NotebookLM limitation: Google's official NotebookLM help says each notebook is independent and cannot access information across multiple notebooks at the same time. As of April 2, 2026, I also could not find an official public NotebookLM API in Google's developer documentation, so this prototype uses Google OAuth plus the Drive API instead of trying to automate NotebookLM itself.

## What the prototype does

- Authenticates with Google using OAuth 2.0, so you never type your Google password into this app.
- Optionally keeps refresh tokens in an encrypted local token store so you do not need to authenticate every time.
- Searches across Drive files using Google Drive full-text and metadata search.
- Extracts text from supported source types:
  - Google Docs
  - Google Slides
  - Google Sheets as CSV
  - plain text, Markdown, CSV, JSON, HTML, XML, and similar text-based files
- Returns one answer plus citations and the matched files it used.
- Uses a simple extractive answerer by default and can optionally call an external LLM if you configure one.

## What it does not do yet

- It does not call a real NotebookLM API, because no official one was found.
- It does not read NotebookLM notebook lists, private notebook chats, or notebook-only metadata directly.
- It does not yet extract text from PDFs, images, audio, or video inside this prototype.
- It does not yet index every file into a local vector database. It currently does live retrieval per question.

## Setup

### 1. Create a Google Cloud project

1. Open the Google Cloud console.
2. Enable the Google Drive API for the project.
3. Create OAuth credentials of type **Web application**.
4. Add this redirect URI:

```text
http://localhost:3180/auth/google/callback
```

If you change `APP_BASE_URL` or `PORT`, update the redirect URI to match exactly.

### 2. Configure the app

Copy `.env.example` to `.env` and fill in:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `COOKIE_SIGNING_SECRET`
- `TOKEN_STORE_SECRET`

Optional:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`

If you leave the optional LLM settings blank, the app still works, but the answerer stays extractive instead of generative.

### 3. Start the app

```bash
npm start
```

Then open:

```text
http://localhost:3180
```

## How authentication works

- You click **Connect Google**.
- Google shows the consent screen.
- Google redirects back to this app with an authorization code.
- The server exchanges that code for tokens.
- The refresh token can be stored locally in an encrypted file if `TOKEN_STORE_SECRET` is configured.
- The browser only keeps a signed identity cookie and a session cookie, not your password.

## Notes on source coverage

NotebookLM supports PDFs, websites, Google Docs, Slides, Sheets, text, Markdown, images, YouTube URLs, and more. This app currently focuses on the subset we can pull clean text from through Google Drive export or direct download.

If you want this to become a stronger "ask everything" system, the next steps are:

1. add PDF extraction
2. add website and YouTube ingestion
3. add a local chunk index for faster repeated questions
4. add file or folder allowlists so only selected source groups are searched
5. add public NotebookLM link ingestion for notebooks you explicitly choose to share

## Official references used for the design

- NotebookLM overview and limits:
  - https://support.google.com/notebooklm/answer/16213268
- NotebookLM source types:
  - https://support.google.com/notebooklm/answer/16215270
- Google OAuth 2.0 for web server applications:
  - https://developers.google.com/identity/protocols/oauth2/web-server
- Google Drive file search:
  - https://developers.google.com/drive/api/guides/search-files
- Google Drive export formats:
  - https://developers.google.com/workspace/drive/api/guides/ref-export-formats
