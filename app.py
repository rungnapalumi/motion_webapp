import time
from pathlib import Path
import shutil

import streamlit as st


APP_DIR = Path(__file__).resolve().parent

# Default/bundled assets (used if user doesn't upload replacements)
DEFAULT_DOTS_VIDEO = APP_DIR / "Dots VDO.mp4"
DEFAULT_SKELETON_VIDEO = APP_DIR / "Skeleton De.mp4"
DEFAULT_THAI_REPORT = APP_DIR / "Thai Report.pdf"
DEFAULT_EN_REPORT = APP_DIR / "English Report.pdf"

UPLOADS_DIR = APP_DIR / "uploads"
OUTPUTS_DIR = APP_DIR / "outputs"

STATE_STATUS = "status"  # idle | processing | done | error
STATE_RESULTS = "results"  # dict of output paths
STATE_PAYLOADS = "payloads"  # dict of download bytes

def _ensure_dirs() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

def _require_exists(path: Path, label: str) -> None:
    if path.exists():
        return
    raise FileNotFoundError(
        f"Missing {label}: {path.name}. Please upload it, or place it in the app folder."
    )


def _write_uploaded_file(upload, target_path: Path) -> Path:
    # `upload` is a Streamlit UploadedFile
    data = upload.getbuffer()
    target_path.write_bytes(data)
    return target_path


def _pick_input(upload, default_path: Path, save_as: str) -> Path:
    if upload is None:
        return default_path
    _ensure_dirs()
    return _write_uploaded_file(upload, UPLOADS_DIR / save_as)


def _placeholder_process_video(input_path: Path, output_path: Path) -> Path:
    """
    Placeholder 'processing': copies the input video to an output file.
    Replace this function later with real processing.
    """
    _ensure_dirs()
    shutil.copyfile(input_path, output_path)
    return output_path


def _read_bytes(path: Path) -> bytes:
    return path.read_bytes()


st.set_page_config(page_title="Video Analysis", page_icon="🎬", layout="centered")

if STATE_STATUS not in st.session_state:
    st.session_state[STATE_STATUS] = "idle"
if STATE_RESULTS not in st.session_state:
    st.session_state[STATE_RESULTS] = {}
if STATE_PAYLOADS not in st.session_state:
    st.session_state[STATE_PAYLOADS] = {}

st.title("Video Analysis")
st.write("Upload your video, then click **Analysis**.")

# Make the file uploader look like a simple "Browse files" button (hide drag/drop text)
st.markdown(
    """
<style>
div[data-testid="stFileUploaderDropzone"] {
  border: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
div[data-testid="stFileUploaderDropzone"] > div {
  padding: 0 !important;
  gap: 0.5rem !important;
  align-items: center !important;
}
/* Hide the "Drag and drop file here" + "Limit ..." text block */
div[data-testid="stFileUploaderDropzone"] > div > div {
  display: none !important;
}
</style>
""",
    unsafe_allow_html=True,
)

video_upload = None
if st.session_state[STATE_STATUS] == "idle":
    video_upload = st.file_uploader(
        "Video (MP4)",
        type=["mp4", "mov", "m4v"],
        accept_multiple_files=False,
        key="input_video",
        label_visibility="visible",
    )

    st.divider()

btn_row = st.columns(2)
with btn_row[0]:
    analysis_clicked = st.button(
        "Analysis",
        type="primary",
        use_container_width=True,
        disabled=(st.session_state[STATE_STATUS] == "processing"),
    )
with btn_row[1]:
    reset_clicked = st.button(
        "Reset",
        use_container_width=True,
        disabled=(st.session_state[STATE_STATUS] == "processing"),
    )

if reset_clicked:
    st.session_state[STATE_STATUS] = "idle"
    st.session_state[STATE_RESULTS] = {}
    st.session_state[STATE_PAYLOADS] = {}
    # Clear uploaded file widget state (forces a clean UI)
    st.session_state.pop("input_video", None)

if analysis_clicked:
    st.session_state[STATE_STATUS] = "processing"
    st.session_state[STATE_RESULTS] = {}
    st.session_state[STATE_PAYLOADS] = {}

    try:
        # Require a user upload to start analysis (per UX requirement).
        if video_upload is None:
            raise ValueError("Please upload a video before clicking Analysis.")

        # Save the uploaded file (not used for outputs; outputs come from bundled repo files).
        _pick_input(video_upload, DEFAULT_DOTS_VIDEO, "input.mp4")

        # Reports are bundled defaults (user doesn't need to upload)
        thai_rep = DEFAULT_THAI_REPORT
        en_rep = DEFAULT_EN_REPORT

        # Output sources are the bundled files in this repo
        dots_source = DEFAULT_DOTS_VIDEO
        skeleton_source = DEFAULT_SKELETON_VIDEO

        _require_exists(dots_source, "Dots video")
        _require_exists(skeleton_source, "Skeleton video")
        _require_exists(thai_rep, "Thai report")
        _require_exists(en_rep, "English report")

        st.write("processing video")
        with st.spinner("processing video"):
            time.sleep(30)

        # Read once into memory for stable downloads across reruns (prevents media cache KeyError on Render)
        st.session_state[STATE_PAYLOADS] = {
            # IMPORTANT: Always serve the repo files for dots/skeleton (never the uploaded file)
            "dots_video": _read_bytes(dots_source),
            "skeleton_video": _read_bytes(skeleton_source),
            "thai_report": _read_bytes(thai_rep),
            "english_report": _read_bytes(en_rep),
        }

        st.session_state[STATE_RESULTS] = {
            "dots_source": str(dots_source),
            "skeleton_source": str(skeleton_source),
            "thai_report": str(thai_rep),
            "english_report": str(en_rep),
        }
        st.session_state[STATE_STATUS] = "done"
    except Exception as e:
        st.session_state[STATE_STATUS] = "error"
        st.session_state[STATE_RESULTS] = {"error": str(e)}

if st.session_state[STATE_STATUS] == "idle":
    # Intentionally no "Tip:" message here (per requirement).
    pass

if st.session_state[STATE_STATUS] == "error":
    st.error(st.session_state[STATE_RESULTS].get("error", "Unknown error"))

if st.session_state[STATE_STATUS] == "done":
    payloads = st.session_state.get(STATE_PAYLOADS, {})

    st.success("Done. Download your files below.")

    st.subheader("Downloads")
    d1, d2 = st.columns(2)
    with d1:
        st.download_button(
            "Download: Processed VDO for dots",
            data=payloads.get("dots_video", b""),
            file_name="Dots VDO.mp4",
            mime="video/mp4",
            use_container_width=True,
            key="dl_dots_video",
        )
        st.download_button(
            "Download: Thai Report",
            data=payloads.get("thai_report", b""),
            file_name="Thai Report.pdf",
            mime="application/pdf",
            use_container_width=True,
            key="dl_thai_report",
        )
    with d2:
        st.download_button(
            "Download: Processed VDO for skeleton",
            data=payloads.get("skeleton_video", b""),
            file_name="Skeleton.mp4",
            mime="video/mp4",
            use_container_width=True,
            key="dl_skeleton_video",
        )
        st.download_button(
            "Download: English Report",
            data=payloads.get("english_report", b""),
            file_name="English Report.pdf",
            mime="application/pdf",
            use_container_width=True,
            key="dl_en_report",
        )


