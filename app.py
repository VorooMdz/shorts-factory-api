import os
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from moviepy import AudioFileClip, ColorClip, CompositeVideoClip

app = FastAPI()

@app.post("/generar")
async def generar_video(
    texto_gancho: str = Form(...),
    audio: UploadFile = File(...)
):
    try:
        audio_path = "audio.mp3"
        with open(audio_path, "wb") as buffer:
            content = await audio.read()
            buffer.write(content)
            
        output_path = "output_short.mp4"
        
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        
        # Solo fondo y audio (sin texto por ahora para probar)
        background = ColorClip(size=(1080, 1920), color=(0, 0, 0), duration=duration)
        
        video = CompositeVideoClip([background])
        video = video.with_audio(audio_clip)
        video.write_videofile(output_path, fps=24, codec='libx264', audio_codec='aac')
        
        return {"mensaje": "¡Vídeo generado con éxito (sin texto)!", "archivo": output_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
