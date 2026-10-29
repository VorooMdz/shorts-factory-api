import os
import json
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import google.oauth2.credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def send_telegram_notification(text, video_path=None):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("⚠️ Advertencia: TELEGRAM_TOKEN o TELEGRAM_CHAT_ID no están configurados en el entorno.")
        return

    if video_path and os.path.exists(video_path):
        url_video = f"https://api.telegram.org/bot{token}/sendVideo"
        try:
            with open(video_path, "rb") as vf:
                files = {"video": vf}
                data = {
                    "chat_id": chat_id,
                    "caption": text,
                    "parse_mode": "Markdown",
                    "supports_streaming": True
                }
                res = requests.post(url_video, data=data, files=files, timeout=60)
                if res.ok:
                    print("📲 Vídeo MP4 y notificación enviados a Telegram correctamente.")
                    return
                else:
                    print(f"⚠️ Falló el adjunto de vídeo en Telegram ({res.text}), enviando mensaje de texto...")
        except Exception as e:
            print(f"⚠️ Error al adjuntar vídeo a Telegram: {e}. Enviando texto de respaldo...")

    url_msg = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown"
    }
    try:
        requests.post(url_msg, json=payload, timeout=15)
    except Exception as e:
        print(f"❌ Error al enviar notificación a Telegram: {e}")

def get_next_available_slot():
    madrid_tz = ZoneInfo("Europe/Madrid")
    now_madrid = datetime.now(madrid_tz)
    slots_hours = [14, 18, 21]

    # Leer todos los slots ya ocupados en historial_temas.json
    occupied_slots = set()
    if os.path.exists("historial_temas.json"):
        try:
            with open("historial_temas.json", "r", encoding="utf-8") as f:
                hist = json.load(f)
                if isinstance(hist, list):
                    for item in hist:
                        sched = item.get("programado_para_madrid")
                        if sched and isinstance(sched, str):
                            occupied_slots.add(sched.strip())
        except Exception as e:
            print(f"⚠️ No se pudo leer historial_temas.json para comprobar turnos: {e}")

    print(f"📅 Turnos ocupados actualmente en historial: {len(occupied_slots)}")

    # Buscar desde hoy en adelante (hasta 365 días) el primer turno libre (14:00, 18:00 o 21:00)
    base_date = now_madrid.replace(minute=0, second=0, microsecond=0)
    for day_offset in range(365):
        current_day = base_date + timedelta(days=day_offset)
        for hour in slots_hours:
            candidate_madrid = current_day.replace(hour=hour, minute=0, second=0, microsecond=0)
            
            # Dejar al menos 15 minutos de margen respecto a la hora actual
            if candidate_madrid <= (now_madrid + timedelta(minutes=15)):
                continue

            slot_label = candidate_madrid.strftime("%d/%m/%Y a las %H:%M")
            if slot_label not in occupied_slots:
                target_utc = candidate_madrid.astimezone(timezone.utc)
                return target_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), slot_label

    # Fallback de seguridad
    fallback = (now_madrid + timedelta(days=1)).replace(hour=14, minute=0, second=0, microsecond=0)
    return fallback.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), fallback.strftime("%d/%m/%Y a las %H:%M")

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN", "").strip()

    if not client_id or not client_secret or not refresh_token:
        error_msg = "❌ Faltan credenciales de YouTube en los secretos de GitHub."
        print(error_msg)
        send_telegram_notification(error_msg)
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

        publish_at_utc, publish_str_madrid = get_next_available_slot()

        # Guardamos el turno reservado en payload.json para que render.yml lo persista en historial_temas.json
        payload["programado_para_madrid"] = publish_str_madrid
        with open("payload.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

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
        send_telegram_notification(success_msg, video_path="output.mp4")

    except Exception as e:
        error_msg = f"⚠️ *La subida a YouTube falló.*\n\nMotivo: `{str(e)}`"
        print(f"❌ Error crítico: {e}")
        send_telegram_notification(error_msg)
        exit(1)

if __name__ == "__main__":
    upload_video()
