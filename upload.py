import os
import json
import requests
import google.oauth2.credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def send_telegram_message(text):
    token = os.environ.get("TELEGRAM_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if token and chat_id:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown"
        }
        try:
            requests.post(url, json=payload)
        except Exception as e:
            print(f"❌ Error al enviar notificación a Telegram: {e}")

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN", "").strip()

    # TRAZA DE DEPURACIÓN SEGURA (Muestra longitud y primeros/últimos 4 caracteres)
    print(f"DEBUG -> Client ID length: {len(client_id)} | starts with: {client_id[:4]}... ends with: ...{client_id[-4:]}")
    print(f"DEBUG -> Client Secret length: {len(client_secret)} | starts with: {client_secret[:4]}... ends with: ...{client_secret[-4:]}")
    print(f"DEBUG -> Refresh Token length: {len(refresh_token)} | starts with: {refresh_token[:4]}... ends with: ...{refresh_token[-4:]}")

    if not client_id or not client_secret or not refresh_token:
        error_msg = "❌ Faltan credenciales de YouTube en los secretos de GitHub."
        print(error_msg)
        send_telegram_message(error_msg)
        exit(1)

    try:
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

        video_id = response['id']
        success_msg = f"✅ *¡Vídeo subido con éxito a YouTube!*\n\n📌 *Título:* {title}\n🔗 https://youtu.be/{video_id}"
        print(success_msg)
        send_telegram_message(success_msg)

    except Exception as e:
        error_msg = f"⚠️ *La subida a YouTube falló.*\n\nMotivo: `{str(e)}`"
        print(f"❌ Error crítico: {e}")
        send_telegram_message(error_msg)
        exit(1)

if __name__ == "__main__":
    upload_video()
