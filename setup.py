from setuptools import setup

setup(
    name="motion-webapp-start",
    version="0.0.1",
    py_modules=["serve"],
    entry_points={"console_scripts": ["streamlit=serve:cli"]},
)
