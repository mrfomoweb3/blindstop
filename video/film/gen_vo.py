# Regenerate the narration: python3 gen_vo.py <voice-id>  (needs the heygen CLI, signed in)
import json, subprocess, sys, urllib.request, os
voice = sys.argv[1]
os.makedirs("assets/vo", exist_ok=True)
meta = []
for b in json.load(open("vo.json")):
    r = json.loads(subprocess.check_output(["heygen", "voice", "speech", "create", "--voice-id", voice, "--text", b["text"]]))["data"]
    mp3 = f"assets/vo/s{b['n']:02d}.mp3"
    urllib.request.urlretrieve(r["audio_url"], mp3)
        meta.append({"n": b["n"], "name": b["name"], "duration": r["duration"], "words": [w for w in r["word_timestamps"] if not w["word"].startswith("<")]})
    print(b["n"], b["name"], round(r["duration"], 2), flush=True)
json.dump(meta, open("vo_timing.json", "w"), indent=1)
print("total", round(sum(m["duration"] for m in meta), 1))
