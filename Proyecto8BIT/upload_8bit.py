import os
import json
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

MADRID_TZ = ZoneInfo("Europe/Madrid")
DAILY_SLOTS_HOURS = [14, 18, 21]
PAYLOAD_PATH = "payload.json"
VIDEO_PATH = "output.mp4"
HISTORIAL_PATH = os.path.join("Proyecto8BIT", "historial_8bit.json")


def get_authenticated_youtube():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID_8BIT")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET_8BIT")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN_8BIT")

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            "❌ Faltan secretos de YouTube: verifica YOUTUBE_CLIENT_ID_8BIT, "
            "YOUTUBE_CLIENT_SECRET_8BIT y YOUTUBE_REFRESH_TOKEN_8BIT en GitHub Secrets."
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
    )
    creds.refresh(Request())
    return build("youtube", "v3", credentials=creds)


def load_historial_slots():
    occupied = set()
    if not os.path.exists(HISTORIAL_PATH):
        return occupied
    try:
        with open(HISTORIAL_PATH, "r", encoding="utf-8") as f:
            hist = json.load(f)
            if isinstance(hist, list):
                for item in hist:
                    slot = item.get("programado_para_madrid")
                    if slot and isinstance(slot, str):
                        occupied.add(slot.strip())
    except Exception as e:
        print(f"⚠️ Aviso leyendo historial_8bit.json: {e}")
    return occupied


def fetch_youtube_scheduled_slots(youtube):
    occupied = set()
    try:
        ch_resp = youtube.channels().list(part="contentDetails", mine=True).execute()
        items = ch_resp.get("items", [])
        if not items:
            return occupied

        uploads_playlist_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        video_ids = []
        next_page_token = None

        for _ in range(3):
            pl_resp = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=50,
                pageToken=next_page_token
            ).execute()

            for item in pl_resp.get("items", []):
                video_ids.append(item["contentDetails"]["videoId"])

            next_page_token = pl_resp.get("nextPageToken")
            if not next_page_token:
                break

        for i in range(0, len(video_ids), 50):
            batch = video_ids[i:i + 50]
            vid_resp = youtube.videos().list(
                part="status,snippet",
                id=",".join(batch)
            ).execute()

            for vid in vid_resp.get("items", []):
                status = vid.get("status", {})
                publish_at_str = status.get("publishAt")
                if publish_at_str:
                    dt_utc = datetime.fromisoformat(publish_at_str.replace("Z", "+00:00"))
                    dt_madrid = dt_utc.astimezone(MADRID_TZ)

                    for slot_hour in DAILY_SLOTS_HOURS:
                        slot_candidate = dt_madrid.replace(
                            hour=slot_hour, minute=0, second=0, microsecond=0
                        )
                        diff_min = abs((dt_madrid - slot_candidate).total_seconds()) / 60.0
                        if diff_min <= 45:
                            slot_key = slot_candidate.strftime("%Y-%m-%d %H:00")
                            occupied.add(slot_key)
                            title_preview = vid.get("snippet", {}).get("title", "")[:35]
                            print(f"📌 Slot ocupado detectado en YouTube: {slot_key} ({title_preview})")
    except HttpError as e:
        print(f"⚠️ Aviso consultando vídeos programados en YouTube API: {e}")
    except Exception as e:
        print(f"⚠️ Error al inspeccionar slots en YouTube: {e}")

    return occupied


def get_next_available_slot(youtube):
    occupied_yt = fetch_youtube_scheduled_slots(youtube)
    occupied_hist = load_historial_slots()
    all_occupied = occupied_yt.union(occupied_hist)

    now_madrid = datetime.now(MADRID_TZ)
    min_valid_time = now_madrid + timedelta(minutes=15)

    for day_offset in range(90):
        target_date = (now_madrid + timedelta(days=day_offset)).date()
        for hour in DAILY_SLOTS_HOURS:
            candidate_madrid = datetime(
                year=target_date.year,
                month=target_date.month,
                day=target_date.day,
                hour=hour,
                minute=0,
                second=0,
                tzinfo=MADRID_TZ
            )

            if candidate_madrid <= min_valid_time:
                continue

            slot_key = candidate_madrid.strftime("%Y-%m-%d %H:00")
            if slot_key not in all_occupied:
                candidate_utc = candidate_madrid.astimezone(timezone.utc)
                publish_at_iso = candidate_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
                return slot_key, publish_at_iso

    raise RuntimeError("❌ No se encontraron slots disponibles en los próximos 90 días.")


