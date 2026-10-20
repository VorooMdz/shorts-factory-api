import os
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from moviepy.editor import AudioFileClip, ColorClip, TextClip, CompositeVideoClip

app = FastAPI()

class VideoRequest(BaseModel):
    audio_url: str
    texto_gancho: str

@app.post("/generar")
def generar_video(data: VideoRequest):
    try:
        # Descargar el audio de ElevenLabs
        audio_path = "audio.mp3"
        r = requests.get(data.audio_url)
        with open(audio_path, "wb") as f:
            f.write(r.content)
            
        output_path = "output_short.mp4"
        
        # Crear un fondo negro vertical (1080x1920) con la duración del audio
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        
        background = ColorClip(size=(1080, 1920), color=(0, 0, 0), duration=duration)
        
        # Crear el texto del gancho centrado
        txt_clip = TextClip(data.texto_gancho, fontsize=70, color='white', size=(1000, None), method='caption')
        txt_clip = txt_clip.set_position('center').set_duration(duration)
        
        # Combinar vídeo y audio
        video = CompositeVideoClip([background, txt_clip])
        video.write_videofile(output_path, fps=24, codec='libx264', audio_codec='aac')
        
        return {"mensaje": "¡Vídeo generado con éxito con MoviePy!", "archivo": output_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
