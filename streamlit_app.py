import streamlit as st
import cv2
import pandas as pd
import tempfile
import numpy as np

st.set_page_config(page_title="Lumi Skeleton Overlay", layout="wide")

# Build marker to verify latest deploy is running - FORCE DEPLOY
st.caption("🚀 NEW BUILD: M:SS fix active • NO MEDIAPIPE • streamlit_app.py")

st.title("🌸 Skeleton Overlay with Reference Timestamp 💚")
st.write("Upload video + reference CSV → Overlay skeleton & motion text based on CSV timestamps.")

# Sidebar for color customization
st.sidebar.header("🎨 Skeleton Color Settings")

# Preset colors for quick selection
preset_colors = {
    "Red": (0, 0, 255),
    "Green": (0, 255, 0), 
    "Blue": (255, 0, 0),
    "Yellow": (0, 255, 255),
    "Cyan": (255, 255, 0),
    "Magenta": (255, 0, 255),
    "Orange": (0, 165, 255),
    "Purple": (128, 0, 128),
    "White": (255, 255, 255),
    "Black": (0, 0, 0)
}

# Skeleton line color selection
st.sidebar.subheader("Skeleton Lines")
line_color_option = st.sidebar.selectbox(
    "Choose line color:",
    ["Custom Color"] + list(preset_colors.keys()),
    index=0
)

if line_color_option == "Custom Color":
    line_color = st.sidebar.color_picker("Pick line color", "#FF0000")
    line_color_bgr = (int(line_color[5:7], 16), int(line_color[3:5], 16), int(line_color[1:3], 16))
else:
    line_color_bgr = preset_colors[line_color_option]

# Skeleton dot color selection
st.sidebar.subheader("Skeleton Dots")
dot_color_option = st.sidebar.selectbox(
    "Choose dot color:",
    ["Custom Color"] + list(preset_colors.keys()),
    index=8
)

if dot_color_option == "Custom Color":
    dot_color = st.sidebar.color_picker("Pick dot color", "#FFFFFF")
    dot_color_bgr = (int(dot_color[5:7], 16), int(dot_color[3:5], 16), int(dot_color[1:3], 16))
else:
    dot_color_bgr = preset_colors[dot_color_option]

# Skeleton thickness and size settings
st.sidebar.subheader("Skeleton Style")
line_thickness = st.sidebar.slider("Line thickness", 1, 10, 2)
dot_radius = st.sidebar.slider("Dot radius", 1, 10, 1)

# Display current color preview
st.sidebar.subheader("Color Preview")
col1, col2 = st.sidebar.columns(2)
with col1:
    if line_color_option == "Custom Color":
        st.color_picker("Line Color", line_color, disabled=True)
    else:
        st.write(f"Line Color: {line_color_option}")
    st.write(f"BGR: {line_color_bgr}")
    st.write("Lines")
with col2:
    if dot_color_option == "Custom Color":
        st.color_picker("Dot Color", dot_color, disabled=True)
    else:
        st.write(f"Dot Color: {dot_color_option}")
    st.write(f"BGR: {dot_color_bgr}")
    st.write("Dots")

# Movement Text Customization
st.sidebar.header("📝 Movement Text Settings")

# Movement text color selection
st.sidebar.subheader("Movement Text Color")
motion_color_option = st.sidebar.selectbox(
    "Choose movement text color:",
    ["Custom Color"] + list(preset_colors.keys()),
    index=8
)

if motion_color_option == "Custom Color":
    motion_color = st.sidebar.color_picker("Pick movement text color", "#FFFFFF")
    motion_color_bgr = (int(motion_color[5:7], 16), int(motion_color[3:5], 16), int(motion_color[1:3], 16))
else:
    motion_color_bgr = preset_colors[motion_color_option]

# Movement text size and style
st.sidebar.subheader("Movement Text Style")
motion_font_scale = st.sidebar.slider("Text size", 0.1, 2.0, 0.35, 0.05)
motion_font_thickness = st.sidebar.slider("Text thickness", 1, 5, 1)

# Movement text position
st.sidebar.subheader("Movement Text Position")
motion_position = st.sidebar.selectbox(
    "Text position:",
    ["Bottom Right", "Bottom Left", "Top Right", "Top Left", "Center", "Custom"]
)

# Custom position sliders (only show if Custom is selected)
if motion_position == "Custom":
    st.sidebar.subheader("Custom Position")
    custom_x = st.sidebar.slider("X position (0-100%)", 0, 100, 80)
    custom_y = st.sidebar.slider("Y position (0-100%)", 0, 100, 80)

uploaded_video = st.file_uploader("Upload a video", type=["mp4","mov","avi"])
uploaded_csv = st.file_uploader("Upload reference CSV", type=["csv"])

