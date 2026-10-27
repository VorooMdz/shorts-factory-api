import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def send_telegram_video(video_path, caption, token, chat_id):
    """Envía el archivo de vídeo directamente a Telegram."""
    if not token or not chat_id:
        print("⚠️ Faltan las credenciales de Telegram (TOKEN o CHAT_ID) en el entorno.")
        return False
    
    clean_token = token.strip()
    clean_chat_id = chat_id.strip()
    url = f"https://api.telegram.org/bot{clean_token}/sendVideo"
    
    print(f"📤 Enviando vídeo a Telegram...")
    try:
        with open(video_path, 'rb') as f:
            files = {'video': f}
            data = {'chat_id': clean_chat_id, 'caption': caption}
            response = requests.post(url, data=data, files=files)
            if response.status_code == 200:
                print("✅ ¡Vídeo enviado a Telegram con éxito!")
                return True
            else:
                print(f"⚠️ Error al enviar a Telegram: {response.text}")
                return False
    except Exception as e:
        print(f"⚠️ Excepción al conectar con Telegram: {e}")
        return False

def send_telegram_message(text, token, chat_id):
    """Envía un mensaje de texto informativo a Telegram."""
    if not token or not chat_id:
        return
    clean_token = token.strip()
    clean_chat_id = chat_id.strip()
    url = f"https://api.telegram.org/bot{clean_token}/sendMessage"
    try:
        requests.post(url, data={'chat_id': clean_chat_id, 'text': text})
    except Exception as e:
        print(f"⚠️ Error enviando mensaje de texto a Telegram: {e}")

