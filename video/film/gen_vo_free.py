# Free, on-device narration (Kokoro via `npx hyperframes tts`): python3 gen_vo_free.py [voice] [speed]
import json, os, subprocess, sys
voice = sys.argv[1] if len(sys.argv) > 1 else "am_michael"
speed = sys.argv[2] if len(sys.argv) > 2 else "1.0"
os.makedirs("assets/vo", exist_ok=True)
meta = []
for b in json.load(open("vo.json")):
    out = f"assets/vo/s{b['n']:02d}.mp3"
    raw = out + ".raw.wav"
    subprocess.run(["npx", "hyperframes", "tts", b["text"], "-v", voice, "-s", speed, "-o", raw], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ar", "48000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", out], check=True)
    os.remove(raw)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]))
    meta.append({"n": b["n"], "name": b["name"], "duration": round(d, 3), "words": []})
    print(b["n"], b["name"], round(d, 2), flush=True)
json.dump(meta, open("vo_timing.json", "w"), indent=1)
print("total", round(sum(m["duration"] for m in meta), 1))
