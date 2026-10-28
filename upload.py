import os
import google.oauth2.credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import json

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")

    if not client_id or not client_secret or not refresh_token:
        print("❌ Faltan credenciales de YouTube en los secretos de GitHub (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET o YOUTUBE_REFRESH_TOKEN).")
        exit(1)

    # Creamos las credenciales directamente con los valores individuales de tus secretos
    creds = google.oauth2.credentials.Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret
    )

    youtube = build("youtube", "v3", credentials=creds)

    with open("payload.json", "r", encoding="utf-8") as f:
        payload = json.load(f)

    title = payload.get("TituloYT", "Short de Psicología 🧠 #shorts")
    description = payload.get("DescripcionYT", "Descubre más en nuestro canal #shorts #psicologia")

    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": ["shorts", "psicologia", "mente", "curiosidades"],
            "categoryId": "27"  # Education
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload("output.mp4", chunksize=-1, resumable=True)

    print("🚀 Subiendo vídeo a YouTube...")
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"Uploaded {int(status.progress() * 100)}%")

    print(f"✅ ¡Vídeo subido con éxito a YouTube! ID: {response['id']}")

if __name__ == "__main__":
    try:
        upload_video()
    except Exception as e:
        print(f"❌ Error crítico en la subida a YouTube: {e}")
        exit(1)
