import os
import json
import google.oauth2.credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload_video():
    client_secret_env = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")

    if not client_secret_env or not refresh_token:
        print("❌ Faltan las credenciales de YouTube (YOUTUBE_CLIENT_SECRET o YOUTUBE_REFRESH_TOKEN) en los secretos de GitHub.")
        exit(1)

    try:
        client_config = json.loads(client_secret_env)
    except Exception as e:
        print(f"❌ Error al decodificar YOUTUBE_CLIENT_SECRET como JSON válido: {e}")
        print(f"Contenido recibido (primeros 20 caracteres): {client_secret_env[:20] if client_secret_env else 'VACÍO'}")
        exit(1)
    
    # Soporta tanto estructura de archivo client_secret.json como credenciales planas
    installed = client_config.get("installed", client_config)

    creds = google.oauth2.credentials.Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=installed.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=installed.get("client_id"),
        client_secret=installed.get("client_secret")
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