def get_next_available_slot(youtube, madrid_tz):
    """
    Gestiona una cola de hasta 3 vídeos al día en los horarios 14:00, 18:00 y 21:00 (Hora de Madrid).
    Si un día ya tiene 3 vídeos programados (o sus 3 turnos ocupados), salta al siguiente día libre.
    """
    target_hours = [14, 18, 21]
    now_madrid = datetime.now(madrid_tz)
    
    occupied_slots = set()   # Guarda turnos exactos ej. "2026-10-27 14:00"
    videos_per_day = {}      # Cuenta cuántos vídeos hay programados cada día ej. {"2026-10-27": 2}

    try:
        ch_res = youtube.channels().list(part="contentDetails", mine=True).execute()
        items = ch_res.get("items", [])
        if items:
            uploads_playlist_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
            pl_res = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=50
            ).execute()
            video_ids = [it["contentDetails"]["videoId"] for it in pl_res.get("items", [])]

            if video_ids:
                v_res = youtube.videos().list(
                    part="status",
                    id=",".join(video_ids)
                ).execute()
                for v in v_res.get("items", []):
                    pub_at = v.get("status", {}).get("publishAt")
                    if pub_at:
                        dt_utc = datetime.fromisoformat(pub_at.replace("Z", "+00:00"))
                        dt_mad = dt_utc.astimezone(madrid_tz)
                        
                        day_key = dt_mad.strftime("%Y-%m-%d")
                        slot_key = dt_mad.strftime("%Y-%m-%d %H:00")
                        
                        occupied_slots.add(slot_key)
                        videos_per_day[day_key] = videos_per_day.get(day_key, 0) + 1
    except Exception as e:
        print(f"ℹ️ No se pudo leer la cola previa del canal (usando cálculo estándar): {e}")

    # Buscar desde hoy en adelante el primer turno libre (14:00, 18:00 o 21:00)
    # en un día que todavía no haya alcanzado el máximo de 3 vídeos
    day_offset = 0
    while True:
        check_date = (now_madrid + timedelta(days=day_offset)).date()
        day_str = check_date.strftime("%Y-%m-%d")

        # Si el día tiene menos de 3 vídeos programados, revisamos sus 3 franjas horarias
        if videos_per_day.get(day_str, 0) < 3:
            for hr in target_hours:
                candidate = datetime(
                    check_date.year, check_date.month, check_date.day,
                    hr, 0, 0, tzinfo=madrid_tz
                )
                # Dejar un margen mínimo de 10 minutos respecto a la hora actual
                if candidate <= now_madrid + timedelta(minutes=10):
                    continue

                slot_str = candidate.strftime("%Y-%m-%d %H:00")
                if slot_str not in occupied_slots:
                    return candidate

        day_offset += 1

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    telegram_token = os.environ.get("TELEGRAM_TOKEN")
    telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    
    video_path = sys.argv[1] if len(sys.argv) > 1 else "output.mp4"
    
    titulo_final = "Psicología Fascinante #shorts"
    descripcion_atractiva = "Explorando los secretos de la mente y la psicología humana. #shorts #psicología"
    
    # Leer payload.json para extraer títulos personalizados
    if os.path.exists("payload.json"):
        try:
            with open("payload.json", "r", encoding="utf-8") as f:
                raw_data = json.load(f)
                item = raw_data[0] if isinstance(raw_data, list) and len(raw_data) > 0 else raw_data
                if isinstance(item, dict) and "json" in item:
                    item = item["json"]
                
                if isinstance(item, dict):
                    if item.get("TituloYT"):
                        titulo_final = item["TituloYT"]
                    elif item.get("tema_titulo"):
                        titulo_final = f"{item['tema_titulo']} #shorts"
                        
                    if item.get("DescripcionYT"):
                        descripcion_atractiva = item["DescripcionYT"]
        except Exception as e:
            print(f"⚠️ Error al leer payload.json: {e}")

    print(f"📌 TÍTULO DETECTADO: --> {titulo_final} <--")

    # =========================================================================
    # PASO 1: ENVIAR EL VÍDEO A TELEGRAM PRIMERO
    # =========================================================================
    caption_telegram = f"🎬 ¡Short renderizado!\n📌 Título: {titulo_final}"
    send_telegram_video(video_path, caption_telegram, telegram_token, telegram_chat_id)

    # =========================================================================
    # PASO 2: SUBIR Y PROGRAMAR EN YOUTUBE (3 TURNOS DIARIOS: 14:00, 18:00, 21:00)
    # =========================================================================
    try:
        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token"
        )
        
        youtube = build("youtube", "v3", credentials=credentials)
        madrid_tz = ZoneInfo("Europe/Madrid")
        
        # Calcular automáticamente el próximo turno libre (14:00, 18:00 o 21:00)
        target_madrid = get_next_available_slot(youtube, madrid_tz)
        fecha_legible = target_madrid.strftime("%d/%m/%Y a las %H:%M")
        
        # Convertir la hora de Madrid a UTC para YouTube
        target_utc = target_madrid.astimezone(timezone.utc)
        publish_at_str = target_utc.isoformat().replace("+00:00", "Z")
        
        body = {
            "snippet": {
                "title": titulo_final,
                "description": descripcion_atractiva,
                "tags": ["psicologia", "sesgoscognitivos", "shorts", "curiosidades"],
                "categoryId": "27"
            },
            "status": {
                "privacyStatus": "private",
                "publishAt": publish_at_str,
                "selfDeclaredMadeForKids": False
            }
        }
        
        media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
        
        print(f"🚀 Subiendo vídeo a YouTube y programándolo para el {fecha_legible} (España) [{publish_at_str} UTC]...")
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
        success_msg = (
            f"✅ ¡Vídeo subido y programado en cola (Máx 3/día: 14h, 18h, 21h)!\n"
            f"📅 Fecha y hora: {fecha_legible} (España)\n"
            f"📌 Título: {titulo_final}\n"
            f"🔗 https://youtu.be/{video_id}"
        )
        print(success_msg)
        send_telegram_message(success_msg, telegram_token, telegram_chat_id)

    except Exception as yt_err:
        error_msg = f"⚠️ Aviso: El vídeo se ha guardado en Telegram, pero la subida a YouTube falló.\n\nMotivo: {yt_err}"
        print(error_msg)
        send_telegram_message(error_msg, telegram_token, telegram_chat_id)
        sys.exit(0)

if __name__ == "__main__":
    upload_video()
