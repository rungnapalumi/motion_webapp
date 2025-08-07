import streamlit as st
import cv2
import pandas as pd
import numpy as np
from tempfile import NamedTemporaryFile
import os

st.title("🎥 Motion Skeleton Overlay with Timestamp")

video_file = st.file_uploader("Upload a video file", type=["mp4", "mov", "avi"])
csv_file = st.file_uploader("Upload a motion timestamp CSV file", type=["csv"])

if video_file and csv_file:
    tfile = NamedTemporaryFile(delete=False)
    tfile.write(video_file.read())
    video_path = tfile.name

    motion_df = pd.read_csv(csv_file)
    motion_df.columns = motion_df.columns.str.strip().str.lower()
    if 'timestamp' not in motion_df.columns:
        st.error("CSV must contain a 'timestamp' column.")
    else:
        def time_to_sec(t):
            h, m, s = map(int, t.split(":"))
            return h * 3600 + m * 60 + s

        motion_df['time_sec'] = motion_df['timestamp'].apply(time_to_sec)

        cap = cv2.VideoCapture(video_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = frame_count / fps

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        out_path = "output_overlay.mp4"
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(out_path, fourcc, fps, (width, height))

        frame_idx = 0
        motion_text = ""

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps
            matched = motion_df[motion_df['time_sec'] == int(current_time)]
            motions = matched.drop(columns=['timestamp', 'time_sec'], errors='ignore')
            active_motions = motions.columns[(motions == 1).any()].tolist()
            motion_text = ", ".join(active_motions)

            if motion_text:
                cv2.putText(frame, motion_text, (width - 450, height - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

            out.write(frame)
            frame_idx += 1

        cap.release()
        out.release()

        st.video(out_path)
        with open(out_path, "rb") as file:
            st.download_button("Download Result Video", file.read(), "motion_overlay_result.mp4")
