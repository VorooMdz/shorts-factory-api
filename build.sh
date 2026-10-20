#!/usr/bin/env bash
set -o errexit

pip install -r requirements.txt

# Descargar FFmpeg estático para Linux en una carpeta local 'bin'
mkdir -p bin
if [ ! -f "bin/ffmpeg" ]; then
  echo "Descargando FFmpeg..."
  curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz
  tar -xf ffmpeg.tar.xz
  find ffmpeg-*-amd64-static -maxdepth 1 -type f -name "ffmpeg" -exec cp {} bin/ \;
  find ffmpeg-*-amd64-static -maxdepth 1 -type f -name "ffprobe" -exec cp {} bin/ \;
  rm -rf ffmpeg.tar.xz ffmpeg-*-amd64-static
fi
