
import streamlit as st
import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
import tempfile
from collections import deque

st.set_page_config(page_title="🌸 Motion Detection V4.1 (Clean Log + Overlay) 💚", layout="wide")

FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE = 0.5  # roughly ~13px font
FONT_THICKNESS = 1

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

MOTIONS = [
    "Advancing","Retreating","Enclosing","Spreading","Directing","Indirecting",
    "Gliding","Punching","Dabbing","Flicking","Slashing","Wringing","Pressing"
]

# Compute key metrics
def compute_hip_z(landmarks):
    lh = np.array([landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x,
                   landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y,
                   landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].z])
    rh = np.array([landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].x,
                   landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].y,
                   landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value].z])
    return ((lh[2] + rh[2]) / 2.0)

def compute_wrist_distance(landmarks):
    lw = np.array([landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                   landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y])
    rw = np.array([landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].x,
                   landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].y])
    return np.linalg.norm(lw-rw)

def compute_hand_velocity(prev_wrist, curr_wrist):
    if prev_wrist is None:
        return 0
    return np.linalg.norm(curr_wrist - prev_wrist)

# Multi-motion detection based on heuristics
def detect_motions(prev_landmarks, curr_landmarks, thresholds):
    detected = {m:0 for m in MOTIONS}

    # Compute metrics
    hip_z = compute_hip_z(curr_landmarks)
    wrist_dist = compute_wrist_distance(curr_landmarks)

    lw = np.array([curr_landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                   curr_landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y,
                   curr_landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].z])
    rw = np.array([curr_landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].x,
                   curr_landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].y,
                   curr_landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].z])

    velocity_l = compute_hand_velocity(prev_landmarks["lw"], lw) if prev_landmarks else 0
    velocity_r = compute_hand_velocity(prev_landmarks["rw"], rw) if prev_landmarks else 0
    avg_velocity = (velocity_l+velocity_r)/2

    # Advancing/Retreating
    if prev_landmarks:
        prev_hip_z = prev_landmarks["hip_z"]
        delta_z = hip_z - prev_hip_z
        if delta_z < -thresholds["hip"]: detected["Advancing"]=1
        if delta_z > thresholds["hip"]: detected["Retreating"]=1

    # Enclosing/Spreading (distance change)
    if prev_landmarks:
        prev_wrist_dist = prev_landmarks["wrist_dist"]
        delta_dist = wrist_dist - prev_wrist_dist
        if delta_dist < -thresholds["wrist"]: detected["Enclosing"]=1
        if delta_dist > thresholds["wrist"]: detected["Spreading"]=1

    # Directing/Indirecting
    if wrist_dist > thresholds["directing"]: detected["Directing"]=1
    if avg_velocity > thresholds["indirecting"]: detected["Indirecting"]=1

    # Effort motions (velocity-based heuristics)
    if avg_velocity > thresholds["punching"]: detected["Punching"]=1
    if avg_velocity > thresholds["dabbing"] and avg_velocity < thresholds["punching"]: detected["Dabbing"]=1
    if avg_velocity > thresholds["flicking"] and avg_velocity < thresholds["dabbing"]: detected["Flicking"]=1
    if avg_velocity > thresholds["slashing"]: detected["Slashing"]=1
    if avg_velocity > thresholds["wringing"]: detected["Wringing"]=1
    if avg_velocity > thresholds["pressing"]: detected["Pressing"]=1
    if avg_velocity < thresholds["gliding"]: detected["Gliding"]=1

    return detected, {
        "hip_z":hip_z,
        "wrist_dist":wrist_dist,
        "lw":lw,
        "rw":rw
    }

# Streamlit UI
st.title("🌸 Motion Detection V4.1 (Clean Log + Overlay) 💚")
uploaded_file = st.file_uploader("Upload a video", type=["mp4","mov","avi","mkv"])