def upload_to_youtube(payload):
    youtube = get_authenticated_youtube()
    slot_madrid_str, publish_at_iso = get_next_available_slot(youtube)

    raw_title = (
        payload.get("TituloYT")
        or payload.get("tema_titulo")
        or "Expediente Clasificado 👾 #Shorts"
    ).strip()

    if "#shorts" not in raw_title.lower():
        if len(raw_title) <= 91:
            raw_title = f"{raw_title} #Shorts"
        else:
            raw_title = raw_title[:91].rstrip() + " #Shorts"

    raw_desc = (
        payload.get("DescripcionYT")
        or f"{payload.get('tema_titulo', 'Caso real reconstruido en Archivo 8-Bit.')}\n\n#Shorts #Archivo8Bit #Hacking #Bugs #Gaming #Historia"
    ).strip()

    if "#shorts" not in raw_desc.lower():
        raw_desc += "\n\n#Shorts #Archivo8Bit #PixelArt"

    kw_list = payload.get("keywords_concepto")
    default_tags = ["Archivo 8-Bit", "Shorts", "Hacking", "Bugs", "Gaming", "PixelArt", "Historia", "Ciberseguridad"]
    if isinstance(kw_list, list) and len(kw_list) > 0:
        tags = list(dict.fromkeys([str(k) for k in kw_list if k] + default_tags))[:20]
    else:
        tags = default_tags

    print(f"🚀 Subiendo a YouTube: '{raw_title[:60]}'")
    print(f"🕒 Slot asignado: {slot_madrid_str} (Hora de España) -> UTC: {publish_at_iso}")

    body = {
        "snippet": {
            "title": raw_title[:100],
            "description": raw_desc[:4900],
            "tags": tags,
            "categoryId": "28",
            "defaultLanguage": "es",
            "defaultAudioLanguage": "es"
        },
        "status": {
            "privacyStatus": "private",
            "publishAt": publish_at_iso,
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload(
        VIDEO_PATH,
        mimetype="video/mp4",
        resumable=True,
        chunksize=1024 * 1024 * 5
    )

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"⬆️ Progreso subida YouTube: {int(status.progress() * 100)}%")

    video_id = response.get("id")
    print(f"✅ ¡Subido y programado en YouTube! ID: {video_id} | Slot: {slot_madrid_str}")
    return video_id, slot_madrid_str, raw_title


def send_telegram_notification(payload, video_id, slot_madrid_str, final_title):
    token = os.environ.get("TELEGRAM_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("⚠️ Variables TELEGRAM_TOKEN o TELEGRAM_CHAT_ID no definidas. Saltando envío a Telegram.")
        return

    music_idx = payload.get("music_track_index", 1)
    music_style = payload.get("music_style", "MYSTERY")
    subrama = payload.get("subrama", "Archivo 8-Bit")

    caption = (
        f"✅ *SHORT 8-BIT RENDERIZADO Y PROGRAMADO*\n\n"
        f"🎬 *Título:* {final_title}\n"
        f"🕹️ *Rama:* {subrama}\n"
        f"🎵 *Pista:* bg_music_{music_idx}.mp3 ({music_style})\n"
        f"📅 *Slot Madrid:* `{slot_madrid_str}`\n"
        f"🔗 *YouTube:* https://youtu.be/{video_id}"
    )

    url = f"https://api.telegram.org/bot{token}/sendVideo"
    try:
        with open(VIDEO_PATH, "rb") as video_file:
            resp = requests.post(
                url,
                data={
                    "chat_id": chat_id,
                    "caption": caption,
                    "parse_mode": "Markdown"
                },
                files={"video": video_file},
                timeout=120
            )
        if resp.status_code == 200:
            print("📲 Vídeo y confirmación enviados a Telegram correctamente.")
        else:
            print(f"⚠️ Respuesta de Telegram ({resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"⚠️ Error enviando vídeo a Telegram: {e}")


def main():
    if not os.path.exists(VIDEO_PATH):
        raise FileNotFoundError(f"❌ No existe el archivo renderizado '{VIDEO_PATH}'.")

    payload = {}
    if os.path.exists(PAYLOAD_PATH):
        with open(PAYLOAD_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
            if isinstance(raw, list) and len(raw) > 0:
                raw = raw[0]
            if isinstance(raw, dict) and "json" in raw:
                raw = raw["json"]
            payload = raw if isinstance(raw, dict) else {}

    video_id, slot_madrid_str, final_title = upload_to_youtube(payload)

    # Actualizamos payload.json para que el siguiente paso del workflow lo guarde en historial_8bit.json
    payload["programado_para_madrid"] = slot_madrid_str
    payload["youtube_video_id"] = video_id
    with open(PAYLOAD_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    send_telegram_notification(payload, video_id, slot_madrid_str, final_title)


if __name__ == "__main__":
    main()
