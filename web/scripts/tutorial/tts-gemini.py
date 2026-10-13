#!/usr/bin/env python3
"""Voz neural do Gemini para os tutoriais (13/10/26 — o edge-tts da Microsoft passou a dar 403).

uso: tts-gemini.py "<texto>" saida.mp3 [voz] [modelo]
  voz    padrão TUTORIAL_GEMINI_VOZ ou "Charon" (masculina, informativa); femininas: Kore, Aoede, Leda
  modelo padrão TUTORIAL_GEMINI_MODELO ou "gemini-2.5-pro-preview-tts"
Chave: GEMINI_API_KEY no ambiente, ou a do app WW (~/Projetos/waterworks-app/.env.local).
O Gemini devolve PCM 16 bits 24 kHz mono; o ffmpeg converte para mp3.
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error

ESTILO = ("Narre em português do Brasil, com voz natural, calma e clara, no ritmo de quem explica "
          "uma tela do sistema para um colega de trabalho. Leia exatamente o texto, sem acrescentar nada: ")


def chave() -> str:
    k = os.environ.get("GEMINI_API_KEY", "")
    if not k:
        for linha in open(os.path.expanduser("~/Projetos/waterworks-app/.env.local"), encoding="utf8"):
            if linha.startswith("GEMINI_API_KEY="):
                k = linha.split("=", 1)[1]
    return k.strip().strip('"').strip("'")


def falar(texto: str, saida: str, voz: str, modelo: str) -> None:
    corpo = json.dumps({
        "contents": [{"parts": [{"text": ESTILO + texto}]}],
        "generationConfig": {"responseModalities": ["AUDIO"],
                             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voz}}}},
    }).encode()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={chave()}"
    ultimo = None
    for tentativa in range(5):
        try:
            req = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                j = json.load(r)
            dados = base64.b64decode(j["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
            with tempfile.NamedTemporaryFile(suffix=".pcm", delete=False) as f:
                f.write(dados)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", f.name,
                            "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                            "-c:a", "libmp3lame", "-q:a", "2", saida], check=True)
            os.unlink(f.name)
            return
        except (urllib.error.HTTPError, urllib.error.URLError, KeyError, TimeoutError) as e:
            ultimo = e
            time.sleep(4 * (tentativa + 1))  # limite por minuto do preview: espera e tenta de novo
    raise SystemExit(f"Gemini TTS falhou: {ultimo}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    falar(sys.argv[1], sys.argv[2],
          sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TUTORIAL_GEMINI_VOZ", "Charon"),
          sys.argv[4] if len(sys.argv) > 4 else os.environ.get("TUTORIAL_GEMINI_MODELO", "gemini-2.5-pro-preview-tts"))
