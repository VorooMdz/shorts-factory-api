import os
import sys
import json
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload_video():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    
    video_path = sys.argv[1] if len(sys.argv) > 1 else "output.mp4"
    
    # Valores por defecto de seguridad
    titulo_final = "Psicología Fascinante #shorts"
    descripcion_atractiva = "Explorando los secretos de la mente y la psicología humana. #shorts #psicología"
    
    print(f"🔍 Directorio de trabajo actual: {os.getcwd()}")
    
    if os.path.exists("payload.json"):
        print("✅ ¡Archivo payload.json encontrado en el disco!")
        try:
            with open("payload.json", "r", encoding="utf-8") as f:
                raw_text = f.read()
                print(f"📄 Longitud del texto en payload.json: {len(raw_text)} caracteres")
                print(f"📄 Primeros 200 caracteres del JSON: {raw_text[:200]}")
                
                raw_data = json.loads(raw_text)
                
                # Normalizar si n8n envía un array
                item = raw_data[0] if isinstance(raw_data, list) and len(raw_data) > 0 else raw_data
                if isinstance(item, dict) and "json" in item:
                    item = item["json"]
                
                parsed_data = None
                
                # Caso A: Los campos vienen directamente en la raíz
                if isinstance(item, dict) and ("TituloYT" in item or "tema_titulo" in item):
                    print("🎯 Detectados campos directamente en la raíz del JSON.")
                    parsed_data = item
                
                # Caso B: Vienen dentro de la estructura nativa de respuesta de Gemini
                elif isinstance(item, dict) and "candidates" in item:
                    print("🤖 Detectada estructura de respuesta de Gemini. Extrayendo texto interno...")
                    try:
                        text_content = item["candidates"][0]["content"]["parts"][0]["text"].strip()
                        
                        # Limpiar bloques de Markdown si los hay
                        if text_content.startswith("```"):
                            lines = text_content.splitlines()
                            if len(lines) > 2:
                                text_content = "\n".join(lines[1:-1]).strip()
                        
                        parsed_data = json.loads(text_content)
                        print("✨ JSON interno de Gemini parseado con éxito.")
                    except Exception as parse_err:
                        print(f"⚠️ Error al parsear el JSON interno de Gemini: {parse_err}")
                
                # Aplicar los textos extraídos
                if parsed_data:
                    if "TituloYT" in parsed_data and parsed_data["TituloYT"]:
                        titulo_final = parsed_data["TituloYT"]
                    elif "tema_titulo" in parsed_data and parsed_data["tema_titulo"]:
                        titulo_final = f"{parsed_data['tema_titulo']} #shorts"
                        
                    if "DescripcionYT" in parsed_data and parsed_data["DescripcionYT"]:
                        descripcion_atractiva = parsed_data["DescripcionYT"]
                else:
                    print("⚠️ No se pudo extraer parsed_data de ninguna de las formas previstas.")
                        
        except Exception as e:
            print(f"⚠️ Error crítico al leer o procesar payload.json: {e}")
    else:
        print("❌ ¡ALERTA: El archivo payload.json NO existe en esta ruta!")

    print(f"📌 TÍTULO FINAL QUE SE SUBIRÁ A YOUTUBE: --> {titulo_final} <--")
    print(f"📌 DESCRIPCIÓN FINAL: --> {descripcion_atractiva[:60]}... <--")

    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri="[https://oauth2.googleapis.com/token](https://oauth2.googleapis.com/token)"
    )
    
    youtube = build("youtube", "v3", credentials=credentials)
    
    # 🕒 Calcular las 18:00 UTC de programación automática
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
            "categoryId": "27" # Educación
        },
        "status": {
            "privacyStatus": "private",
            "publishAt": publish_at_str,
            "selfDeclaredMadeForKids": False
        }
    }
    
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
    
    print(f"🚀 Subiendo vídeo a YouTube...")
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
    print(f"✅ ¡Vídeo programado con éxito! ID: {video_id}")

if __name__ == "__main__":
    upload_video()
