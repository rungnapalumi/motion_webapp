import streamlit as st
import cv2
import pandas as pd
import mediapipe as mp
import tempfile

st.set_page_config(page_title="Lumi Skeleton Overlay", layout="wide")

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
    # Convert hex to BGR (BGR order: Blue, Green, Red)
    line_color_bgr = (int(line_color[5:7], 16), int(line_color[3:5], 16), int(line_color[1:3], 16))
else:
    line_color_bgr = preset_colors[line_color_option]

# Skeleton dot color selection
st.sidebar.subheader("Skeleton Dots")
dot_color_option = st.sidebar.selectbox(
    "Choose dot color:",
    ["Custom Color"] + list(preset_colors.keys()),
    index=8  # Default to White
)

if dot_color_option == "Custom Color":
    dot_color = st.sidebar.color_picker("Pick dot color", "#FFFFFF")
    # Convert hex to BGR (BGR order: Blue, Green, Red)
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
    index=8  # Default to White
)

if motion_color_option == "Custom Color":
    motion_color = st.sidebar.color_picker("Pick movement text color", "#FFFFFF")
    # Convert hex to BGR (BGR order: Blue, Green, Red)
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

# Mediapipe setup
mp_drawing = mp.solutions.drawing_utils
mp_pose = mp.solutions.pose

uploaded_video = st.file_uploader("Upload a video", type=["mp4","mov","avi"])
uploaded_csv = st.file_uploader("Upload reference CSV", type=["csv"])

if uploaded_video and uploaded_csv:
    # Load CSV
    motion_df = pd.read_csv(uploaded_csv)
    
    # Display CSV info for debugging
    st.write("📊 CSV Columns found:", list(motion_df.columns))
    st.write("📊 First few rows:")
    st.dataframe(motion_df.head())

    # Check for timestamp column with various possible names
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
        # Rename the found timestamp column to 'timestamp' for consistency
        if timestamp_col != 'timestamp':
            motion_df = motion_df.rename(columns={timestamp_col: 'timestamp'})
            st.success(f"✅ Found timestamp column: '{timestamp_col}' → renamed to 'timestamp'")

    # Convert timestamp to seconds with better error handling - Updated for M:SS support
    def time_to_sec(t):
        try:
            # Handle M:SS or MM:SS format (your format) and HH:MM:SS format
            if ':' in str(t):
                parts = str(t).split(':')
                if len(parts) == 2:
                    m, s = parts
                    return int(m)*60 + int(s)
                elif len(parts) == 3:
                    h, m, s = parts
                    return int(h)*3600 + int(m)*60 + int(s)
            # Handle seconds format
            elif str(t).replace('.', '').isdigit():
                return int(float(t))
            else:
                st.error(f"❌ Unsupported timestamp format: {t}")
                return 0
        except Exception as e:
            st.error(f"❌ Error converting timestamp '{t}': {str(e)}")
            return 0
    
    motion_df['time_sec'] = motion_df['timestamp'].apply(time_to_sec)
    
    # Show timestamp conversion info
    st.write("⏰ Timestamp conversion preview:")
    st.write("Original → Seconds")
    for i, (orig, sec) in enumerate(zip(motion_df['timestamp'].head(), motion_df['time_sec'].head())):
        st.write(f"{orig} → {sec}s")

    # Determine motion columns (all except timestamp + time_sec)
    motion_cols = [c for c in motion_df.columns if c not in ['timestamp','time_sec']]

    # Prepare video
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

        with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(frame_rgb)

                if results.pose_landmarks:
                    # Draw skeleton with custom colors using manual drawing
                    landmarks = results.pose_landmarks.landmark
                    h, w, _ = frame.shape
                    
                    # Draw connections (lines)
                    for connection in mp_pose.POSE_CONNECTIONS:
                        start_idx = connection[0]
                        end_idx = connection[1]
                        
                        start_point = (int(landmarks[start_idx].x * w), int(landmarks[start_idx].y * h))
                        end_point = (int(landmarks[end_idx].x * w), int(landmarks[end_idx].y * h))
                        
                        cv2.line(frame, start_point, end_point, line_color_bgr, line_thickness)
                    
                    # Draw landmarks (dots)
                    for landmark in landmarks:
                        x = int(landmark.x * w)
                        y = int(landmark.y * h)
                        cv2.circle(frame, (x, y), dot_radius, dot_color_bgr, -1)

                # Current second
                current_sec = int(frame_idx / fps)
                timestamp_text = f"{int(current_sec//60)}:{int(current_sec%60):02d}"

                # Lookup motion from reference CSV
                row = motion_df[motion_df['time_sec'] == current_sec]
                if not row.empty:
                    motions = [col for col in motion_cols if row.iloc[0][col] == 1]
                    if motions:
                        text = " + ".join(motions)

                        # Calculate position based on selection
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
                        elif motion_position == "Custom":
                            text_x = int((custom_x / 100) * width)
                            text_y = int((custom_y / 100) * height)

                        # Draw text with outline for better visibility
                        cv2.putText(frame, text, (text_x, text_y),
                                    cv2.FONT_HERSHEY_SIMPLEX, motion_font_scale, (0,0,0), motion_font_thickness+2, cv2.LINE_AA)
                        # Main text color
                        cv2.putText(frame, text, (text_x, text_y),
                                    cv2.FONT_HERSHEY_SIMPLEX, motion_font_scale, motion_color_bgr, motion_font_thickness, cv2.LINE_AA)

                out.write(frame)
                frame_idx += 1

        cap.release()
        out.release()

        st.success("✅ Skeleton overlay video generated!")
        st.video(output_video)
        st.download_button("Download Motion Overlay Video", data=open(output_video,"rb"), file_name="skeleton_overlay.mp4")
