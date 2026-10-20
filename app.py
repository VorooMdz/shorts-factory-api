import os
import subprocess
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

# Añadir la carpeta bin al PATH para que Python encuentre ffmpeg
os.environ["PATH"] += os.pathsep + os.path.abspath("bin")


class VideoRequest(BaseModel):
  audio_url: str
  texto_gancho: str


@app.post("/generar")
def generar_video(data: VideoRequest):
  try:
    audio_path = "audio.mp3"
    r = requests.get(data.audio_url)
    with open(audio_path, "wb") as f:
      f.write(r.content)

    output_path = "output_short.mp4"

    # Comando de FFmpeg para renderizar el short vertical con el texto y el audio
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1080x1920:r=30",
        "-i",
        audio_path,
        (
            "-vf"
            f" drawtext=text='{data.texto_gancho}':fontcolor=white:fontsize=70:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,5)'"
        ),
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        output_path,
    ]

    subprocess.run(cmd, check=True)

    return {"mensaje": "¡Vídeo generado con éxito!", "archivo": output_path}
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
