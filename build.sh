#!/usr/bin/env bash
set -o errexit

# Instalar dependencias de Python
pip install -r requirements.txt

# Instalar FFmpeg directamente desde los repositorios oficiales de Linux (sin descargas externas lentas)
apt-get update && apt-get install -y ffmpeg
