import streamlit as st
import cv2
import pandas as pd
import tempfile
import numpy as np
import os # Added for file existence check

# Try to import mediapipe, with fallback for deployment
try:
    import mediapipe as mp
    mp_drawing = mp.solutions.drawing_utils
    mp_pose = mp.solutions.pose
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    st.warning("⚠️ MediaPipe not available - using improved skeleton overlay")

def detect_person_center(frame):
    """Detect the center of the person in the frame using motion detection"""
    # Convert to grayscale
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(gray, (21, 21), 0)
    
    # Use adaptive threshold to find moving objects
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if contours:
        # Find the largest contour (likely the person)
        largest_contour = max(contours, key=cv2.contourArea)
        
        # Get bounding rectangle
        x, y, w, h = cv2.boundingRect(largest_contour)
        
        # Calculate center
        center_x = x + w // 2
        center_y = y + h // 2
        
        return center_x, center_y, w, h
    
    # Fallback to frame center
    h, w = frame.shape[:2]
    return w // 2, h // 2, w // 4, h // 2

def draw_improved_skeleton(frame, center_x, center_y, width, height, line_color_bgr, dot_color_bgr, line_thickness, dot_radius):
    """Draw an improved skeleton that adapts to the person's position and size"""
    
    # Calculate skeleton dimensions based on person size
    skeleton_height = int(height * 0.8)
    skeleton_width = int(width * 0.6)
    
    # Head (smaller and positioned better)
    head_radius = max(5, int(skeleton_height * 0.08))
    head_y = center_y - skeleton_height // 2 + head_radius
    cv2.circle(frame, (center_x, head_y), head_radius, dot_color_bgr, -1)
    
    # Neck
    neck_y = head_y + head_radius + 5
    cv2.line(frame, (center_x, head_y + head_radius), (center_x, neck_y), line_color_bgr, line_thickness)
    
    # Shoulders
    shoulder_y = neck_y + 10
    shoulder_width = skeleton_width // 2
    cv2.line(frame, (center_x - shoulder_width, shoulder_y), (center_x + shoulder_width, shoulder_y), line_color_bgr, line_thickness)
    
    # Arms
    arm_length = skeleton_height // 3
    # Left arm
    cv2.line(frame, (center_x - shoulder_width, shoulder_y), (center_x - shoulder_width - 10, shoulder_y + arm_length), line_color_bgr, line_thickness)
    # Right arm
    cv2.line(frame, (center_x + shoulder_width, shoulder_y), (center_x + shoulder_width + 10, shoulder_y + arm_length), line_color_bgr, line_thickness)
    
    # Torso
    torso_y = shoulder_y + 20
    cv2.line(frame, (center_x, shoulder_y), (center_x, torso_y), line_color_bgr, line_thickness)
    
    # Hips
    hip_y = torso_y + 15
    hip_width = skeleton_width // 2
    cv2.line(frame, (center_x - hip_width, hip_y), (center_x + hip_width, hip_y), line_color_bgr, line_thickness)
    
    # Legs
    leg_length = skeleton_height // 2
    # Left leg
    cv2.line(frame, (center_x - hip_width, hip_y), (center_x - hip_width - 5, hip_y + leg_length), line_color_bgr, line_thickness)
    # Right leg
    cv2.line(frame, (center_x + hip_width, hip_y), (center_x + hip_width + 5, hip_y + leg_length), line_color_bgr, line_thickness)
    
    # Add some joints as dots
    joint_radius = max(2, dot_radius // 2)
    cv2.circle(frame, (center_x - shoulder_width, shoulder_y), joint_radius, dot_color_bgr, -1)  # Left shoulder
    cv2.circle(frame, (center_x + shoulder_width, shoulder_y), joint_radius, dot_color_bgr, -1)  # Right shoulder
    cv2.circle(frame, (center_x - hip_width, hip_y), joint_radius, dot_color_bgr, -1)  # Left hip
    cv2.circle(frame, (center_x + hip_width, hip_y), joint_radius, dot_color_bgr, -1)  # Right hip

st.set_page_config(page_title="Lumi Skeleton Overlay", layout="wide")

# Build marker to verify latest deploy is running - FORCE DEPLOY
st.caption("🚀 NEW BUILD: HH:MM:SS format • IMPROVED SKELETON • Python 3.13 compatible")

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

uploaded_video = st.file_uploader("Upload a video", type=["mp4","mov","avi"], help="Maximum file size: 200MB")
uploaded_csv = st.file_uploader("Upload reference CSV", type=["csv"], help="Maximum file size: 10MB")

# Add file size validation
if uploaded_video:
    if uploaded_video.size > 200 * 1024 * 1024:  # 200MB
        st.error("❌ Video file too large! Maximum size is 200MB")
        uploaded_video = None
    else:
        st.success(f"✅ Video uploaded: {uploaded_video.name} ({uploaded_video.size / (1024*1024):.1f}MB)")

if uploaded_csv:
    if uploaded_csv.size > 10 * 1024 * 1024:  # 10MB
        st.error("❌ CSV file too large! Maximum size is 10MB")
        uploaded_csv = None
    else:
        st.success(f"✅ CSV uploaded: {uploaded_csv.name} ({uploaded_csv.size / 1024:.1f}KB)")

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
                if len(parts) == 3:  # HH:MM:SS format (preferred)
                    h, m, s2 = parts
                    return int(h) * 3600 + int(m) * 60 + int(float(s2))
                elif len(parts) == 2:  # MM:SS format (fallback)
                    m, s2 = parts
                    return int(m) * 60 + int(float(s2))
            if s.replace('.', '').isdigit():
                return int(float(s))
            st.error(f"❌ Unsupported timestamp format: {t}")
            return 0
        except Exception as e:
            st.error(f"❌ Error converting timestamp '{t}': {str(e)}")
            return 0

    # Add helpful guidance for CSV format
    st.info("💡 **CSV Format Guide:** Use HH:MM:SS format (e.g., 00:01:30 for 1 minute 30 seconds)")

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
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                st.error("❌ Failed to open video file")
                st.stop()
                
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            st.info(f"📹 Processing video: {width}x{height} @ {fps:.1f} fps")
            
            # Try different codecs in order of preference
            codecs = ['mp4v', 'XVID', 'MJPG']
            fourcc = None
            out = None # Initialize out to None
            for codec in codecs:
                try:
                    fourcc = cv2.VideoWriter_fourcc(*codec)
                    output_video = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
                    out = cv2.VideoWriter(output_video, fourcc, fps, (width, height))
                    if out.isOpened():
                        st.success(f"✅ Using codec: {codec}")
                        break
                    else:
                        out.release()
                except:
                    continue
            
            if fourcc is None or not out.isOpened():
                st.error("❌ No compatible video codec found")
                st.stop()

            margin_x = 20
            margin_y = 20
            frame_idx = 0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            # Progress bar
            progress_bar = st.progress(0)
            status_text = st.empty()

            # Initialize MediaPipe Pose if available
            if MEDIAPIPE_AVAILABLE:
                with mp_pose.Pose(
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                ) as pose:
                    while True:
                        ret, frame = cap.read()
                        if not ret:
                            break

                        # Update progress
                        progress = frame_idx / total_frames
                        progress_bar.progress(progress)
                        status_text.text(f"Processing frame {frame_idx}/{total_frames}")

                        # Convert BGR to RGB for MediaPipe
                        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        results = pose.process(rgb_frame)

                        # Draw pose landmarks
                        if results.pose_landmarks:
                            # Draw connections with custom colors
                            for connection in mp_pose.POSE_CONNECTIONS:
                                start_idx = connection[0]
                                end_idx = connection[1]
                                
                                start_point = results.pose_landmarks.landmark[start_idx]
                                end_point = results.pose_landmarks.landmark[end_idx]
                                
                                # Convert normalized coordinates to pixel coordinates
                                start_x = int(start_point.x * width)
                                start_y = int(start_point.y * height)
                                end_x = int(end_point.x * width)
                                end_y = int(end_point.y * height)
                                
                                # Draw the connection line
                                cv2.line(frame, (start_x, start_y), (end_x, end_y), line_color_bgr, line_thickness)
                            
                            # Draw landmarks as dots
                            for landmark in results.pose_landmarks.landmark:
                                x = int(landmark.x * width)
                                y = int(landmark.y * height)
                                cv2.circle(frame, (x, y), dot_radius, dot_color_bgr, -1)
                        else:
                            # Fallback: draw improved skeleton if no pose detected
                            center_x, center_y, person_w, person_h = detect_person_center(frame)
                            draw_improved_skeleton(frame, center_x, center_y, person_w, person_h, line_color_bgr, dot_color_bgr, line_thickness, dot_radius)

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
            else:
                # Fallback for when MediaPipe is not available
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    # Update progress
                    progress = frame_idx / total_frames
                    progress_bar.progress(progress)
                    status_text.text(f"Processing frame {frame_idx}/{total_frames}")

                    # Improved skeleton drawing (fallback)
                    center_x, center_y, person_w, person_h = detect_person_center(frame)
                    draw_improved_skeleton(frame, center_x, center_y, person_w, person_h, line_color_bgr, dot_color_bgr, line_thickness, dot_radius)

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
            
            # Clear progress indicators
            progress_bar.empty()
            status_text.empty()

            # Check if video was created successfully
            if os.path.exists(output_video) and os.path.getsize(output_video) > 0:
                st.success("✅ Skeleton overlay video generated!")
                
                # Read the video file for display and download
                with open(output_video, "rb") as video_file:
                    video_bytes = video_file.read()
                
                # Display video
                st.video(video_bytes)
                
                # Download button
                st.download_button(
                    label="Download Motion Overlay Video",
                    data=video_bytes,
                    file_name="skeleton_overlay.mp4",
                    mime="video/mp4"
                )
            else:
                st.error("❌ Failed to generate video. Please check your input files.")
                
        except Exception as e:
            st.error(f"❌ Error during video processing: {str(e)}")
            st.error("Please check your video file format and try again.") 