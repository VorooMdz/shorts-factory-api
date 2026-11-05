import os
import sys
import json
import argparse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

MADRID_TZ = ZoneInfo("Europe/Madrid")
DAILY_SLOTS_HOURS = [14, 18, 21]
SLOTS_CACHE_FILE = os.path.join(os.path.dirname(__file__), "scheduled_slots_8bit.json")


def get_authenticated_service():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID_8BIT")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET_8BIT")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN_8BIT")

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            "Faltan credenciales en las variables de entorno: "
            "YOUTUBE_CLIENT_ID_8BIT, YOUTUBE_CLIENT_SECRET_8BIT o YOUTUBE_REFRESH_TOKEN_8BIT."
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


def load_local_cached_slots():
    if not os.path.exists(SLOTS_CACHE_FILE):
        return set()
    try:
        with open(SLOTS_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return set(data.get("occupied_slots", []))
    except Exception as e:
        print(f"[WARN] No se pudo leer la caché local de slots: {e}")
        return set()


def save_local_cached_slot(slot_key, occupied_set):
    occupied_set.add(slot_key)
    # Limpiamos fechas pasadas para mantener ligero el fichero
    today_str = datetime.now(MADRID_TZ).strftime("%Y-%m-%d")
    filtered = sorted([s for s in occupied_set if s >= today_str])
    try:
        with open(SLOTS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"occupied_slots": filtered}, f, indent=2)
    except Exception as e:
        print(f"[WARN] No se pudo guardar la caché local de slots: {e}")


def fetch_youtube_scheduled_slots(youtube):
    """
    Consulta en tiempo real los vídeos subidos al canal que están en estado
    'private' con fecha 'publishAt' programada, y devuelve un conjunto de
    claves 'YYYY-MM-DD HH:00' en hora de Madrid.
    """
    occupied = set()
    try:
        ch_response = youtube.channels().list(
            part="contentDetails", mine=True
        ).execute()

        items = ch_response.get("items", [])
        if not items:
            return occupied

        uploads_playlist_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

        video_ids = []
        next_page_token = None
        # Inspeccionamos hasta los últimos 100 vídeos subidos al canal
        for _ in range(2):
            pl_response = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=50,
                pageToken=next_page_token
            ).execute()

            for item in pl_response.get("items", []):
                video_ids.append(item["contentDetails"]["videoId"])

            next_page_token = pl_response.get("nextPageToken")
            if not next_page_token:
                break

        # Consultamos el estado de programación en lotes de 50 IDs
        for i in range(0, len(video_ids), 50):
            batch_ids = video_ids[i:i + 50]
            vid_response = youtube.videos().list(
                part="status,snippet",
                id=",".join(batch_ids)
            ).execute()

            for vid in vid_response.get("items", []):
                status = vid.get("status", {})
                publish_at_str = status.get("publishAt")
                if publish_at_str:
                    # Ejemplo de formato: 2026-11-06T13:00:00Z
                    dt_utc = datetime.fromisoformat(publish_at_str.replace("Z", "+00:00"))
                    dt_madrid = dt_utc.astimezone(MADRID_TZ)

                    # Si el vídeo está programado cerca de las 14, 18 o 21h (±45 min),
                    # marcamos ese slot oficial como ocupado
                    for slot_hour in DAILY_SLOTS_HOURS:
                        slot_candidate = dt_madrid.replace(
                            hour=slot_hour, minute=0, second=0, microsecond=0
                        )
                        diff_minutes = abs((dt_madrid - slot_candidate).total_seconds()) / 60.0
                        if diff_minutes <= 45:
                            slot_key = slot_candidate.strftime("%Y-%m-%d %H:00")
                            occupied.add(slot_key)
                            print(f"[INFO] Slot detectado ocupado en YouTube: {slot_key} ({vid['snippet']['title'][:30]}...)")

    except HttpError as e:
        print(f"[WARN] No se pudo consultar la lista de vídeos en la API (verifica el scope youtube.readonly): {e}")
    except Exception as e:
        print(f"[WARN] Error al inspeccionar vídeos programados: {e}")

    return occupied


def get_next_available_slot(youtube):
    """
    Calcula el siguiente slot disponible a las 14:00, 18:00 o 21:00 (hora de Madrid).
    Deja un margen mínimo de 20 minutos respecto a la hora actual.
    """
    occupied_api = fetch_youtube_scheduled_slots(youtube)
    occupied_cache = load_local_cached_slots()
    all_occupied = occupied_api.union(occupied_cache)

    now_madrid = datetime.now(MADRID_TZ)
    min_valid_time = now_madrid + timedelta(minutes=20)

    # Buscamos hueco desde hoy hasta 60 días en adelante
    for day_offset in range(60):
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
                save_local_cached_slot(slot_key, all_occupied)
                candidate_utc = candidate_madrid.astimezone(timezone.utc)
                publish_at_iso = candidate_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
                return slot_key, publish_at_iso

    raise RuntimeError("No se encontraron slots libres en los próximos 60 días.")


def upload_scheduled_video(video_path, title, description, tags):
    youtube = get_authenticated_service()
    slot_madrid_str, publish_at_iso = get_next_available_slot(youtube)

    print(f"[INFO] Programando vídeo para el slot: {slot_madrid_str} (Hora Madrid) -> UTC: {publish_at_iso}")

    # Aseguramos que #Shorts esté presente
    clean_title = title.strip()
    if "#shorts" not in clean_title.lower():
        if len(clean_title) <= 91:
            clean_title = f"{clean_title} #Shorts"
        else:
            clean_title = clean_title[:91].rstrip() + " #Shorts"

    body = {
        "snippet": {
            "title": clean_title[:100],
            "description": description,
            "tags": tags,
            "categoryId": "28",  # Science & Technology / Gaming
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
        video_path,
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
            print(f"[UPLOAD] Subiendo: {int(status.progress() * 100)}%")

    video_id = response.get("id")
    print("=" * 60)
    print(f"¡VÍDEO SUBIDO Y PROGRAMADO CON ÉXITO!")
    print(f"ID de YouTube : {video_id}")
    print(f"Slot asignado : {slot_madrid_str} (Hora de España)")
    print(f"URL           : https://youtu.be/{video_id}")
    print("=" * 60)
    return video_id, slot_madrid_str


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Subida y programación automática por slots para Archivo 8-Bit")
    parser.add_argument("--video", required=True, help="Ruta al archivo MP4")
    parser.add_argument("--meta", required=False, help="Ruta al archivo JSON de metadatos o guion")
    parser.add_argument("--title", required=False, help="Título del vídeo (opcional si va en --meta)")
    parser.add_argument("--desc", required=False, help="Descripción del vídeo (opcional si va en --meta)")
    args = parser.parse_args()

    title = args.title or "Expediente Clasificado #Shorts"
    description = args.desc or "Nuevo caso real reconstruido en Archivo 8-Bit.\n\n#Shorts #Archivo8Bit #Hacking #Historia #Gaming"
    tags = ["Archivo 8-Bit", "Shorts", "Hacking", "Bugs", "Videojuegos", "PixelArt", "Ciberseguridad", "Curiosidades"]

    if args.meta and os.path.exists(args.meta):
        with open(args.meta, "r", encoding="utf-8") as f:
            meta_data = json.load(f)
            title = meta_data.get("title") or meta_data.get("youtube_title") or title
            description = meta_data.get("description") or meta_data.get("youtube_description") or description
            if "tags" in meta_data and isinstance(meta_data["tags"], list):
                tags = meta_data["tags"]

    upload_scheduled_video(args.video, title, description, tags)
