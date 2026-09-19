import streamlit as st
import cv2
import mediapipe as mp
import tempfile
import numpy as np

st.title("🦴 Skeleton Overlay App (Lumi Edition) 💚")
st.write("อัปโหลดวิดีโอ → สร้าง Skeleton Overlay (ไม่มี Motion Detection)")

uploaded_file = st.file_uploader("Upload a video", type=["mp4", "mov", "avi"])

if uploaded_file is not None:
    tfile = tempfile.NamedTemporaryFile(delete=False)
    tfile.write(uploaded_file.read())
    video_path = tfile.name

    st.video(video_path)
    process_btn = st.button("Generate Skeleton Overlay")

    if process_btn:
        st.write("⏳ กำลังสร้าง Skeleton Overlay...")

        output_video = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4').name

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

        mp_pose = mp.solutions.pose
        mp_drawing = mp.solutions.drawing_utils
        pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(frame_rgb)

            if results.pose_landmarks:
                # Draw skeleton in bright colors
                mp_drawing.draw_landmarks(
                    frame,
                    results.pose_landmarks,
                    mp_pose.POSE_CONNECTIONS,
                    landmark_drawing_spec=mp_drawing.DrawingSpec(color=(0,255,0), thickness=3, circle_radius=3),
                    connection_drawing_spec=mp_drawing.DrawingSpec(color=(255,0,255), thickness=2, circle_radius=2),
                )

            out.write(frame)

        cap.release()
        out.release()
        pose.close()

        st.success("✅ Skeleton Overlay เสร็จแล้ว!")
        st.video(output_video)
        st.download_button("Download Skeleton Overlay Video", data=open(output_video, "rb"), file_name="skeleton_overlay.mp4")
