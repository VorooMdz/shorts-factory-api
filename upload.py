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

def load_gist_schedule(gist_id, gh_token):
    """Lee el historial de turnos programados desde schedule_state.json en el Gist."""
    if not gist_id:
        return []
    headers = {"Accept": "application/vnd.github+json"}
    if gh_token:
        headers["Authorization"] = f"Bearer {gh_token.strip()}"
    try:
        r = requests.get(f"https://api.github.com/gists/{gist_id.strip()}", headers=headers, timeout=15)
        if r.status_code == 200:
            files = r.json().get("files", {})
            if "schedule_state.json" in files:
                content = files["schedule_state.json"].get("content", "[]")
                data = json.loads(content)
                if isinstance(data, list):
                    print(f"📒 Historial leído del Gist: {len(data)} turnos registrados.")
                    return data
    except Exception as e:
        print(f"⚠️ No se pudo leer schedule_state.json del Gist: {e}")
    return []

def save_gist_schedule(gist_id, gh_token, slots_list):
    """Guarda el nuevo turno programado en schedule_state.json dentro del Gist."""
    if not gist_id or not gh_token:
        print("ℹ️ No se proporcionó GIST_ID o GH_TOKEN con permiso de escritura para guardar estado en Gist.")
        return
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {gh_token.strip()}"
    }
    # Mantener solo los últimos 120 turnos para que el archivo sea siempre ligero
    clean_list = sorted(list(set(slots_list)))[-120:]
    payload = {
        "files": {
            "schedule_state.json": {
                "content": json.dumps(clean_list, indent=2)
            }
        }
    }
    try:
        r = requests.patch(f"https://api.github.com/gists/{gist_id.strip()}", headers=headers, json=payload, timeout=15)
        if r.status_code == 200:
            print("💾 Turno guardado correctamente en schedule_state.json (Gist).")
        else:
            print(f"⚠️ No se pudo actualizar schedule_state.json en Gist ({r.status_code}): {r.text}")
    except Exception as e:
        print(f"⚠️ Error al guardar schedule_state.json en Gist: {e}")

def register_slot(slot_dt_madrid, occupied_slots, videos_per_day):
    """Registra una fecha/hora de Madrid como ocupada normalizándola a las franjas 14, 18 o 21."""
    day_key = slot_dt_madrid.strftime("%Y-%m-%d")
    hr = slot_dt_madrid.hour
    # Si hay un vídeo programado cerca de una franja (ej. 13:55 o 14:15), bloqueamos esa franja
    if abs(hr - 14) <= 1:
        norm_hr = 14
    elif abs(hr - 18) <= 1:
        norm_hr = 18
    elif abs(hr - 21) <= 1:
        norm_hr = 21
    else:
        norm_hr = hr

    slot_key = f"{day_key} {norm_hr:02d}:00"
    if slot_key not in occupied_slots:
        occupied_slots.add(slot_key)
        videos_per_day[day_key] = videos_per_day.get(day_key, 0) + 1

