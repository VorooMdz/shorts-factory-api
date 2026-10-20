#!/usr/env/bin bash
# Salir inmediatamente si hay un error
set -e

# Instalar las dependencias de Python
pip install -r requirements.txt

# Descargar e instalar una versión estática de FFmpeg para que MoviePy pueda usarse en Linux
echo "Descargando FFmpeg..."
curl -L https://evermeet.cx/ffmpeg/get/linux -o ffmpeg || true
# O una alternativa más robusta para Linux (Static build de BtbN o John Van Sickle):
curl -O https://www.johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar -xf ffmpeg-release-amd64-static.tar.xz
# Mover los binarios a una ruta del sistema accesible
mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/
mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/
chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

echo "¡Build completado con FFmpeg instalado!"
