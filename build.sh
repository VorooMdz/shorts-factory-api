#!/usr/bin/env bash
set -o errexit

# Instalar las dependencias de Python
pip install -r requirements.txt

# Crear carpeta bin y descargar FFmpeg usando Python (evita problemas de permisos y de red)
mkdir -p bin
if [ ! -f "bin/ffmpeg" ]; then
  echo "Descargando FFmpeg estático..."
  python3 -c "
import urllib.request
import tarfile
import os
import glob

url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
print('Descargando archivo comprimido...')
urllib.request.urlretrieve(url, 'ffmpeg.tar.xz')

print('Descomprimiendo binarios...')
with tarfile.open('ffmpeg.tar.xz') as tar:
    for member in tar.getmembers():
        if member.name.endswith('/ffmpeg') or member.name.endswith('/ffprobe'):
            # Extraer directamente en bin/
            filename = os.path.basename(member.name)
            member.name = filename
            tar.extract(member, path='bin')

os.remove('ffmpeg.tar.xz')
print('¡FFmpeg instalado con éxito en la carpeta bin!')
"
  chmod +x bin/ffmpeg
  chmod +x bin/ffprobe
fi