st.sidebar.header("Detection Sensitivity Settings")
thresholds = {
    "hip": st.sidebar.slider("Hip Z change (Adv/Ret)",0.001,0.05,0.005,0.001),
    "wrist": st.sidebar.slider("Wrist distance change (Encl/Spread)",0.001,0.1,0.01,0.001),
    "directing": st.sidebar.slider("Directing wrist distance",0.05,0.5,0.2,0.01),
    "indirecting": st.sidebar.slider("Indirecting velocity",0.001,0.05,0.01,0.001),
    "gliding": st.sidebar.slider("Gliding max velocity",0.001,0.02,0.01,0.001),
    "punching": st.sidebar.slider("Punching min velocity",0.01,0.2,0.05,0.01),
    "dabbing": st.sidebar.slider("Dabbing velocity",0.005,0.05,0.02,0.001),
    "flicking": st.sidebar.slider("Flicking velocity",0.003,0.03,0.01,0.001),
    "slashing": st.sidebar.slider("Slashing velocity",0.005,0.1,0.03,0.005),
    "wringing": st.sidebar.slider("Wringing velocity",0.002,0.05,0.01,0.001),
    "pressing": st.sidebar.slider("Pressing velocity",0.001,0.03,0.005,0.001),
}

analyze_button = st.button("Analyze Motion")

if uploaded_file and analyze_button:
    tfile = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tfile.write(uploaded_file.read())
    input_video_path = tfile.name

    cap = cv2.VideoCapture(input_video_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    output_path = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    motion_log = {}
    frame_idx = 0
    prev_landmarks = None
    hold_labels = []
    hold_counter = 0

    with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(frame_rgb)

            detected_frame = {m:0 for m in MOTIONS}
            display_labels = []

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                detected_frame, prev_landmarks = detect_motions(prev_landmarks, landmarks, thresholds)

                # Determine which motions to display (sorted as in MOTIONS)
                display_labels = [m for m in MOTIONS if detected_frame[m]==1]

                # Label hold for 1 second
                if display_labels:
                    hold_labels = display_labels
                    hold_counter = fps
                elif hold_counter > 0:
                    display_labels = hold_labels
                    hold_counter -= 1
                else:
                    hold_labels = []

                # Draw skeleton
                mp_drawing.draw_landmarks(
                    frame,
                    results.pose_landmarks,
                    mp_pose.POSE_CONNECTIONS,
                    mp_drawing.DrawingSpec(color=(0,0,255), thickness=2, circle_radius=2),
                    mp_drawing.DrawingSpec(color=(0,0,255), thickness=2, circle_radius=2)
                )

                # Draw labels in a single neat row
                if display_labels:
                    cv2.putText(frame, ", ".join(display_labels), (30,50), cv2.FONT_HERSHEY_SIMPLEX, FONT_SCALE, (0,0,255), FONT_THICKNESS)

                # Aggregate to 1 row per second
                sec = int(frame_idx/fps)
                if sec not in motion_log:
                    motion_log[sec] = [0]*len(MOTIONS)

                for i,m in enumerate(MOTIONS):
                    if detected_frame[m]==1:
                        motion_log[sec][i] = 1

            out.write(frame)
            frame_idx += 1

    cap.release()
    out.release()

    st.success("✅ Motion analysis complete! Preview below:")
    st.video(output_path)

    columns = ["Time (s)"] + MOTIONS
    motion_rows = [[sec]+motion_log[sec] for sec in sorted(motion_log.keys())]
    df_motion = pd.DataFrame(motion_rows, columns=columns)
    st.write("### Motion Detection Log (1 row per sec)")
    st.dataframe(df_motion)

    with open(output_path, "rb") as f:
        st.download_button("Download Processed Video", f, file_name="motion_v41.mp4")

    csv = df_motion.to_csv(index=False).encode("utf-8")
    st.download_button("Download Motion CSV", csv, file_name="motion_log_v41.csv", mime="text/csv")