def get_next_available_slot(youtube, madrid_tz, gist_id, gh_token):
    """
    Combina la lectura real de YouTube API (incluyendo vídeos privados con search.list forMine=True)
    + el registro persistente en Gist para garantizar exactamente 3 vídeos al día (14:00, 18:00 y 21:00).
    """
    target_hours = [14, 18, 21]
    now_madrid = datetime.now(madrid_tz)
    
    occupied_slots = set()
    videos_per_day = {}

    # 1. Cargar turnos ya reservados en nuestro registro persistente del Gist
    gist_slots = load_gist_schedule(gist_id, gh_token)
    for iso_str in gist_slots:
        try:
            dt = datetime.fromisoformat(iso_str)
            dt_mad = dt.astimezone(madrid_tz)
            register_slot(dt_mad, occupied_slots, videos_per_day)
        except Exception:
            pass

    # 2. Consultar directamente en YouTube todos los vídeos propios (incluidos privados/programados)
    video_ids = set()
    try:
        # Método A: search().list con forMine=True (devuelve vídeos privados y programados)
        s_res = youtube.search().list(
            part="id",
            forMine=True,
            type="video",
            maxResults=50,
            order="date"
        ).execute()
        for it in s_res.get("items", []):
            vid = it.get("id", {}).get("videoId")
            if vid:
                video_ids.add(vid)
    except Exception as e:
        print(f"ℹ️ Aviso en youtube.search (forMine): {e}")

    try:
        # Método B: playlist de uploads por respaldo
        ch_res = youtube.channels().list(part="contentDetails", mine=True).execute()
        items = ch_res.get("items", [])
        if items:
            uploads_playlist_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
            pl_res = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=50
            ).execute()
            for it in pl_res.get("items", []):
                vid = it.get("contentDetails", {}).get("videoId")
                if vid:
                    video_ids.add(vid)
    except Exception as e:
        print(f"ℹ️ Aviso en youtube.channels: {e}")

    if video_ids:
        try:
            id_list = list(video_ids)[:50]
            v_res = youtube.videos().list(
                part="status,snippet",
                id=",".join(id_list)
            ).execute()
            for v in v_res.get("items", []):
                status = v.get("status", {})
                pub_at = status.get("publishAt")
                if pub_at:
                    dt_utc = datetime.fromisoformat(pub_at.replace("Z", "+00:00"))
                    dt_mad = dt_utc.astimezone(madrid_tz)
                    register_slot(dt_mad, occupied_slots, videos_per_day)
        except Exception as e:
            print(f"⚠️ Error al inspeccionar fechas de vídeos en YouTube: {e}")

    print(f"📊 Resumen de ocupación detectada por día: {videos_per_day}")
    print(f"🔒 Turnos exactos ocupados: {sorted(list(occupied_slots))}")

    # 3. Buscar desde hoy en adelante el primer hueco libre en [14:00, 18:00, 21:00]
    day_offset = 0
    while True:
        check_date = (now_madrid + timedelta(days=day_offset)).date()
        day_str = check_date.strftime("%Y-%m-%d")

        if videos_per_day.get(day_str, 0) < 3:
            for hr in target_hours:
                candidate = datetime(
                    check_date.year, check_date.month, check_date.day,
                    hr, 0, 0, tzinfo=madrid_tz
                )
                # Solo programar en turnos futuros (mínimo 10 min de margen respecto a la hora actual)
                if candidate <= now_madrid + timedelta(minutes=10):
                    continue

                slot_str = f"{day_str} {hr:02d}:00"
                if slot_str not in occupied_slots:
                    return candidate, gist_slots

        day_offset += 1

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    telegram_token = os.environ.get("TELEGRAM_TOKEN")
    telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    gist_id = os.environ.get("GIST_ID")
    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    
    video_path = sys.argv[1] if len(sys.argv) > 1 else "output.mp4"
    
    titulo_final = "Psicología Fascinante #shorts"
    descripcion_atractiva = "Explorando los secretos de la mente y la psicología humana. #shorts #psicología"
    
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

    # PASO 1: ENVIAR EL VÍDEO A TELEGRAM PRIMERO
    caption_telegram = f"🎬 ¡Short renderizado!\n📌 Título: {titulo_final}"
    send_telegram_video(video_path, caption_telegram, telegram_token, telegram_chat_id)

    # PASO 2: SUBIR Y PROGRAMAR EN YOUTUBE (3 TURNOS DIARIOS: 14:00, 18:00, 21:00)
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
        
        target_madrid, gist_slots = get_next_available_slot(youtube, madrid_tz, gist_id, gh_token)
        fecha_legible = target_madrid.strftime("%d/%m/%Y a las %H:%M")
        
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

        # Guardar el turno recién ocupado en el Gist para que la siguiente ejecución lo vea al instante
        gist_slots.append(target_madrid.isoformat())
        save_gist_schedule(gist_id, gh_token, gist_slots)

        success_msg = (
            f"✅ ¡Vídeo subido y programado en cola (3/día: 14h, 18h, 21h)!\n"
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
