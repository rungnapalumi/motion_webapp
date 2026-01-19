"""
Render compatibility shim.

Some deployments were configured to run `motion_web_app_full_dashboard_png.py`.
The original version depended on `mediapipe`, which may not be installed on Render.

This shim forwards execution to `app.py` (the simple 30-second Video Analysis app).
"""

from __future__ import annotations

import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
runpy.run_path(str(HERE / "app.py"), run_name="__main__")


