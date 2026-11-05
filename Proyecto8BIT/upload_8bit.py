import os
import sys
import json
import urllib.request
import urllib.parse
import uuid

def send_video_to_telegram():
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID") or os.environ.get("CHAT_ID") or "326829409"

    if not bot_token:
        print("❌ ERROR: No se encontró TELEGRAM_BOT_TOKEN en las variables de entorno.")
        sys.exit(1)

    # Localizar output.mp4 y payload.json (en la raíz o dentro de Proyecto8BIT)
    video_path = "output.mp4" if os.path.exists("output.mp4") else "Proyecto8BIT/output.mp4"
    payload_path = "payload.json" if os.path.exists("payload.json") else "Proyecto8BIT/payload.json"

    if not os.path.exists(video_path):
        print(f"❌ ERROR: No existe el archivo de vídeo en {video_path}")
        sys.exit(1)

    file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
    print(f"📦 Tamaño de {video_path}: {file_size_mb:.2f} MB")

    titulo = "Short 8-Bit Generado"
    descripcion = ""
    subrama = "HISTORIA 8-BIT"

    if os.path.exists(payload_path):
        try:
            with open(payload_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    data = data[0]
                if isinstance(data, dict) and "json" in data:
                    data = data["json"]
                titulo = str(data.get("TituloYT") or data.get("tema_titulo") or titulo)
                descripcion = str(data.get("DescripcionYT") or "")
                subrama = str(data.get("subrama") or subrama)
        except Exception as e:
            print(f"⚠️ Aviso leyendo payload.json: {e}")

    # Limpiar símbolos que rompen el parser de Telegram y limitar a 950 caracteres (límite API = 1024)
    caption_raw = f"👾 {titulo}\n🕹️ Rama: {subrama}\n\n{descripcion}".strip()
    caption_clean = caption_raw[:950]

    url = f"https://api.telegram.org/bot{bot_token}/sendVideo"
    boundary = uuid.uuid4().hex

    def post_multipart(caption_text):
        body = bytearray()

        def add_field(name, value):
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
            body.extend(f"{value}\r\n".encode("utf-8"))

        add_field("chat_id", str(chat_id))
        add_field("caption", caption_text)
        add_field("supports_streaming", "true")

        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(b'Content-Disposition: form-data; name="video"; filename="short_8bit.mp4"\r\n')
        body.extend(b"Content-Type: video/mp4\r\n\r\n")
        with open(video_path, "rb") as vf:
            body.extend(vf.read())
        body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

        req = urllib.request.Request(url, data=bytes(body), method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="replace")
            return err.code, {"ok": False, "description": err_body}

    print(f"📤 Enviando vídeo a Telegram (chat_id={chat_id})...")
    status, result = post_multipart(caption_clean)

    # Si falla por cualquier motivo del texto, reintentar con caption mínimo
    if not result.get("ok"):
        print(f"⚠️ Primer intento rechazado ({status}): {result.get('description')}. Reintentando con texto corto...")
        status, result = post_multipart(f"👾 {titulo[:120]}")

    if result.get("ok"):
        msg_id = result.get("result", {}).get("message_id")
        print(f"✅ ¡Vídeo entregado en Telegram con éxito! (message_id: {msg_id})")
    else:
        print(f"❌ ERROR CRÍTICO de la API de Telegram ({status}): {result}")
        sys.exit(1)

if __name__ == "__main__":
    send_video_to_telegram()
