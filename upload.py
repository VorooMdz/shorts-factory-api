import os
import sys
import json
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    
    # El primer argumento es la ruta del vídeo renderizado (output.mp4)
    video_path = sys.argv[1] if len(sys.argv) > 1 else "output.mp4"
    
    # Valores por defecto por si el payload no trae los campos esperados
    titulo_final = "Psicología Fascinante #shorts"
    descripcion_atractiva = "Explorando los secretos de la mente y la psicología humana. #shorts #psicología"
    
    # Leemos el archivo payload.json descargado en el workflow para extraer los textos personalizados
    if os.path.exists("payload.json"):
        try:
            with open("payload.json", "r", encoding="utf-8") as f:
                data = json.load(f)
                # Si n8n envía un array, cogemos el primer elemento
                if isinstance(data, list) and len(data) > 0:
                    data = data[0]
                if "json" in data:
                    data = data["json"]
                
                # Extraemos el TituloYT y DescripcionYT generados por el Guionista 1
                if "TituloYT" in data and data["TituloYT"]:
                    titulo_final = data["TituloYT"]
                elif "tema_titulo" in data and data["tema_titulo"]:
                    titulo_final = f"{data['tema_titulo']} #shorts"
                    
                if "DescripcionYT" in data and data["DescripcionYT"]:
                    descripcion_atractiva = data["DescripcionYT"]
        except Exception as e:
            print(f"⚠️ No se pudo leer el payload.json para los textos: {e}")

    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri="https://oauth2.googleapis.com/token"
    )
    
    youtube = build("youtube", "v3", credentials=credentials)
    
    # 🕒 Calcular las 18:00 UTC de programación automática
    now = datetime.now(timezone.utc)
    target_time = now.replace(hour=18, minute=0, second=0, microsecond=0)
    if now >= target_time:
        target_time = target_time + timedelta(days=1)
    
    publish_at_str = target_time.isoformat().replace("+00:00", "Z")
    
    body = {
        "snippet": {
            "title": titulo_final,
            "description": descripcion_atractiva,
            "tags": ["psicologia", "sesgoscognitivos", "shorts", "curiosidades"],
            "categoryId": "27" # Educación
        },
        "status": {
            "privacyStatus": "private",     # Obligatorio para programar vídeos en YouTube
            "publishAt": publish_at_str,    # Fecha y hora exacta en la que se lanzará de forma automática
            "selfDeclaredMadeForKids": False
        }
    }
    
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
    
    print(f"🚀 Subiendo vídeo '{titulo_final}' y programándolo para: {publish_at_str}...")
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )
    
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"📥 Progreso de subida: {int(status.progress() * 100)}%")
            
    video_id = response.get('id')
    print(f"✅ ¡Vídeo programado con éxito! ID: {video_id}")
    print(f"🔗 Enlace: https://youtu.be/{video_id}")

if __name__ == "__main__":
    upload_video()
