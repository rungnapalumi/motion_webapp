# motion_webapp

Full copy of the Vercel Presenter Analysis app (`ai-people-reader-v2.vercel.app`).

Same UI and same flow: name + email + video → FastAPI jobs → skeleton video + English PDF, and results emailed.

API: `https://make-a-wish-74lv.onrender.com` (same as Vercel).

## Local

```bash
npm install
npm run build
python3 serve.py
```

Dev mode:

```bash
npm install
npm run dev
```

## Render

Start command: `python serve.py`  
Commit the `dist/` folder after `npm run build` so the Python service does not need Node.
