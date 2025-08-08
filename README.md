# Skeleton Overlay with Motion Detection

A Streamlit application that overlays skeleton detection on videos with customizable colors and motion text based on CSV timestamps.

## Features

- 🎨 **Customizable Skeleton Colors**: Choose colors for skeleton lines and dots
- 📏 **Adjustable Sizes**: Control line thickness and dot radius
- 📝 **Motion Text Overlay**: Display motion labels from CSV data
- 🎯 **Text Positioning**: 6 preset positions or custom positioning
- 🎨 **Text Customization**: Color, size, and thickness control
- 📊 **CSV Integration**: Match motion data with video timestamps

## Installation

1. **Activate the conda environment:**
   ```bash
   conda activate mediapipe_env
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

## Usage

1. **Run the app:**
   ```bash
   python -m streamlit run skeleton_overlay_with_timestamp.py
   ```

2. **Upload files:**
   - Upload a video file (MP4, MOV, AVI)
   - Upload a CSV file with motion data

3. **Customize settings:**
   - **Skeleton Colors**: Choose line and dot colors
   - **Skeleton Style**: Adjust thickness and radius
   - **Movement Text**: Set color, size, and position
   - **Text Position**: Choose from presets or custom positioning

4. **Generate overlay:**
   - Click "Generate Skeleton Overlay"
   - Download the processed video

## CSV Format

Your CSV should have:
- `timestamp` column (format: MM:SS)
- Motion columns with 1/0 values indicating when motions occur

Example:
```
timestamp,motion1,motion2,motion3
0:00,1,0,0
0:01,0,1,0
0:02,0,0,1
```

## Color Options

- **Preset Colors**: Red, Green, Blue, Yellow, Cyan, Magenta, Orange, Purple, White, Black
- **Custom Colors**: Use the color picker for any color

## Text Positions

- Bottom Right (default)
- Bottom Left
- Top Right
- Top Left
- Center
- Custom (with X/Y percentage sliders)

## Troubleshooting

- **MediaPipe errors**: Normal warnings, doesn't affect functionality
- **Color issues**: Make sure you're using the conda environment
- **Video format**: Supports MP4, MOV, AVI formats 