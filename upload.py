import os
import json
import google.oauth2.credentials
import google_auth_oauthlib.flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import requests

def upload_video():
    client_secret_json = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")

    if not client_secret_json or not refresh_token:
        print("❌ Faltan las credenciales de YouTube en las variables de entorno.")
        return

    client_config = json.loads(client_secret_json)
    
    creds = google.oauth2.credentials.Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=client_config["installed"]["token_uri"],
        client_id=client_config["installed"]["client_id"],
        client_secret=client_config["installed"]["client_secret"]
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
            "categoryId": "27" # Education
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

    print(f"✅ Vídeo subido con éxito! ID: {response['id']}")

    # Actualizar historial_temas.json automáticamente en el repo
    update_history(payload)

def update_history(payload):
    # Lógica para registrar el tema publicado en historial_temas.json
    print("📝 Actualizando historial de temas...")
    # (El script auto-commiteará los cambios al repositorio si lo deseas, o se gestionará vía API)

if __name__ == "__main__":
    try:
        upload_video()
    except Exception as e:
        print(f"❌ Error en la subida a YouTube: {e}")
        exit(1)
