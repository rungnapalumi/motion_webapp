# motion_webapp

This repo contains Streamlit apps for motion/video demos.

## Demo app: 30-second “Video Analysis” downloader (`app.py`)

This app:
- Lets the user upload **1 video**
- On **Analysis**, shows **“processing video”** for ~30 seconds
- Then provides downloads for:
  - **Processed VDO for dots**
  - **Processed VDO for skeleton**
  - **Thai Report Rev**
  - **English Report Rev**

If the user doesn’t upload a video, it uses the bundled default video in this folder.
The reports are downloaded from the bundled PDFs in this folder.

### Run

```bash
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.port 8502
```
