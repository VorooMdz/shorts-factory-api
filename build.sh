#!/usr/bin/env bash
set -e

# 1. Instalar las dependencias de Python (incluyendo moviepy e imageio-ffmpeg)
pip install -r requirements.txt

# 2. Forzar a imageio-ffmpeg a descargar y configurar su binario oficial en el sistema
python -c "import imageio_ffmpeg; print('FFmpeg binary path:', imageio_ffmpeg.get_ffmpeg_exe())"
