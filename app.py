import os
import traceback
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from moviepy import AudioFileClip, ColorClip, CompositeVideoClip

app = FastAPI()

@app.post("/generar")
async def generar_video(
    texto_gancho: str = Form(...),
    audio: UploadFile = File(...)
):
    print("--- INICIO DE LA PETICIÓN ---")
    try:
        audio_path = "audio.mp3"
        print("Leyendo archivo de audio...")
        content = await audio.read()
        with open(audio_path, "wb") as buffer:
            buffer.write(content)
        print("Audio guardado correctamente en disco.")
            
        output_path = "output_short.mp4"
        
        print("Cargando AudioFileClip...")
        audio_clip = AudioFileClip(audio_path)
        duration = audio_clip.duration
        print(f"Duración del audio: {duration} segundos")
        
        print("Creando ColorClip...")
        background = ColorClip(size=(1080, 1920), color=(0, 0, 0), duration=duration)
        
        print("Renderizando vídeo con CompositeVideoClip...")
        video = CompositeVideoClip([background])
        video = video.with_audio(audio_clip)
        video.write_videofile(output_path, fps=24, codec='libx264', audio_codec='aac')
        print("¡Vídeo renderizado con éxito!")
        
        return {"mensaje": "¡Vídeo generado con éxito!", "archivo": output_path}
        
    except Exception as e:
        # Esto capturará cualquier error interno y lo devolverá en formato JSON legible
        error_detallado = traceback.format_exc()
        print(f"ERROR CRÍTICO CAPTURADO:\n{error_detallado}")
        raise HTTPException(status_code=500, detail=str(e) + " | Detalle: " + error_detallado)
