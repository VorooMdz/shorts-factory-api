import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta
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
    # PASO 1: ENVIAR EL VÍDEO A TELEGRAM PRIMERO (Pase lo que pase con YouTube)
    # =========================================================================
    caption_telegram = f"🎬 ¡Short renderizado!\n📌 Título: {titulo_final}"
    send_telegram_video(video_path, caption_telegram, telegram_token, telegram_chat_id)

    # =========================================================================
    # PASO 2: INTENTAR LA SUBIDA Y PROGRAMACIÓN EN YOUTUBE
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
        
        now = datetime.now(timezone.utc)
        target_time = now.replace(hour=18, minute=0, second=0, microsecond=0)
        if now >= target_time:
            target_time = target_time + timedelta(days=1)
        
        publish_at_str = target_time.isoformat().replace("+00:00", "Z")
        
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
        
        print(f"🚀 Subiendo vídeo a YouTube y programándolo para: {publish_at_str}...")
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
        success_msg = f"✅ ¡Vídeo subido y programado con éxito en YouTube a las 18:00!\n🔗 https://youtu.be/{video_id}"
        print(success_msg)
        send_telegram_message(success_msg, telegram_token, telegram_chat_id)

    except Exception as yt_err:
        # Si YouTube falla (límite superado, token expirado, etc.), informamos pero no bloqueamos
        error_msg = f"⚠️ Aviso: El vídeo se ha guardado en Telegram, pero no se pudo subir automáticamente a YouTube.\n\nMotivo: {yt_err}\n\n💡 Súbelo a mano desde tu móvil o PC con el archivo que acabas de recibir."
        print(error_msg)
        send_telegram_message(error_msg, telegram_token, telegram_chat_id)
        # Salimos con código 0 para que el workflow no casque de forma abrupta
        sys.exit(0)

if __name__ == "__main__":
    upload_video()