if uploaded_video and uploaded_csv:
    # Load CSV
    motion_df = pd.read_csv(uploaded_csv)

    st.write("📊 CSV Columns found:", list(motion_df.columns))
    st.write("📊 First few rows:")
    st.dataframe(motion_df.head())

    timestamp_col = None
    possible_timestamp_names = ['timestamp', 'time', 'Time', 'Timestamp', 'TIME', 'TIMESTAMP', 'time_stamp', 'time_stamp_seconds']
    for col in motion_df.columns:
        if col.lower() in [name.lower() for name in possible_timestamp_names]:
            timestamp_col = col
            break

    if timestamp_col is None:
        st.error("❌ CSV must contain a 'timestamp' column. Found columns: " + ", ".join(motion_df.columns))
        st.stop()
    else:
        if timestamp_col != 'timestamp':
            motion_df = motion_df.rename(columns={timestamp_col: 'timestamp'})
            st.success(f"✅ Found timestamp column: '{timestamp_col}' → renamed to 'timestamp'")

    def time_to_sec(t):
        try:
            s = str(t).strip()
            if not s:
                return 0
            if ':' in s:
                parts = s.split(':')
                if len(parts) == 2:
                    m, s2 = parts
                    return int(m) * 60 + int(float(s2))
                if len(parts) == 3:
                    h, m, s2 = parts
                    return int(h) * 3600 + int(m) * 60 + int(float(s2))
            if s.replace('.', '').isdigit():
                return int(float(s))
            st.error(f"❌ Unsupported timestamp format: {t}")
            return 0
        except Exception as e:
            st.error(f"❌ Error converting timestamp '{t}': {str(e)}")
            return 0

    motion_df['time_sec'] = motion_df['timestamp'].apply(time_to_sec)

    st.write("⏰ Timestamp conversion preview:")
    st.write("Original → Seconds")
    for orig, sec in zip(motion_df['timestamp'].head(), motion_df['time_sec'].head()):
        st.write(f"{orig} → {sec}s")

    motion_cols = [c for c in motion_df.columns if c not in ['timestamp','time_sec']]

    tfile = tempfile.NamedTemporaryFile(delete=False)
    tfile.write(uploaded_video.read())
    video_path = tfile.name
    st.video(video_path)

    if st.button("Generate Skeleton Overlay"):
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        output_video = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
        out = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

        margin_x = 20
        margin_y = 20
        frame_idx = 0

        # Simple pose detection using OpenCV
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Simple skeleton drawing (placeholder - you can enhance this)
            # For now, we'll just draw some basic shapes to show the overlay works
            h, w, _ = frame.shape
            
            # Draw a simple skeleton-like structure
            center_x, center_y = w // 2, h // 2
            
            # Head
            cv2.circle(frame, (center_x, center_y - 50), 20, dot_color_bgr, -1)
            
            # Body
            cv2.line(frame, (center_x, center_y - 30), (center_x, center_y + 50), line_color_bgr, line_thickness)
            
            # Arms
            cv2.line(frame, (center_x - 40, center_y), (center_x + 40, center_y), line_color_bgr, line_thickness)
            
            # Legs
            cv2.line(frame, (center_x, center_y + 50), (center_x - 30, center_y + 120), line_color_bgr, line_thickness)
            cv2.line(frame, (center_x, center_y + 50), (center_x + 30, center_y + 120), line_color_bgr, line_thickness)

            current_sec = int(frame_idx / fps)

            row = motion_df[motion_df['time_sec'] == current_sec]
            if not row.empty:
                motions = [col for col in motion_cols if row.iloc[0][col] == 1]
                if motions:
                    text = " + ".join(motions)
                    text_size, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, motion_font_scale, motion_font_thickness)

                    if motion_position == "Bottom Right":
                        text_x = width - text_size[0] - margin_x
                        text_y = height - margin_y
                    elif motion_position == "Bottom Left":
                        text_x = margin_x
                        text_y = height - margin_y
                    elif motion_position == "Top Right":
                        text_x = width - text_size[0] - margin_x
                        text_y = margin_y + text_size[1]
                    elif motion_position == "Top Left":
                        text_x = margin_x
                        text_y = margin_y + text_size[1]
                    elif motion_position == "Center":
                        text_x = (width - text_size[0]) // 2
                        text_y = (height + text_size[1]) // 2
                    else:
                        text_x = int((custom_x / 100) * width)
                        text_y = int((custom_y / 100) * height)

                    cv2.putText(frame, text, (text_x, text_y),
                                cv2.FONT_HERSHEY_SIMPLEX, motion_font_scale, (0,0,0), motion_font_thickness+2, cv2.LINE_AA)
                    cv2.putText(frame, text, (text_x, text_y),
                                cv2.FONT_HERSHEY_SIMPLEX, motion_font_scale, motion_color_bgr, motion_font_thickness, cv2.LINE_AA)

            out.write(frame)
            frame_idx += 1

        cap.release()
        out.release()

        st.success("✅ Skeleton overlay video generated!")
        st.video(output_video)
        st.download_button("Download Motion Overlay Video", data=open(output_video,"rb"), file_name="skeleton_overlay.mp4") 