#!/usr/bin/env python3
"""Builds index.html and compositions/*.html from vo_timing.json (one narration clip per scene).

    python3 build.py

Scene lengths follow the voice: each scene lasts LEAD + its clip + TAIL, so a new voice
only needs gen_vo*.py and this script again. Scene markup and motion live below, one function each.
"""
import json, os

V = json.load(open("vo_timing.json"))
LEAD, TAIL = 0.35, 0.55
FIRST_LEAD, LAST_TAIL = 1.1, 3.2
dur, starts, t = {}, {}, 0.0
for i, v in enumerate(V):
    lead = FIRST_LEAD if i == 0 else LEAD
    tail = LAST_TAIL if i == len(V) - 1 else (TAIL + 2.6 if v["n"] == 8 else TAIL + 3.0 if v["n"] == 9 else TAIL)
    d = round(lead + v["duration"] + tail, 2)
    starts[v["n"]], dur[v["n"]] = round(t, 2), d
    v["lead"] = lead
    t += d
TOTAL = round(t, 2)

FONTS = """
@font-face { font-family: "Geist"; src: url("assets/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url("assets/fonts/geist-mono-latin.woff2") format("woff2"); font-weight: 100 900; }
"""
BASE = """
#root { position: absolute; inset: 0; overflow: hidden; font-family: "Geist", sans-serif; color: #f1f2ee; }
.app-ground { position: absolute; inset: 0; background: radial-gradient(1200px 700px at 50% 45%, #121411 0%, #090a09 70%); }
.shot { position: absolute; border-radius: 28px; border: 1px solid #2b2e29; box-shadow: 0 40px 80px rgba(0,0,0,.55); overflow: hidden; }
.shot img { display: block; width: 100%; height: auto; }
.kicker { position: absolute; font-size: 30px; font-weight: 500; color: #858980; letter-spacing: -0.01em; }
.line { position: absolute; font-weight: 300; font-size: 76px; letter-spacing: -0.03em; line-height: 1.05; }
.line .w { display: inline-block; }
.mono { font-family: "Geist Mono", monospace; }
.lime { color: #c6f432; }
.tag { position: absolute; font-size: 28px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 18px; border-radius: 999px; border: 1px solid #2b2e29; color: #858980; background: rgba(9,10,9,.8); }
"""


def words(text, cls=""):
    return " ".join(f'<span class="w {cls}">{w}</span>' for w in text.split(" "))


