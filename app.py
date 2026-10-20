import os
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from moviepy import AudioFileClip, ColorClip, TextClip, CompositeVideoClip

app = FastAPI()

@app.post("/generar")
async def generar_video(
    texto_gancho: str = Form(...),
    audio: UploadFile = File(...)
):
    try:
        # Guardar el archivo de audio recibido directamente en disco
        audio_path = "audio.mp3"
        with open(audio_path, "wb") as buffer:
            content = await audio.read()
            buffer.write(content)
            
        output_path = "output_short.mp4"
        
        # Crear un fondo negro vertical (1080x1920) con la duración del audio
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        
        background = ColorClip(size=(1080, 1920), color=(0, 0, 0), duration=duration)
        
        # Crear el texto del gancho centrado
        txt_clip = TextClip(text=texto_gancho, font_size=70, color='white', size=(1000, None), method='caption')
        txt_clip = txt_clip.set_position('center').set_duration(duration)
        
        # Combinar vídeo y audio
        video = CompositeVideoClip([background, txt_clip])
        video = video.set_audio(audio_clip)
        video.write_videofile(output_path, fps=24, codec='libx264', audio_codec='aac')
        
        return {"mensaje": "¡Vídeo generado con éxito con MoviePy!", "archivo": output_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
