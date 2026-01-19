## Video Analysis Web App (Streamlit)

This folder contains a small Streamlit web app that:

- Lets the user upload **Dots** and **Skeleton** videos (and optionally the PDFs)
- On **Analysis**, shows **"processing video"** for ~30 seconds
- Then provides downloads for:
  - Processed VDO for dots
  - Processed VDO for skeleton
  - Thai Report
  - English Report

If the user doesn't upload files, the app uses the bundled defaults already in this folder:
`Dots VDO.mp4`, `Skeleton.mp4`, `Thai Report.pdf`, `English Report.pdf`.

### Run locally

```bash
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.port 8502
```


