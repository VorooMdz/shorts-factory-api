import os
import sys
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    
    video_path = sys.argv[1]
    title = sys.argv[2]
    
    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri="https://oauth2.googleapis.com/token"
    )
    
    youtube = build("youtube", "v3", credentials=credentials)
    
    # 🕒 Calcular las 18:00 UTC de hoy (o del día siguiente si ya ha pasado)
    now = datetime.now(timezone.utc)
    target_time = now.replace(hour=18, minute=0, second=0, microsecond=0)
    if now >= target_time:
        target_time = target_time + timedelta(days=1)
    
    publish_at_str = target_time.isoformat().replace("+00:00", "Z")
    
    body = {
        "snippet": {
            "title": f"{title} #shorts",
            "description": "Explorando los secretos de la mente y la psicología humana. #shorts #psicología",
            "tags": ["psicologia", "sesgoscognitivos", "shorts", "curiosidades"],
            "categoryId": "27"
        },
        "status": {
            "privacyStatus": "private",     # Obligatorio para programar vídeos en YouTube
            "publishAt": publish_at_str,    # Fecha y hora exacta en la que se lanzará solo
            "selfDeclaredMadeForKids": False
        }
    }
    
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
    
    print(f"🚀 Subiendo vídeo a YouTube y programándolo para: {publish_at_str}...")
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