def scene(sid, n, body, script, extra_css=""):
    d = dur[n]
    return f"""<template>
  <style>{FONTS}{BASE}{extra_css}</style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
{body}
  </div>
  <script>
    const D = {d};
    const tl = gsap.timeline({{ paused: true }});
    const wordsIn = (sel, at, gap = 0.07) => tl.fromTo(sel, {{ opacity: 0, filter: "blur(6px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.2, stagger: gap, ease: "power2.out" }}, at);
{script}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""


def vo_word_time(n, word_index_fraction):
    """Approximate time (scene-local) at a fraction of the narration of scene n."""
    v = [x for x in V if x["n"] == n][0]
    return round(v["lead"] + v["duration"] * word_index_fraction, 2)


# ---------------------------------------------------------------- 1 · the note on the door
DOOR_CSS = """
.door { position: absolute; left: 50%; top: -40px; width: 1000px; height: 1160px; margin-left: -500px; background: #1f3a2e; border-radius: 6px; box-shadow: inset 0 0 0 18px #1a3227, 0 0 0 2000px #2a2622; }
.panel { position: absolute; background: #213f32; border-radius: 4px; box-shadow: inset 0 0 0 6px rgba(0,0,0,.22), inset 0 0 0 8px rgba(255,255,255,.04); }
.handle { position: absolute; right: 70px; top: 610px; width: 30px; height: 120px; border-radius: 16px; background: linear-gradient(90deg, #8f6e27, #d6b25a 50%, #8f6e27); }
.note { position: absolute; left: 50%; top: 300px; width: 640px; margin-left: -320px; padding: 54px 50px 60px; background: #f3ead2; color: #161616; box-shadow: 0 18px 30px rgba(0,0,0,.35); font-family: "Archivo Black", sans-serif; font-size: 60px; line-height: 1.08; letter-spacing: -0.01em; transform-origin: 50% 0%; }
.note small { display: block; font-family: "Geist", sans-serif; font-weight: 500; font-size: 28px; letter-spacing: 0.04em; color: #5d574b; margin-bottom: 18px; }
.tape { position: absolute; left: 50%; top: 278px; width: 220px; height: 56px; margin-left: -110px; background: rgba(255,255,240,.55); box-shadow: 0 2px 4px rgba(0,0,0,.1); }
.ul { position: absolute; left: 688px; top: 538px; width: 262px; height: 10px; background: #e2462f; border-radius: 6px; transform: rotate(-2.5deg); transform-origin: 0 50%; opacity: .85; }
.shadowhead { position: absolute; bottom: -120px; width: 520px; height: 640px; border-radius: 50% 50% 0 0; background: rgba(0,0,0,.42); filter: blur(18px); }
"""

DOOR_BODY = """
    <div id="{p}-door" class="door" data-layout-allow-overflow>
      <div class="panel" style="left:90px;top:90px;width:370px;height:420px"></div>
      <div class="panel" style="right:90px;top:90px;width:370px;height:420px"></div>
      <div class="panel" style="left:90px;top:600px;width:370px;height:470px"></div>
      <div class="panel" style="right:90px;top:600px;width:370px;height:470px"></div>
      <div class="handle"></div>
    </div>"""


def s01():
    body = DOOR_BODY.format(p="s1") + """
    <div id="s1-note" class="note" style="transform: rotate(-2.5deg)"><small>MY STOP-LOSS</small>IF BTC HITS $66,000, SELL EVERYTHING.</div>
    <div id="s1-tape" class="tape" style="transform: rotate(-4deg)"></div>
    <div id="s1-ul" class="ul"></div>
    <div id="s1-h1" class="shadowhead" data-layout-allow-overflow style="left:120px"></div>"""
    script = """
    tl.fromTo("#s1-door", { scale: 1.08 }, { scale: 1, duration: 1.2, ease: "expo.out" }, 0);
    tl.fromTo("#s1-note", { opacity: 0, scale: 1.25, rotation: -9, y: -40 }, { opacity: 1, scale: 1, rotation: -2.5, y: 0, duration: 0.45, ease: "expo.out" }, 0.25);
    tl.fromTo("#s1-tape", { opacity: 0, scaleX: 0.2 }, { opacity: 1, scaleX: 1, duration: 0.25, ease: "power3.out" }, 0.6);
    tl.to("#s1-note", { y: -6, duration: 0.12, ease: "power2.out" }, 0.71).to("#s1-note", { y: 0, duration: 0.25, ease: "power2.out" }, 0.83);
    tl.fromTo("#s1-ul", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, D * 0.5);
    tl.fromTo("#s1-h1", { x: -500, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: "expo.out" }, D - 2.2);
"""
    return scene("s01", 1, body, script, DOOR_CSS)


# ---------------------------------------------------------------- 2 · the crowd and the hunt
def s02():
    d = dur[2]
    notes = []
    # price ladder: other people's stops bunched just under 66,000
    import random
    rnd = random.Random(7)
    prices = [66000 + rnd.choice([-1, 1]) * rnd.randint(0, 9) * 40 for _ in range(22)]
    for i, p in enumerate(prices):
        x = 300 + (i % 11) * 120 + rnd.randint(-20, 20)
        y = 560 + (p - 66000) * -0.5 + (i // 11) * 70 + rnd.randint(-12, 12)
        r = rnd.uniform(-7, 7)
        notes.append(f'<div class="pnote" data-layout-allow-overlap id="s2-n{i}" style="left:{x}px;top:{y:.0f}px;transform:rotate({r:.1f}deg)"><span class="p">${p:,}</span><span class="sold">SOLD</span></div>')
    body = DOOR_BODY.format(p="s2") + """
    <div id="s2-note" class="note" style="transform: rotate(-2.5deg)"><small>MY STOP-LOSS</small>IF BTC HITS $66,000, SELL EVERYTHING.</div>
    <div class="tape" style="transform: rotate(-4deg)"></div>
    <div id="s2-h1" class="shadowhead" data-layout-allow-overflow style="left:120px"></div>
    <div id="s2-h2" class="shadowhead" data-layout-allow-overflow style="left:1290px;width:460px"></div>
    <div id="s2-h3" class="shadowhead" data-layout-allow-overflow style="left:700px;width:600px;bottom:-260px"></div>
    <div id="s2-board" class="board">
      <div class="axis"></div>
      <div class="ylab" style="top:180px">$70,000</div>
      <div class="ylab" style="top:540px">$66,000</div>
      <div class="ylab" style="top:880px">$62,000</div>
      """ + "\n      ".join(notes) + """
      <div id="s2-price" class="price"><span id="s2-pricetag" class="mono">BTC $68,400</span></div>
    </div>
    <div id="s2-cap1" class="line" style="left:120px;top:90px;color:#f1f2ee">""" + words("Everyone can read it.") + """</div>
    <div id="s2-cap2" class="line" style="left:120px;top:90px">""" + words("Stop hunting.") + """</div>"""
    css = DOOR_CSS + """
.board { position: absolute; inset: 0; background: #0f110e; }
.axis { position: absolute; left: 240px; top: 120px; bottom: 120px; width: 1px; background: #2b2e29; }
.ylab { position: absolute; left: 50px; font-family: "Geist Mono", monospace; font-size: 28px; color: #858980; }
.pnote { position: absolute; width: 160px; height: 64px; background: #f3ead2; color: #161616; font-family: "Archivo Black", sans-serif; font-size: 28px; display: grid; place-items: center; box-shadow: 0 8px 14px rgba(0,0,0,.35); }
.pnote .sold { position: absolute; inset: 0; display: grid; place-items: center; background: #ff6b5a; color: #0a0b08; opacity: 0; }
.price { position: absolute; left: 240px; right: 80px; top: 360px; height: 0; border-top: 4px solid #ff6b5a; }
.price span { position: absolute; right: 0; top: -54px; font-size: 30px; color: #ff6b5a; background: #0f110e; padding: 4px 10px; }
#s2-cap2 .w { color: #ff6b5a; }
"""
    t_board = vo_word_time(2, 0.28)
    t_push = vo_word_time(2, 0.62)
    t_cap2 = vo_word_time(2, 0.84)
    script = f"""
    tl.set("#s2-h1", {{ x: 0, opacity: 1 }}, 0);
    tl.fromTo("#s2-h2", {{ x: 500, opacity: 0 }}, {{ x: 0, opacity: 1, duration: 0.9, ease: "expo.out" }}, 1.4);
    tl.fromTo("#s2-h3", {{ y: 300, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.9, ease: "expo.out" }}, 2.2);
    wordsIn("#s2-cap1 .w", 1.0);
    tl.to("#s2-cap1", {{ opacity: 0, filter: "blur(8px)", duration: 0.2 }}, {t_board - 0.3});
    tl.fromTo("#s2-board", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.35, ease: "power2.inOut" }}, {t_board});
    tl.set(["#s2-note", "#s2-door", "#s2-h1", "#s2-h2", "#s2-h3"], {{ opacity: 0 }}, {t_board + 0.4});
    tl.fromTo("#s2-board .pnote", {{ opacity: 0, scale: 1.3 }}, {{ opacity: 1, scale: 1, duration: 0.3, stagger: 0.12, ease: "expo.out" }}, {t_board + 0.2});
    tl.fromTo("#s2-price", {{ y: -120 }}, {{ y: 0, duration: 1.4, ease: "power2.inOut" }}, {t_board + 0.4});
    tl.to("#s2-price", {{ y: 310, duration: 1.1, ease: "power3.in" }}, {t_push});
    tl.to("#s2-board .pnote .sold", {{ opacity: 1, duration: 0.08, stagger: 0.05 }}, {t_push + 0.75});
    tl.set("#s2-pricetag", {{ textContent: "BTC $65,600" }}, {t_push + 1.0});
    tl.to("#s2-price", {{ y: 40, duration: 1.3, ease: "expo.out" }}, {t_push + 1.6});
    tl.set("#s2-pricetag", {{ textContent: "BTC $67,900" }}, {t_push + 2.1});
    wordsIn("#s2-cap2 .w", {t_cap2}, 0.12);
"""
    return scene("s02", 2, body, script, css)


# ---------------------------------------------------------------- 3 · the envelope
def s03():
    body = DOOR_BODY.format(p="s3") + """
    <div id="s3-note" class="note" style="transform: rotate(-2.5deg)"><small>MY STOP-LOSS</small>IF BTC HITS $66,000, SELL EVERYTHING.</div>
    <div id="s3-flood" class="app-ground" style="opacity:0"></div>
    <div id="s3-env" class="env">
      <div class="flap"></div>
      <div id="s3-seal" class="seal"><svg viewBox="0 0 24 24" width="64" height="64"><path d="M4 12h16M9 12v6" stroke="#0a0b08" stroke-width="2.6" stroke-linecap="round"/></svg></div>
    </div>
    <div id="s3-name" class="brand">Blindstop</div>
    <div id="s3-sub" class="sub">""" + words("Your stop-loss never touches the public order book.") + """</div>
    <div id="s3-sub2" class="sub" style="top:990px;color:#f1f2ee">""" + words("Not other traders. Not us.") + """</div>"""
    css = DOOR_CSS + """
.env { position: absolute; left: 50%; top: 330px; width: 640px; height: 400px; margin-left: -320px; background: #efe5c9; border-radius: 10px; box-shadow: 0 30px 60px rgba(0,0,0,.45); opacity: 0; }
.flap { position: absolute; left: 0; right: 0; top: 0; height: 240px; background: #e5d9b8; clip-path: polygon(0 0, 100% 0, 50% 100%); }
.seal { position: absolute; left: 50%; top: 190px; width: 120px; height: 120px; margin-left: -60px; border-radius: 50%; background: #c6f432; display: grid; place-items: center; box-shadow: 0 6px 0 #9bc21f; }
.brand { position: absolute; left: 0; right: 0; top: 790px; text-align: center; font-size: 96px; font-weight: 400; letter-spacing: -0.04em; color: #f1f2ee; opacity: 0; }
.sub { position: absolute; left: 0; right: 0; top: 920px; text-align: center; font-size: 38px; font-weight: 300; color: #858980; }
"""
    script = """
    tl.to("#s3-note", { scaleY: 0.02, duration: 0.5, ease: "power3.in" }, 0.5);
    tl.to("#s3-note", { opacity: 0, duration: 0.1 }, 0.95);
    tl.fromTo("#s3-env", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, 0.9);
    tl.fromTo("#s3-seal", { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.4)" }, 1.5);
    tl.to("#s3-flood", { opacity: 1, duration: 0.45, ease: "power2.inOut" }, 2.1);
    tl.to("#s3-env", { y: -110, scale: 0.8, duration: 0.8, ease: "power2.inOut" }, 2.3);
    tl.fromTo("#s3-name", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25, ease: "power2.out" }, 2.6);
    tl.to("#s3-name", { y: -110, duration: 0.8, ease: "power2.inOut" }, 2.3);
    wordsIn("#s3-sub .w", 3.4);
    wordsIn("#s3-sub2 .w", D * 0.72, 0.1);
    tl.set(["#s3-sub", "#s3-sub2"], { y: -110 }, 0);
"""
    return scene("s03", 3, body, script, css)


# ---------------------------------------------------------------- generic: a real screen with a caption
def screen_scene(sid, n, img, w, x, y, kicker, cap, cap_at=0.4, extra_body="", extra_script="", extra_css="", tag=None):
    body = f"""
    <div class="app-ground"></div>
    <div id="{sid}-k" class="kicker" style="left:120px;top:96px">{kicker}</div>
    <div id="{sid}-cap" class="line" style="left:120px;top:150px;font-size:64px;max-width:1700px">{words(cap)}</div>
    <div id="{sid}-shot" class="shot" style="left:{x}px;top:{y}px;width:{w}px"><img src="assets/ui/{img}" alt=""></div>
    {f'<div id="{sid}-tag" class="tag" style="right:120px;top:100px">{tag}</div>' if tag else ''}
{extra_body}"""
    script = f"""
    tl.fromTo("#{sid}-k", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, 0.1);
    wordsIn("#{sid}-cap .w", {cap_at});
    tl.fromTo("#{sid}-shot", {{ opacity: 0, y: 60, scale: 1.04 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out" }}, 0.3);
    {f'tl.fromTo("#{sid}-tag", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, 0.8);' if tag else ''}
{extra_script}"""
    return scene(sid, n, body, script, extra_css)


CURSOR = '<svg id="{id}" class="cursor" viewBox="0 0 24 24" width="44" height="44" style="position:absolute;left:{x}px;top:{y}px" data-layout-ignore><path d="M3 2l7 19 2.5-8 8-2.5z" fill="#f1f2ee" stroke="#090a09" stroke-width="1.4" stroke-linejoin="round"/></svg>'


def s04():
    steps = ["Sign in with a NEAR wallet", "A trading wallet, made in your browser", "Add funds", "Turn on protection"]
    items = "".join(f'<div class="st" id="s4-st{i}"><span class="num">{i+1}</span>{s}<span class="tick" id="s4-tk{i}">✓</span></div>' for i, s in enumerate(steps))
    css = """
.steps { position: absolute; left: 1100px; top: 330px; width: 700px; display: grid; gap: 18px; }
.st { position: relative; height: 96px; border-radius: 22px; border: 1px solid #2b2e29; background: #121411; display: flex; align-items: center; gap: 22px; padding: 0 28px; font-size: 32px; color: #f1f2ee; }
.num { width: 48px; height: 48px; border-radius: 50%; border: 1.5px solid #858980; display: grid; place-items: center; font-size: 28px; color: #858980; }
.tick { margin-left: auto; width: 44px; height: 44px; border-radius: 50%; background: #c6f432; color: #0a0b08; display: grid; place-items: center; font-size: 24px; opacity: 0; }
"""
    script = ""
    for i in range(4):
        at = vo_word_time(4, 0.15 + i * 0.22)
        script += f'    tl.fromTo("#s4-st{i}", {{ opacity: 0, x: 40 }}, {{ opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }}, {at});\n'
        script += f'    tl.fromTo("#s4-tk{i}", {{ opacity: 0, scale: 0.4 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.4)" }}, {at + 0.45});\n'
    return screen_scene("s04", 4, "signin-steps.png", 900, 120, 330, "How it works for you", "Four steps, about a minute.", extra_body=f'    <div class="steps">{items}</div>', extra_script=script, extra_css=css)


def s05():
    cur = CURSOR.format(id="s5-cur", x=1500, y=1000)
    script = f"""
    tl.fromTo("#s5-b", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.25 }}, {vo_word_time(5, 0.45)});
    tl.fromTo("#s5-cur", {{ x: 0, y: 0, opacity: 0 }}, {{ x: -1180, y: -150, opacity: 1, duration: 0.9, ease: "power2.inOut" }}, {vo_word_time(5, 0.62)});
    tl.to("#s5-cur", {{ scale: 0.85, duration: 0.08, yoyo: true, repeat: 1 }}, {vo_word_time(5, 0.62) + 0.95});
    tl.fromTo("#s5-ok", {{ opacity: 0, y: 20 }}, {{ opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }}, {vo_word_time(5, 0.62) + 1.2});
"""
    body = f"""
    <div id="s5-b" class="shot" style="left:160px;top:330px;width:1600px;opacity:0;border:none;box-shadow:none"><img src="assets/ui/trade-b.png" alt=""></div>
    {cur}
    <div id="s5-ok" class="note-ok" style="left:160px;top:930px">Opened a long of 0.0044 BTC. Now hide its stop-loss.</div>
    <div class="tag" style="left:120px;top:1000px;opacity:.9">Sample numbers · testnet</div>"""
    css = ".note-ok { position: absolute; font-size: 28px; color: #7fdc6a; padding: 14px 22px; border-radius: 14px; background: rgba(127,220,106,.08); border: 1px solid rgba(127,220,106,.3); }"
    return screen_scene("s05", 5, "trade-a.png", 1600, 160, 330, "Open a trade", "Pick a coin, a direction, an amount and leverage.", extra_body=body, extra_script=script, extra_css=css)


def s06():
    t_type = vo_word_time(6, 0.08)
    t_click = vo_word_time(6, 0.27)
    t_lock = vo_word_time(6, 0.40)
    t_near = vo_word_time(6, 0.72)
    hexs = "9f 3a c1 07 e4 52 b8 1d 6e a0 f3 28 4c 91 d7 0b 35 ee 7a c4 19 86 2f d0 5b a9 63 0e f8 47 bc 12 " * 3
    body = f"""
    <div id="s6-b" class="shot" style="left:120px;top:250px;width:900px;opacity:0;border:none;box-shadow:none"><img src="assets/ui/pos-b.png" alt=""></div>
    {CURSOR.format(id="s6-cur", x=700, y=1000)}
    <div id="s6-chips">
      <div id="s6-c1" class="chip mono">66000</div>
      <div id="s6-c2" class="chip mono">72000</div>
    </div>
    <div id="s6-env" class="env2"><div class="flap2"></div><div class="seal2"></div></div>
    <div id="s6-lock" class="kicker" style="left:1180px;top:760px;color:#f1f2ee">Locked in your browser. Only the sealed computer can open it.</div>
    <div id="s6-near" class="nearbox">
      <div class="kicker" style="position:static;margin-bottom:16px">What NEAR stores</div>
      <div class="mono hex" data-layout-ignore>{hexs}</div>
      <div class="kicker" style="position:static;margin-top:16px;color:#f1f2ee">316 bytes. Same size, whatever is inside.</div>
    </div>"""
    css = """
.chip { position: absolute; left: 0; top: 0; padding: 10px 18px; border-radius: 12px; background: #c6f432; color: #0a0b08; font-size: 34px; opacity: 0; }
.env2 { position: absolute; left: 1280px; top: 380px; width: 420px; height: 270px; background: #efe5c9; border-radius: 10px; box-shadow: 0 30px 60px rgba(0,0,0,.45); opacity: 0; }
.flap2 { position: absolute; left: 0; right: 0; top: 0; height: 160px; background: #e5d9b8; clip-path: polygon(0 0, 100% 0, 50% 100%); transform-origin: 50% 0; }
.seal2 { position: absolute; left: 50%; top: 125px; width: 76px; height: 76px; margin-left: -38px; border-radius: 50%; background: #c6f432; box-shadow: 0 4px 0 #9bc21f; }
.nearbox { position: absolute; left: 1100px; top: 330px; width: 700px; padding: 34px; border-radius: 28px; border: 1px solid #2b2e29; background: #121411; opacity: 0; }
.hex { font-size: 28px; line-height: 1.5; color: #858980; word-break: break-all; height: 216px; overflow: hidden; }
"""
    script = f"""
    tl.fromTo("#s6-b", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.25 }}, {t_type});
    tl.fromTo("#s6-cur", {{ x: 0, y: 0, opacity: 0 }}, {{ x: -480, y: -110, opacity: 1, duration: 0.8, ease: "power2.inOut" }}, {t_click - 0.9});
    tl.to("#s6-cur", {{ scale: 0.85, duration: 0.08, yoyo: true, repeat: 1 }}, {t_click});
    tl.to("#s6-cur", {{ opacity: 0, duration: 0.2 }}, {t_click + 0.4});
    tl.fromTo("#s6-c1", {{ x: 260, y: 650, opacity: 0 }}, {{ opacity: 1, duration: 0.15 }}, {t_click + 0.15});
    tl.fromTo("#s6-c2", {{ x: 700, y: 650, opacity: 0 }}, {{ opacity: 1, duration: 0.15 }}, {t_click + 0.2});
    tl.fromTo("#s6-env", {{ opacity: 0, scale: 0.9 }}, {{ opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }}, {t_click + 0.1});
    tl.to("#s6-c1", {{ x: 1420, y: 470, scale: 0.6, duration: 0.7, ease: "power3.in" }}, {t_click + 0.5});
    tl.to("#s6-c2", {{ x: 1440, y: 480, scale: 0.6, duration: 0.7, ease: "power3.in" }}, {t_click + 0.62});
    tl.to("#s6-chips .chip", {{ opacity: 0, duration: 0.08 }}, {t_click + 1.3});
    tl.fromTo("#s6-env .flap2", {{ scaleY: -1 }}, {{ scaleY: 1, duration: 0.35, ease: "power3.out" }}, {t_click + 1.3});
    tl.fromTo("#s6-lock", {{ opacity: 0, filter: "blur(6px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.25 }}, {t_lock});
    tl.to(["#s6-env", "#s6-lock"], {{ opacity: 0, y: -40, duration: 0.3, ease: "power3.in" }}, {t_near - 0.35});
    tl.fromTo("#s6-near", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }}, {t_near});
"""
    return screen_scene("s06", 6, "pos-a.png", 900, 120, 250, "Hide the stop", "Type your levels. Press “Hide my stop”.", extra_body=body, extra_script=script, extra_css=css, tag="Sample numbers · testnet")


def s07():
    body = """
    <div id="s7-api" class="term">
      <div class="kicker" style="position:static;margin-bottom:20px">Hyperliquid's public list of your orders</div>
      <div class="mono" style="font-size:30px;color:#858980">POST /info {"type":"frontendOpenOrders", "user": you}</div>
      <div id="s7-ans" class="mono" style="font-size:96px;margin-top:26px;color:#c6f432">[ ]</div>
    </div>"""
    css = ".term { position: absolute; left: 120px; top: 640px; width: 1680px; padding: 40px; border-radius: 28px; border: 1px solid #2b2e29; background: #121411; }"
    script = f"""
    tl.fromTo("#s7-api", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }}, 0.9);
    tl.fromTo("#s7-ans", {{ opacity: 0, scale: 1.4 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: "expo.out" }}, {vo_word_time(7, 0.45)});
"""
    return screen_scene("s07", 7, "stats.png", 1680, 120, 330, "Now look", "Empty. Nothing for anyone to aim at.", cap_at=vo_word_time(7, 0.45), extra_body=body, extra_script=script, extra_css=css)


def s08():
    t = lambda f: vo_word_time(8, f)
    body = """
    <div class="app-ground"></div>
    <div id="s8-cap" class="line" style="left:120px;top:90px;font-size:64px">""" + words("Who watches the price?") + """</div>
    <div id="s8-enc" class="box enc"><div class="key"></div><div class="lbl">Sealed computer</div><div class="sm">secure enclave · NEAR OutLayer</div></div>
    <div id="s8-n1" class="box src" style="left:120px;top:380px"><div class="lbl">NEAR · source 1</div><div class="sm mono">block 277,529,492</div></div>
    <div id="s8-n2" class="box src" style="left:120px;top:640px"><div class="lbl">NEAR · source 2</div><div class="sm mono">block 277,529,492</div></div>
    <div id="s8-agree" class="agree">must agree ✓</div>
    <div id="s8-hl" class="box src" style="left:1400px;top:510px"><div class="lbl">Hyperliquid price</div><div id="s8-px" class="sm mono" style="font-size:44px;color:#f1f2ee">$68,319</div></div>
    <div id="s8-a1" class="arrow" style="left:520px;top:600px;width:330px"></div>
    <div id="s8-a2" class="arrow rev" style="left:1070px;top:600px;width:330px"></div>
    <div id="s8-tick" class="tickc mono">checks every 3 s</div>
    <div id="s8-blind" class="kicker" style="left:120px;top:960px;color:#f1f2ee">Even the people running it can’t see inside.</div>
    <div id="s8-live" class="shot" style="left:210px;top:300px;width:1500px;opacity:0"><img src="assets/ui/status-card.png" alt=""></div>
    <div id="s8-livetag" class="tag" style="left:210px;top:220px;opacity:0;color:#7fdc6a;border-color:rgba(127,220,106,.4)">Real · the live Status page</div>"""
    css = """
.box { position: absolute; border-radius: 26px; border: 1px solid #2b2e29; background: #121411; padding: 30px 34px; }
.box .lbl { font-size: 34px; font-weight: 500; }
.box .sm { font-size: 28px; color: #858980; margin-top: 10px; }
.src { width: 400px; height: 180px; }
.enc { left: 790px; top: 400px; width: 340px; height: 400px; padding: 0; display: grid; place-items: center; align-content: center; gap: 10px; text-align: center; background: #0c0d0b; border-color: #c6f432; }
.enc .lbl { font-size: 30px; margin-top: 16px; } .enc .sm { font-size: 28px; padding: 0 14px; }
.key { width: 36px; height: 60px; position: relative; } .key::before { content: ""; position: absolute; left: 0; top: 0; width: 36px; height: 36px; border-radius: 50%; background: #c6f432; } .key::after { content: ""; position: absolute; left: 12px; top: 26px; width: 12px; height: 34px; background: #c6f432; border-radius: 3px; }
.agree { position: absolute; left: 140px; top: 572px; font-size: 28px; color: #7fdc6a; }
.arrow { position: absolute; height: 3px; background: #2b2e29; transform-origin: 0 50%; }
.arrow::after { content: ""; position: absolute; right: -2px; top: -8px; border-left: 16px solid #2b2e29; border-top: 9px solid transparent; border-bottom: 9px solid transparent; }
.arrow.rev { transform-origin: 100% 50%; } .arrow.rev::after { right: auto; left: -2px; border-left: none; border-right: 16px solid #2b2e29; }
.tickc { position: absolute; left: 790px; top: 830px; width: 340px; text-align: center; font-size: 28px; color: #c6f432; }
"""
    script = f"""
    wordsIn("#s8-cap .w", 0.2);
    tl.fromTo("#s8-enc", {{ opacity: 0, scale: 0.9 }}, {{ opacity: 1, scale: 1, duration: 0.6, ease: "expo.out" }}, {t(0.12)});
    tl.fromTo("#s8-n1", {{ opacity: 0, x: -40 }}, {{ opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }}, {t(0.30)});
    tl.fromTo("#s8-n2", {{ opacity: 0, x: -40 }}, {{ opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }}, {t(0.36)});
    tl.fromTo("#s8-agree", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(0.44)});
    tl.fromTo("#s8-a1", {{ scaleX: 0 }}, {{ scaleX: 1, duration: 0.5, ease: "power2.inOut" }}, {t(0.46)});
    tl.fromTo("#s8-hl", {{ opacity: 0, x: 40 }}, {{ opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }}, {t(0.60)});
    tl.fromTo("#s8-a2", {{ scaleX: 0 }}, {{ scaleX: 1, duration: 0.5, ease: "power2.inOut" }}, {t(0.64)});
    tl.fromTo("#s8-tick", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(0.66)});
    tl.set("#s8-px", {{ textContent: "$68,302" }}, {t(0.70)});
    tl.set("#s8-px", {{ textContent: "$68,288" }}, {t(0.70) + 3});
    tl.set("#s8-px", {{ textContent: "$68,296" }}, {t(0.70) + 6});
    tl.fromTo("#s8-blind", {{ opacity: 0, filter: "blur(6px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.25 }}, {t(0.84)});
    tl.to(["#s8-enc", "#s8-n1", "#s8-n2", "#s8-agree", "#s8-hl", "#s8-a1", "#s8-a2", "#s8-tick"], {{ opacity: 0, filter: "blur(8px)", duration: 0.25 }}, {t(1.0) - 0.4});
    tl.fromTo("#s8-live", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }}, {t(1.0) - 0.2});
    tl.fromTo("#s8-livetag", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(1.0)});
"""
    return scene("s08", 8, body, script, css)


def s09():
    t = lambda f: vo_word_time(9, f)
    harness = [
        "ok - long BTC stop at 70000 with mark 75191: no order sent; signed heartbeat",
        "ok - mark 69999 crosses 70000: reduce-only IOC sell 0.01 @ 69299 signed by the agent; filled report verifies",
        "ok - next tick re-emits the identical report and sends nothing",
        "ok - after settlement the order is gone from get_active; nothing to do",
        "14 scenarios against blindstop-room.wasm",
        "HARNESS PASSED",
    ]
    hl = "".join(f'<div class="hl" id="s9-h{i}">{h}</div>' for i, h in enumerate(harness))
    body = f"""
    <div class="app-ground"></div>
    <div id="s9-chart" class="chart">
      <div class="lvl" style="top:430px"><span class="mono">your hidden stop · 66,000</span></div>
      <svg width="1680" height="600" data-layout-ignore viewBox="0 0 1680 600"><path id="s9-path" d="M0 160 C 200 140, 300 220, 460 200 S 760 260, 900 300 S 1150 380, 1260 440 L 1300 470" fill="none" stroke="#f1f2ee" stroke-width="4" stroke-dasharray="1700" stroke-dashoffset="1700"/></svg>
    </div>
    <div id="s9-steps" class="flow">
      <div class="fs" id="s9-f1">Price crosses</div><div class="fa">→</div>
      <div class="fs" id="s9-f2">Enclave closes the position</div><div class="fa">→</div>
      <div class="fs" id="s9-f3">Signs a receipt</div><div class="fa">→</div>
      <div class="fs lime" id="s9-f4">NEAR checks the signature ✓</div>
    </div>
    <div id="s9-real" class="card9">
      <div class="tag" style="position:static;display:inline-block;color:#7fdc6a;border-color:rgba(127,220,106,.4)">Real · NEAR testnet</div>
      <div style="font-size:40px;margin-top:22px">Order 6: sealed in a browser, opened by the real enclave, settled on NEAR.</div>
      <div class="mono" style="font-size:28px;color:#858980;margin-top:16px">tx AjQgGT7C6aQmDTJCGKpYBnkU1FytQRR5HAj79WGTTDTH</div>
    </div>
    <div id="s9-sim" class="card9">
      <div class="tag" style="position:static;display:inline-block;color:#f0b545;border-color:rgba(240,181,69,.45)">Simulation · the real enclave program, test exchange</div>
      <div class="mono term9">{hl}</div>
    </div>"""
    css = """
.chart { position: absolute; left: 120px; top: 160px; width: 1680px; height: 600px; }
.lvl { position: absolute; left: 0; right: 0; height: 0; border-top: 3px dashed #c6f432; }
.lvl span { position: absolute; right: 0; top: -46px; font-size: 30px; color: #c6f432; }
.flow { position: absolute; left: 120px; top: 850px; display: flex; gap: 22px; align-items: center; font-size: 32px; }
.fs { padding: 16px 24px; border-radius: 18px; border: 1px solid #2b2e29; background: #121411; }
.fa { color: #858980; }
.card9 { position: absolute; left: 120px; top: 240px; width: 1680px; padding: 44px; border-radius: 28px; border: 1px solid #2b2e29; background: #121411; }
.term9 { margin-top: 26px; font-size: 28px; line-height: 1.7; color: #b9bdb4; }
.term9 .hl:nth-child(n+5) { color: #7fdc6a; }
"""
    script = f"""
    tl.to("#s9-path", {{ strokeDashoffset: 0, duration: {t(0.12)}, ease: "none" }}, 0.2);
    tl.fromTo("#s9-f1", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(0.10)});
    tl.fromTo("#s9-f2", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(0.17)});
    tl.fromTo("#s9-f3", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3 }}, {t(0.24)});
    tl.fromTo("#s9-f4", {{ opacity: 0, scale: 1.2 }}, {{ opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.4)" }}, {t(0.33)});
    tl.fromTo("#s9-steps .fa", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.3, stagger: 0.4 }}, {t(0.12)});
    tl.to(["#s9-chart", "#s9-steps"], {{ opacity: 0, filter: "blur(8px)", duration: 0.25 }}, {t(0.44)});
    tl.fromTo("#s9-real", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }}, {t(0.46)});
    tl.to("#s9-real", {{ opacity: 0, filter: "blur(8px)", duration: 0.25 }}, {t(0.72)});
    tl.fromTo("#s9-sim", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }}, {t(0.74)});
    tl.fromTo("#s9-sim .hl", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.1, stagger: 0.45 }}, {t(0.74) + 0.4});
"""
    return scene("s09", 9, body, script, css)


def s10():
    t = lambda f: vo_word_time(10, f)
    body = """
    <div class="app-ground"></div>
    <div id="s10-cap" class="line" style="left:120px;top:90px;font-size:64px">""" + words("A safety net, just in case.") + """</div>
    <div class="ax"></div>
    <div id="s10-entry" class="mk" style="top:300px"><span>entry 68,046</span></div>
    <div id="s10-stop" class="mk hid" style="top:470px"><span>your hidden stop · 66,000 · nobody sees it</span></div>
    <div id="s10-net" class="mk net" style="top:760px"><span>safety net · 47,900 · public, far away</span></div>
    <div id="s10-liq" class="mk liq" style="top:840px"><span>liquidation · 46,952</span></div>"""
    css = """
.ax { position: absolute; left: 320px; top: 240px; height: 700px; width: 2px; background: #2b2e29; }
.mk { position: absolute; left: 320px; width: 1300px; border-top: 3px solid #858980; }
.mk span { position: absolute; left: 30px; top: -46px; font-size: 32px; color: #858980; }
.hid { border-top: 3px dashed #c6f432; } .hid span { color: #c6f432; }
.net { border-top-color: #f1f2ee; } .net span { color: #f1f2ee; }
.liq { border-top-color: #f0b545; } .liq span { color: #f0b545; }
"""
    script = f"""
    wordsIn("#s10-cap .w", 0.2);
    tl.fromTo("#s10-entry", {{ opacity: 0, scaleX: 0 }}, {{ opacity: 1, scaleX: 1, duration: 0.6, ease: "expo.out", transformOrigin: "0 50%" }}, 0.5);
    tl.fromTo("#s10-stop", {{ opacity: 0, scaleX: 0 }}, {{ opacity: 1, scaleX: 1, duration: 0.6, ease: "expo.out", transformOrigin: "0 50%" }}, 0.8);
    tl.fromTo("#s10-liq", {{ opacity: 0, scaleX: 0 }}, {{ opacity: 1, scaleX: 1, duration: 0.6, ease: "expo.out", transformOrigin: "0 50%" }}, {t(0.45)});
    tl.fromTo("#s10-net", {{ opacity: 0, scaleX: 0 }}, {{ opacity: 1, scaleX: 1, duration: 0.6, ease: "expo.out", transformOrigin: "0 50%" }}, {t(0.55)});
"""
    return scene("s10", 10, body, script, css)


def s11():
    body = '    <div id="s11-l" class="kicker" style="left:210px;top:860px;color:#f1f2ee;font-size:34px">' + words("Checked in your browser, against what NEAR stored the moment it was set.") + '</div>'
    return screen_scene("s11", 11, "genuine-card.png", 1500, 210, 380, "Check a stop", "Anyone can check it matches what NEAR stored.", extra_body=body, extra_script=f'    wordsIn("#s11-l .w", {vo_word_time(11, 0.55)}, 0.06);\n', tag="Real · stop 6 on testnet")


def s12():
    attacks = ["Forged receipt", "Receipt for the wrong order", "Replayed receipt", "Keeper feeding fake prices", "NEAR sources disagree",
               "Someone else’s envelope, replayed", "Order naming another person’s wallet", "Cancelling someone else’s stop", "Revealing with the wrong contents"]
    rows = "".join(f'<div class="ar" id="s12-r{i}"><span class="an">{a}</span><span class="ref">refused</span></div>' for i, a in enumerate(attacks))
    body = f"""
    <div class="app-ground"></div>
    <div id="s12-cap" class="line" style="left:120px;top:90px;font-size:64px">{words("We attacked it ourselves.")}</div>
    <div class="tag" style="right:120px;top:104px;color:#7fdc6a;border-color:rgba(127,220,106,.4)">Real · run against testnet</div>
    <div class="grid12">{rows}</div>
    <div id="s12-only" class="line" style="left:120px;top:900px;font-size:52px">{words("It can only close positions. It can’t move your money.")}</div>"""
    css = """
.grid12 { position: absolute; left: 120px; top: 240px; width: 1680px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 40px; }
.ar { display: flex; justify-content: space-between; align-items: center; padding: 18px 26px; border-radius: 16px; border: 1px solid #2b2e29; background: #121411; font-size: 30px; }
.ref { font-family: "Geist Mono", monospace; font-size: 28px; color: #0a0b08; background: #7fdc6a; padding: 4px 12px; border-radius: 8px; }
"""
    t0 = vo_word_time(12, 0.08)
    script = f"""
    wordsIn("#s12-cap .w", 0.2);
    tl.fromTo(".ar", {{ opacity: 0, y: 16 }}, {{ opacity: 1, y: 0, duration: 0.35, stagger: 0.32, ease: "expo.out" }}, {t0});
    tl.fromTo(".ref", {{ opacity: 0, scale: 1.5 }}, {{ opacity: 1, scale: 1, duration: 0.25, stagger: 0.32, ease: "back.out(1.4)" }}, {t0 + 0.25});
    wordsIn("#s12-only .w", {vo_word_time(12, 0.62)});
"""
    return scene("s12", 12, body, script, css)


def s13():
    body = """
    <div class="app-ground"></div>
    <div id="s13-a" class="line" style="left:120px;top:380px;font-size:120px;font-weight:300">""" + words("Your stops, hidden") + """</div>
    <div id="s13-b" class="line" style="left:120px;top:520px;font-size:120px;font-weight:300">""" + words("until the moment") + " " + words("they fire.", "lime") + """</div>"""
    script = """
    wordsIn("#s13-a .w", 0.35, 0.09);
    wordsIn("#s13-b .w", 1.3, 0.09);
"""
    return scene("s13", 13, body, script)


def s14():
    body = """
    <div class="app-ground"></div>
    <div id="s14-logo" class="logo"><div class="mark"><svg viewBox="0 0 24 24" width="76" height="76"><path d="M4 12h16M9 12v6" stroke="#0a0b08" stroke-width="2.6" stroke-linecap="round"/></svg></div><span>Blindstop</span></div>
    <div id="s14-l1" class="end" style="top:600px">Hidden stop-losses for Hyperliquid, built on NEAR.</div>
    <div id="s14-l2" class="end mono" style="top:680px;color:#c6f432;font-size:34px">github.com/mrfomoweb3/blindstop</div>
    <div id="s14-l3" class="end" style="top:760px;font-size:30px">Open source · MIT · try it on testnet</div>"""
    css = """
.logo { position: absolute; left: 0; right: 0; top: 380px; display: flex; justify-content: center; align-items: center; gap: 30px; font-size: 110px; letter-spacing: -0.04em; }
.mark { width: 130px; height: 130px; border-radius: 32px; background: #c6f432; display: grid; place-items: center; }
.end { position: absolute; left: 0; right: 0; text-align: center; font-size: 40px; font-weight: 300; color: #858980; }
"""
    script = """
    tl.fromTo("#s14-logo", { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.3, ease: "power2.out" }, 0.2);
    tl.fromTo("#s14-l1", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.8);
    tl.fromTo("#s14-l2", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1.4);
    tl.fromTo("#s14-l3", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 2.0);
"""
    return scene("s14", 14, body, script, css)


BUILDERS = {1: s01, 2: s02, 3: s03, 4: s04, 5: s05, 6: s06, 7: s07, 8: s08, 9: s09, 10: s10, 11: s11, 12: s12, 13: s13, 14: s14}

os.makedirs("compositions", exist_ok=True)
hosts, audios = [], []
for v in V:
    n = v["n"]
    sid = f"s{n:02d}"
    open(f"compositions/{sid}.html", "w").write(BUILDERS[n]())
    hosts.append(f'      <div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{starts[n]}" data-duration="{dur[n]}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
    audios.append(f'      <audio id="vo{n:02d}" class="clip" src="assets/vo/s{n:02d}.mp3" data-start="{round(starts[n] + v["lead"], 2)}" data-duration="{round(v["duration"], 2)}" data-track-index="2" data-volume="1"></audio>')

def at(n, local):
    return round(starts[n] + local, 2)


SFX = [
    ("slap", "slap", at(1, 0.27), 0.9),
    ("thud", "thud", at(2, vo_word_time(2, 0.62) + 0.72), 0.7),
    ("stamp", "stamp", at(3, 1.5), 0.9),
    ("pop1", "pop", at(4, vo_word_time(4, 0.15) + 0.45), 0.5),
    ("pop2", "pop", at(4, vo_word_time(4, 0.37) + 0.45), 0.5),
    ("pop3", "pop", at(4, vo_word_time(4, 0.59) + 0.45), 0.5),
    ("pop4", "pop", at(4, vo_word_time(4, 0.81) + 0.45), 0.5),
    ("stamp2", "stamp", at(6, vo_word_time(6, 0.27) + 1.3), 0.7),
    ("pop5", "pop", at(7, vo_word_time(7, 0.45)), 0.6),
    ("pop6", "pop", at(9, vo_word_time(9, 0.33)), 0.6),
    ("pop7", "pop", at(11, 0.5), 0.6),
    ("impact", "impact", at(13, 1.55), 0.45),
]
FXLEN = {"slap": 0.4, "thud": 1.5, "stamp": 0.6, "pop": 0.6, "impact": 2.2}
sfx_tags = [f'      <audio id="fx-{i}" class="clip" src="assets/sfx/{f}.mp3" data-start="{t0}" data-duration="{FXLEN[f]}" data-track-index="4" data-volume="{vol}"></audio>' for i, f, t0, vol in SFX]

MUSIC_AT = starts[3] + 2.1  # the colour flood into the app
music_len = round(min(160.0, TOTAL - MUSIC_AT), 2)
index = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #090a09; }}
      #root {{ width: 100%; height: 100%; position: relative; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080">
{chr(10).join(hosts)}
{chr(10).join(audios)}
{chr(10).join(sfx_tags)}
      <audio id="bed" class="clip" src="assets/music/bed.wav" data-start="{round(MUSIC_AT, 2)}" data-duration="{music_len}" data-track-index="3" data-volume="0.12" data-fade-in="1.5" data-fade-out="3"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""
open("index.html", "w").write(index)
print(f"built {len(V)} scenes, {TOTAL} s")
for v in V:
    print(f"  {v['n']:2d} {v['name']:<20} start {starts[v['n']]:7.2f}  dur {dur[v['n']]:6.2f}")
