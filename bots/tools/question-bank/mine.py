# Pulls search-box suggestions (Google EN/TH, Baidu ZH, Yandex RU) per AYBKK topic.
# Run: python3 -I mine.py out.json  (about 12 min; Yandex stops answering after about 150 calls, so RU gaps are normal)
import json, subprocess, sys, time, urllib.parse
OUT = sys.argv[1]

def curl(url):
    r = subprocess.run(["curl", "-sS", "-m", "15", url], capture_output=True)
    return r.stdout

def google(q, hl):
    u = "https://suggestqueries.google.com/complete/search?client=firefox&hl=%s&q=%s" % (hl, urllib.parse.quote(q))
    try: return json.loads(curl(u).decode("utf-8", "replace"))[1]
    except Exception: return []

def baidu(q):
    raw = curl("https://suggestion.baidu.com/su?json=1&wd=" + urllib.parse.quote(q))
    try:
        t = raw.decode("gbk", "replace")
        t = t[t.index("(") + 1:t.rindex(")")]
        return [g["q"] for g in json.loads(t).get("g", [])]
    except Exception: return []

def yandex(q):
    try: return json.loads(curl("https://suggest.yandex.ru/suggest-ff.cgi?uil=ru&part=" + urllib.parse.quote(q)).decode("utf-8", "replace"))[1]
    except Exception: return []

EN_TOPICS = {
 "01 Start": ["ashtanga yoga beginner", "mysore style yoga", "ashtanga first class"],
 "02 Habit": ["yoga every day", "morning yoga", "ashtanga every day"],
 "03 Back pain / office": ["yoga for back pain", "yoga for office workers"],
 "04 Sleep / stress": ["yoga for sleep", "yoga for stress"],
 "05 Aging well": ["yoga after 50", "yoga over 40"],
 "06 Runners / sport": ["yoga for runners", "yoga for athletes"],
 "07 Body / weight": ["ashtanga weight loss", "ashtanga yoga strength"],
 "08 Injury": ["ashtanga injury", "yoga knee pain"],
 "09 Breath": ["ujjayi breathing", "bandha yoga"],
 "10 Tradition": ["sharath jois", "pattabhi jois", "ashtanga moon day", "authorized ashtanga teacher"],
 "11 Teacher path": ["ashtanga teacher training", "how to become an ashtanga teacher", "yoga studio retention", "yoga teacher students"],
 "12 Bangkok": ["yoga bangkok", "ashtanga bangkok", "mysore bangkok"],
}
EN_MODS = ["how", "why", "can", "is", "does", "what", "should", "when", "vs"]
TH_TOPICS = {
 "01 Start": ["โยคะ มือใหม่", "อัษฎางคโยคะ", "ashtanga yoga คือ"],
 "02 Habit": ["โยคะ ทุกวัน", "โยคะ ตอนเช้า"],
 "03 Back pain / office": ["โยคะ ปวดหลัง", "โยคะ ออฟฟิศซินโดรม"],
 "04 Sleep / stress": ["โยคะ นอนไม่หลับ", "โยคะ คลายเครียด"],
 "05 Aging well": ["โยคะ ผู้สูงอายุ", "โยคะ อายุ 40"],
 "06 Runners / sport": ["โยคะ นักวิ่ง"],
 "07 Body / weight": ["โยคะ ลดน้ำหนัก", "โยคะ สร้างกล้ามเนื้อ"],
 "08 Injury": ["โยคะ บาดเจ็บ", "โยคะ ปวดเข่า"],
 "12 Bangkok": ["โยคะ กรุงเทพ", "โยคะ สุขุมวิท", "เรียนโยคะ ราคา"],
}
TH_MODS = ["", "ไหม", "ยังไง", "ดีไหม", "อันตราย", "กี่"]
ZH_TOPICS = {
 "01 Start": ["阿斯汤加 新手", "阿斯汤加瑜伽", "迈索尔 瑜伽"],
 "02 Habit": ["瑜伽 每天", "瑜伽 早上", "阿斯汤加 每天"],
 "03 Back pain / office": ["瑜伽 腰痛", "瑜伽 久坐"],
 "04 Sleep / stress": ["瑜伽 失眠", "瑜伽 焦虑"],
 "05 Aging well": ["瑜伽 40岁", "瑜伽 中年"],
 "06 Runners / sport": ["瑜伽 跑步"],
 "07 Body / weight": ["阿斯汤加 减肥", "阿斯汤加 力量"],
 "08 Injury": ["阿斯汤加 受伤", "瑜伽 膝盖"],
 "09 Breath": ["乌加依呼吸", "瑜伽 收束"],
 "10 Tradition": ["沙拉斯", "帕塔比乔伊斯", "阿斯汤加 月亮日", "阿斯汤加 认证"],
 "11 Teacher path": ["阿斯汤加 老师", "瑜伽老师 学员", "瑜伽馆 留住会员", "阿斯汤加 师资"],
}
ZH_MODS = ["", "怎么", "为什么", "可以", "多久", "适合", "是什么"]
RU_TOPICS = {
 "01 Start": ["аштанга йога для начинающих", "майсор йога", "аштанга йога"],
 "02 Habit": ["йога каждый день", "йога утром"],
 "03 Back pain / office": ["йога для спины", "йога при сидячей работе"],
 "04 Sleep / stress": ["йога для сна", "йога от стресса"],
 "05 Aging well": ["йога после 40", "йога после 50"],
 "06 Runners / sport": ["йога для бегунов"],
 "07 Body / weight": ["аштанга похудение"],
 "08 Injury": ["аштанга травмы", "йога колени"],
 "09 Breath": ["уджайи дыхание", "бандхи"],
 "10 Tradition": ["шарат джойс", "паттабхи джойс", "аштанга лунные дни", "авторизованный учитель аштанга"],
 "11 Teacher path": ["стать учителем аштанга", "учитель йоги ученики"],
 "12 Bangkok": ["йога бангкок", "йога таиланд"],
}
RU_MODS = ["", "как", "почему", "можно ли", "сколько", "вред"]

def run(lang, topics, mods, fn):
    res = {}
    for t, seeds in topics.items():
        got = []
        for s in seeds:
            qs = [s + " "] + [(m + " " + s + " ") if m and lang == "en" else (s + " " + m + " " if m else None) for m in mods]
            if lang == "en": qs += [s + " " + m + " " for m in ["for", "or", "after", "every"]]
            for q in qs:
                if not q: continue
                for x in fn(q):
                    if x not in got: got.append(x)
                time.sleep(0.25)
        res[t] = got
        print(lang, t, len(got), file=sys.stderr)
    return res

out = {
 "en": run("en", EN_TOPICS, EN_MODS, lambda q: google(q, "en")),
 "th": run("th", TH_TOPICS, TH_MODS, lambda q: google(q, "th")),
 "zh": run("zh", ZH_TOPICS, ZH_MODS, baidu),
 "ru": run("ru", RU_TOPICS, RU_MODS, yandex),
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
