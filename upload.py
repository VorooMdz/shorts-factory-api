import os
import json
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import google.oauth2.credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def send_telegram_message(text):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if token and chat_id:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown"
        }
        try:
            res = requests.post(url, json=payload, timeout=10)
            if not res.ok:
                print(f"⚠️ Respuesta de error de Telegram: {res.text}")
        except Exception as e:
            print(f"❌ Error al enviar notificación a Telegram: {e}")
    else:
        print("⚠️ Advertencia: TELEGRAM_TOKEN o TELEGRAM_CHAT_ID no están configurados en el entorno.")

def get_next_18h_utc():
    madrid_tz = ZoneInfo("Europe/Madrid")
    now_madrid = datetime.now(madrid_tz)
    target_madrid = now_madrid.replace(hour=18, minute=0, second=0, microsecond=0)
    
    # Si ya han pasado las 17:45 hoy, programamos para mañana a las 18:00
    if now_madrid >= (target_madrid - timedelta(minutes=15)):
        target_madrid += timedelta(days=1)
        
    target_utc = target_madrid.astimezone(timezone.utc)
    return target_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), target_madrid.strftime("%d/%m/%Y a las %H:%M")

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN", "").strip()

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
        if "#shorts" not in title.lower():
            title = f"{title} #shorts"
        description = payload.get("DescripcionYT", "Descubre más en nuestro canal #shorts #psicologia")

        publish_at_utc, publish_str_madrid = get_next_18h_utc()

        body = {
            "snippet": {
                "title": title[:100],
                "description": description,
                "tags": ["shorts", "psicologia", "mente", "curiosidades", "neurociencia"],
                "categoryId": "27"
            },
            "status": {
                "privacyStatus": "private",
                "publishAt": publish_at_utc,
                "selfDeclaredMadeForKids": False
            }
        }

        media = MediaFileUpload("output.mp4", chunksize=-1, resumable=True)

        print(f"🚀 Subiendo y programando vídeo en YouTube para el {publish_str_madrid}...")
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
        success_msg = (
            f"✅ *¡Short subido y programado con éxito!*\n\n"
            f"📌 *Título:* {title}\n"
            f"🗓️ *Programado para:* {publish_str_madrid} (Hora Madrid)\n"
            f"🔗 https://youtube.com/shorts/{video_id}"
        )
        print(success_msg)
        send_telegram_message(success_msg)

    except Exception as e:
        error_msg = f"⚠️ *La subida a YouTube falló.*\n\nMotivo: `{str(e)}`"
        print(f"❌ Error crítico: {e}")
        send_telegram_message(error_msg)
        exit(1)

if __name__ == "__main__":
    upload_video()
