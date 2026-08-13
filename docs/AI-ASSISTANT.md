# Gemini AI assistant (text + live voice)

Multi-tenant assistant for **Kushvanth** and **Grishma** with isolated chat history, finance scope, and live voice sessions.

## What you get

| Mode | URL tab | How it works |
|---|---|---|
| **Text chat** | Assistant → Text chat | REST API + Gemini text model |
| **Live voice** | Assistant → Live voice | WebSocket Gemini Live API + microphone |

Each user (`kushvanth` / `grishma`) has:
- Their own system instructions
- Scoped finance snapshot from Supabase
- Separate text chat sessions in `ai_chat_sessions` / `ai_chat_messages`
- Separate live voice tokens (short-lived, per session)

---

## Step-by-step setup

### 1. Supabase tables

Run in **SQL Editor** (once):

1. `supabase/setup.sql` — main finance data (if not done)
2. `supabase/ai-chat.sql` — text chat history tables

Voice does **not** need extra tables (uses ephemeral tokens + WebSocket).

### 2. Google AI Studio API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Enable **Gemini API** for your project

### 3. Local environment (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY=grik-finance-couple

# Server-only — never use NEXT_PUBLIC_ for this
GEMINI_API_KEY=your_gemini_api_key

# Optional
GEMINI_MODEL=gemini-2.0-flash
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Aoede
```

### 4. Vercel (production)

Add the same variables in **Project → Settings → Environment Variables**, then redeploy.

| Variable | Where |
|---|---|
| `GEMINI_API_KEY` | Server only |
| `NEXT_PUBLIC_SUPABASE_*` | Server + client |

### 5. Run locally

```bash
npm install
npm run dev
```

Open: **http://localhost:3000/assistant**

1. Select **Kushvanth** or **Grishma**
2. **Text chat** — type questions
3. **Live voice** — click **Start voice**, allow microphone

---

## How live voice works (security)

```
Browser (Assistant page)
  → POST /api/ai/live-token { user_id }
      → Server reads Supabase finance
      → Scopes data to that user only
      → Builds system instruction for that user
      → Creates ephemeral token (expires ~30 min, 1 use)
  ← Returns short-lived token (NOT your main API key)

Browser connects directly to Gemini Live (WebSocket)
  → Uses ephemeral token + apiVersion v1alpha
  → Sends microphone audio (16 kHz PCM)
  ← Receives spoken audio (24 kHz PCM) + transcripts
```

Your main `GEMINI_API_KEY` **never** goes to the browser.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY is not configured` | Add key to `.env.local`, restart `npm run dev` |
| `No cloud row for household` | Run restore or open app once to seed Supabase |
| `Chat session / table not found` | Run `supabase/ai-chat.sql` |
| Microphone blocked | Browser settings → allow mic for localhost |
| Live voice WebSocket fails | Ensure `v1alpha` ephemeral token (already handled in code) |
| Wrong user's data | Check person tab — each mode uses `user_id` param |

---

## API routes

| Route | Purpose |
|---|---|
| `POST /api/ai/chat` | Text message |
| `POST /api/ai/live-token` | Ephemeral token for voice |
| `GET /api/ai/sessions?user_id=` | Text chat sessions |
| `GET /api/ai/history?user_id=&session_id=` | Text messages |

---

## Notes

- Live API is in **preview** — model name may change; update `GEMINI_LIVE_MODEL` if Google deprecates a model.
- Voice transcripts appear on screen; text chat history is saved to Supabase.
- Main **History** page is unchanged — assistant does not auto-write transactions.
