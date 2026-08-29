"""Render still starts this file via `streamlit run ...`. Serve the React app instead."""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve().parent / "serve.py")])
