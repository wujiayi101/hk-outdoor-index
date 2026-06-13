// Cloudflare Pages Function — GET /api/today?lang=tc|en
// Fetches HK Observatory + EPD open data server-side (these hosts lack CORS),
// computes a 1–10 outdoor-exercise suitability score, returns localized JSON.

const SRC = (lang) => ({
  rhrread: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=${lang}`,
  fnd: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=${lang}`,
  warn: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=${lang}`,
  vis: "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_visibility.csv",
  aqhi: "https://www.aqhi.gov.hk/epd/ddata/html/out/24aqhi_Eng.xml",
});

// HKO lang codes: tc -> "tc", en -> "en"
const hkoLang = (l) => (l === "en" ? "en" : "tc");

async function getJSON(u) { const r = await fetch(u, { cf: { cacheTtl: 600 } }); return r.ok ? r.json() : null; }
async function getText(u) { const r = await fetch(u, { cf: { cacheTtl: 600 } }); return r.ok ? r.text() : null; }

// --- i18n strings ----------------------------------------------------------
const STR = {
  tc: {
    fname: { temp: "氣溫", humidity: "濕度", rain: "降雨", aqhi: "空氣質素 AQHI", vis: "能見度", uv: "紫外線 UV", warn: "天氣警告" },
    level: { excellent: "極佳", good: "良好", fair: "一般", poor: "欠佳", bad: "不宜" },
    rainStorm: "雷暴/大雨", rainLow: "低",
    note: {
      heat_extreme: "酷熱,中暑風險高,避免劇烈運動", heat_veryhot: "非常炎熱,宜清晨或傍晚並多補水",
      heat_hot: "炎熱,避開正午、注意補水", heat_warm: "溫暖,適量補水", temp_ok: "氣溫舒適,適合運動",
      cool_mild: "微涼,注意熱身", cold: "天氣寒冷,做好保暖", cold_severe: "嚴寒,慎防著涼",
      rh_veryhigh: "非常潮濕焗促,汗水難蒸發", rh_high: "潮濕,體感更熱", rh_dry: "乾燥,注意補水潤喉", rh_ok: "濕度適中",
      rain_storm: "有雷暴/大雨,戶外運動危險", rain_high: "降雨機會高,帶備雨具或改期",
      rain_mid: "間中有雨,留意天色", rain_drizzle: "或有零星驟雨", rain_low: "降雨機會低",
      aq_severe: "空氣污染嚴重,避免戶外運動", aq_high: "空氣健康風險高,減少劇烈運動",
      aq_mid: "空氣中等,敏感人士注意", aq_good: "空氣質素良好",
      vis_verylow: "濃霧/嚴重煙霞,能見度極低", vis_low: "能見度偏低(煙霞)", vis_ok: "能見度良好",
      uv_extreme: "紫外線極端,正午避免曝曬、做好防曬", uv_veryhigh: "紫外線甚高,塗防曬、戴帽",
      uv_high: "紫外線偏高,建議防曬", uv_low: "紫外線偏低",
      warn_note: "留意官方警告,安全第一",
    },
    band: { 9: "今日天氣理想,放心出門運動!", 7: "適合戶外運動,留意以下小提示。", 5: "尚可運動,但要避開不利因素。", 3: "條件欠佳,宜縮短時間或改室內。", 1: "不建議戶外運動,改室內為佳。" },
    thunderTip: "驟雨/雷暴多於午後,清晨相對安全。",
  },
  en: {
    fname: { temp: "Temperature", humidity: "Humidity", rain: "Rain", aqhi: "Air Quality AQHI", vis: "Visibility", uv: "UV Index", warn: "Weather Warnings" },
    level: { excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor", bad: "Unsuitable" },
    rainStorm: "Storm / Heavy rain", rainLow: "Low",
    note: {
      heat_extreme: "Extreme heat — high heatstroke risk, avoid vigorous exercise", heat_veryhot: "Very hot — go early morning/evening and hydrate well",
      heat_hot: "Hot — avoid midday, keep hydrated", heat_warm: "Warm — stay hydrated", temp_ok: "Comfortable temperature for exercise",
      cool_mild: "Mildly cool — warm up well", cold: "Cold — dress warmly", cold_severe: "Severe cold — beware of chill",
      rh_veryhigh: "Very humid and muggy — sweat won't evaporate", rh_high: "Humid — feels hotter", rh_dry: "Dry — keep hydrated", rh_ok: "Comfortable humidity",
      rain_storm: "Thunderstorm / heavy rain — outdoor exercise dangerous", rain_high: "High chance of rain — bring gear or reschedule",
      rain_mid: "Occasional rain — watch the sky", rain_drizzle: "Possible isolated showers", rain_low: "Low chance of rain",
      aq_severe: "Severe air pollution — avoid outdoor exercise", aq_high: "High health risk — reduce vigorous exercise",
      aq_mid: "Moderate air — sensitive groups take note", aq_good: "Good air quality",
      vis_verylow: "Dense fog / severe haze — very low visibility", vis_low: "Low visibility (haze)", vis_ok: "Good visibility",
      uv_extreme: "Extreme UV — avoid midday sun, use sunscreen", uv_veryhigh: "Very high UV — sunscreen and a hat",
      uv_high: "High UV — sunscreen advised", uv_low: "Low UV",
      warn_note: "Heed official warnings — safety first",
    },
    band: { 9: "Great weather today — head out and exercise!", 7: "Good for outdoor exercise; note the tips below.", 5: "OK to exercise, but avoid the adverse factors.", 3: "Poor conditions — keep it short or go indoors.", 1: "Not recommended outdoors — indoor is better." },
    thunderTip: "Showers/thunderstorms mostly in the afternoon; early morning is safer.",
  },
};

// --- parsers ---------------------------------------------------------------
function parseVisibility(csv) {
  if (!csv) return null;
  const lines = csv.trim().split(/\r?\n/).slice(1);
  let latest = "", vals = [];
  for (const ln of lines) {
    const [ts, , v] = ln.split(",");
    if (!v) continue;
    if (ts > latest) { latest = ts; vals = []; }
    if (ts === latest) { const km = parseFloat(v); if (Number.isFinite(km)) vals.push(km); }
  }
  return vals.length ? Math.min(...vals) : null;
}
function parseAQHI(xml) {
  if (!xml) return null;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const latest = {};
  for (const it of items) {
    if (!/General Stations/.test(it)) continue;
    const st = (it.match(/<StationName>(.*?)<\/StationName>/) || [])[1];
    const dt = (it.match(/<DateTime>(.*?)<\/DateTime>/) || [])[1];
    const aq = parseInt((it.match(/<aqhi>(.*?)<\/aqhi>/) || [])[1], 10);
    if (!st || !dt || !Number.isFinite(aq)) continue;
    const t = Date.parse(dt);
    if (!latest[st] || t > latest[st].t) latest[st] = { t, aq };
  }
  const vals = Object.values(latest).map((x) => x.aq);
  return vals.length ? Math.max(...vals) : null;
}
function maxTempNow(rhr) {
  const d = rhr?.temperature?.data || [];
  const vals = d.map((x) => x.value).filter((v) => Number.isFinite(v));
  const hko = d.find((x) => /天文台|Observatory/.test(x.place))?.value;
  return { max: vals.length ? Math.max(...vals) : null, hko: hko ?? null };
}
const humidityNow = (rhr) => (rhr?.humidity?.data?.[0]?.value ?? null);
function uvNow(rhr) { const u = rhr?.uvindex; if (!u || typeof u === "string") return null; return u?.data?.[0]?.value ?? null; }
function activeWarnings(warn) {
  if (!warn || typeof warn !== "object") return [];
  return Object.values(warn).map((w) => ({ code: w.code, name: w.name, type: w.type })).filter((w) => w.name);
}

// --- scoring (language-neutral: emits note keys; warnings keyed by CODE) ----
function scoreDay(d) {
  const f = [];
  let s = 10;
  const push = (key, value, status, noteKey, penalty) => { s -= penalty || 0; f.push({ key, value, status, noteKey }); };

  const tEval = Math.max(d.tNowMax ?? -99, d.tMaxFc ?? -99);
  if (tEval > -99) {
    let p = 0, st = "good", nk = "temp_ok";
    if (tEval >= 35) { p = 6; st = "bad"; nk = "heat_extreme"; }
    else if (tEval >= 33) { p = 4; st = "bad"; nk = "heat_veryhot"; }
    else if (tEval >= 31) { p = 2.5; st = "warn"; nk = "heat_hot"; }
    else if (tEval >= 28) { p = 1; st = "warn"; nk = "heat_warm"; }
    else if (tEval >= 16) { p = 0; st = "good"; nk = "temp_ok"; }
    else if (tEval >= 12) { p = 1; st = "warn"; nk = "cool_mild"; }
    else if (tEval >= 8) { p = 2; st = "warn"; nk = "cold"; }
    else { p = 3; st = "bad"; nk = "cold_severe"; }
    push("temp", `${tEval}°C`, st, nk, p);
  }

  const rhEval = Math.max(d.rhNow ?? -1, d.rhMaxFc ?? -1);
  if (rhEval >= 0) {
    let p = 0, st = "good", nk = null;
    if (rhEval >= 90) { p = 2; st = "bad"; nk = "rh_veryhigh"; }
    else if (rhEval >= 80) { p = 1; st = "warn"; nk = "rh_high"; }
    else if (rhEval < 30) { p = 0.5; st = "warn"; nk = "rh_dry"; }
    if (nk) push("humidity", `${rhEval}%`, st, nk, p);
    else f.push({ key: "humidity", value: `${rhEval}%`, status: "good", noteKey: "rh_ok" });
  }

  const txt = d.weatherText || "";
  let rp = 0, rst = "good", rnk = "rain_low", rkind = "low";
  if (/雷暴|暴雨|大雨|thunderstorm|heavy rain/i.test(txt)) { rp = 5; rst = "bad"; rnk = "rain_storm"; rkind = "storm"; }
  else if (d.psrHigh) { rp = 3; rst = "bad"; rnk = "rain_high"; }
  else if (d.psrMid) { rp = 1.5; rst = "warn"; rnk = "rain_mid"; }
  else if (/驟雨|有雨|微雨|shower|rain/i.test(txt)) { rp = 1; rst = "warn"; rnk = "rain_drizzle"; }
  s -= rp;
  f.push({ key: "rain", value: rkind === "storm" ? "__storm__" : (d.psr || "__low__"), status: rst, noteKey: rnk });

  if (d.aqhi != null) {
    let p = 0, st = "good", nk = "aq_good";
    if (d.aqhi >= 10) { p = 5; st = "bad"; nk = "aq_severe"; }
    else if (d.aqhi >= 7) { p = 2.5; st = "bad"; nk = "aq_high"; }
    else if (d.aqhi >= 4) { p = 0.5; st = "warn"; nk = "aq_mid"; }
    push("aqhi", String(d.aqhi), st, nk, p);
  }

  if (d.vis != null) {
    let p = 0, st = "good", nk = "vis_ok";
    if (d.vis < 2) { p = 2; st = "bad"; nk = "vis_verylow"; }
    else if (d.vis < 5) { p = 1; st = "warn"; nk = "vis_low"; }
    push("vis", `${d.vis} km`, st, nk, p);
  }

  if (d.uv != null) {
    let p = 0, st = "good", nk = "uv_low";
    if (d.uv >= 11) { p = 1; st = "bad"; nk = "uv_extreme"; }
    else if (d.uv >= 8) { p = 0.5; st = "warn"; nk = "uv_veryhigh"; }
    else if (d.uv >= 6) { p = 0; st = "warn"; nk = "uv_high"; }
    push("uv", String(d.uv), st, nk, p);
  }

  // warnings — cap by CODE (language-independent)
  for (const w of d.warnings) {
    const c = (w.code || "").toUpperCase();
    if (/^WRAINB$|^WRAINR$|^TC(8|9|10)/.test(c)) s = Math.min(s, 1);
    else if (c === "WRAINA") s -= 3;
    else if (c === "WTS") s = Math.min(s, 4);
    else if (c === "WHOT") s = Math.min(s, 4);
    else if (c === "WCOLD") s = Math.min(s, 5);
    else if (c === "TC3" || c === "TC1") s -= 1;
  }
  if (d.warnings.length) f.push({ key: "warn", value: "__warn__", status: "bad", noteKey: "warn_note" });

  s = Math.max(1, Math.min(10, Math.round(s * 10) / 10));
  return { score: s, factors: f };
}

const levelOf = (s) => s >= 9 ? { key: "excellent", emoji: "🟢", tone: "green" }
  : s >= 7 ? { key: "good", emoji: "🟢", tone: "green" }
  : s >= 5 ? { key: "fair", emoji: "🟡", tone: "amber" }
  : s >= 3 ? { key: "poor", emoji: "🟠", tone: "orange" }
  : { key: "bad", emoji: "🔴", tone: "red" };

// localize factors + advice into the requested language
function localize(lang, score, level, factors, weatherText) {
  const T = STR[lang] || STR.tc;
  const outFactors = factors.map((f) => {
    let value = f.value;
    if (value === "__storm__") value = T.rainStorm;
    else if (value === "__low__") value = T.rainLow;
    else if (value === "__warn__") value = ""; // filled by frontend from warnings list
    const note = T.note[f.noteKey] || "";
    return { key: f.key, value, status: f.status, note };
  });
  const bandKey = score >= 9 ? 9 : score >= 7 ? 7 : score >= 5 ? 5 : score >= 3 ? 3 : 1;
  const bad = outFactors.filter((x) => x.status === "bad");
  const advice = [T.band[bandKey], ...bad.map((b) => b.note)];
  if (/雷暴|驟雨|thunderstorm|shower/i.test(weatherText || "") && score > 2) advice.push(T.thunderTip);
  return { levelLabel: T.level[level.key], factors: outFactors, advice: [...new Set(advice.filter(Boolean))] };
}

// --- handler ---------------------------------------------------------------
export async function onRequest(context) {
  const url = new URL(context?.request?.url || "http://x/?lang=tc");
  const lang = url.searchParams.get("lang") === "en" ? "en" : "tc";
  try {
    const src = SRC(hkoLang(lang));
    const [rhr, fnd, warn, visCsv, aqhiXml] = await Promise.all([
      getJSON(src.rhrread), getJSON(src.fnd), getJSON(src.warn), getText(src.vis), getText(src.aqhi),
    ]);
    const t = maxTempNow(rhr);
    const fc0 = fnd?.weatherForecast?.[0] || {};
    const psr = fc0?.PSR ?? null;
    const d = {
      tNowMax: t.max, tNowHKO: t.hko, rhNow: humidityNow(rhr), uv: uvNow(rhr),
      tMaxFc: fc0?.forecastMaxtemp?.value ?? null, tMinFc: fc0?.forecastMintemp?.value ?? null,
      rhMaxFc: fc0?.forecastMaxrh?.value ?? null, psr,
      psrHigh: /高|high/i.test(psr || ""), psrMid: /中|medium/i.test(psr || ""),
      weatherText: fc0?.forecastWeather ?? "", wind: fc0?.forecastWind ?? "",
      vis: parseVisibility(visCsv), aqhi: parseAQHI(aqhiXml), warnings: activeWarnings(warn),
    };
    const { score, factors } = scoreDay(d);
    const level = levelOf(score);
    const loc = localize(lang, score, level, factors, d.weatherText);

    const body = {
      lang, score,
      level: { label: loc.levelLabel, emoji: level.emoji, tone: level.tone },
      factors: loc.factors, advice: loc.advice,
      forecast: { date: fc0?.forecastDate, weather: d.weatherText, wind: d.wind, psr: d.psr, maxT: d.tMaxFc, minT: d.tMinFc, maxRH: d.rhMaxFc },
      obs: { tempMax: d.tNowMax, tempHKO: d.tNowHKO, humidity: d.rhNow, uv: d.uv, visibility: d.vis, aqhi: d.aqhi },
      warnings: d.warnings,
      updatedAt: new Date().toISOString(),
      source: lang === "en" ? "HK Observatory (HKO) + EPD open data" : "香港天文台 (HKO) + 環保署 (EPD) 公開數據",
    };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=1200" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
}
