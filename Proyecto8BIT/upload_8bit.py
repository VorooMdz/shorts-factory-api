import os
import json
import requests
from datetime import datetime
from zoneinfo import ZoneInfo

def send_telegram_video(text, video_path="output.mp4"):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("⚠️ Advertencia: TELEGRAM_TOKEN o TELEGRAM_CHAT_ID no están configurados en los Secrets.")
        exit(1)

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
                res = requests.post(url_video, data=data, files=files, timeout=90)
                if res.ok:
                    print("📲 Vídeo 8-BIT MP4 enviado a Telegram correctamente.")
                    return
                else:
                    print(f"⚠️ Falló el adjunto con Markdown ({res.text}), reintentando en texto plano...")
                    vf.seek(0)
                    data.pop("parse_mode", None)
                    res2 = requests.post(url_video, data=data, files={"video": vf}, timeout=90)
                    if res2.ok:
                        print("📲 Vídeo 8-BIT MP4 enviado a Telegram sin formato Markdown.")
                        return
        except Exception as e:
            print(f"⚠️ Error al adjuntar vídeo a Telegram: {e}")

    url_msg = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url_msg, json={"chat_id": chat_id, "text": text}, timeout=15)
    except Exception as e:
        print(f"❌ Error al enviar mensaje a Telegram: {e}")

def main():
    payload_path = "payload.json"
    if not os.path.exists(payload_path):
        send_telegram_video("❌ Error en Proyecto8BIT: No se encontró payload.json tras el renderizado.")
        exit(1)

    with open(payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    title = payload.get("TituloYT", "Glitch en la Matrix 👾 #shorts")
    if "#shorts" not in title.lower():
        title = f"{title} #shorts"
    subrama = payload.get("subrama", "Glitches & Exploits")
    desc = payload.get("DescripcionYT", "Historias reales de fallos millonarios y exploits en 8-bit.")

    madrid_tz = ZoneInfo("Europe/Madrid")
    now_str = datetime.now(madrid_tz).strftime("%d/%m/%Y a las %H:%M")

    payload["programado_para_madrid"] = now_str
    with open(payload_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    caption = (
        f"👾 *¡NUEVO SHORT 8-BIT RENDERIZADO!*\n\n"
        f"📌 *Título:* {title}\n"
        f"🕹️ *Categoría:* {subrama}\n"
        f"📝 *Descripción:* {desc}\n"
        f"⏱️ *Generado el:* {now_str} (Hora Madrid)"
    )

    print("🚀 Enviando vídeo 8-BIT finalizado a Telegram...")
    send_telegram_video(caption, video_path="output.mp4")

if __name__ == "__main__":
    main()
