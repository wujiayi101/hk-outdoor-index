// Cloudflare Pages Function — GET /api/today
// Fetches HK Observatory + EPD open data server-side (these hosts lack CORS,
// so the browser can't hit them directly), computes a 1–10 outdoor-exercise
// suitability score, and returns JSON. Cached at the edge for 20 min.

const SRC = {
  rhrread: "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc",
  fnd: "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc",
  warn: "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc",
  vis: "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_visibility.csv",
  aqhi: "https://www.aqhi.gov.hk/epd/ddata/html/out/24aqhi_Eng.xml",
};

async function getJSON(u) { const r = await fetch(u, { cf: { cacheTtl: 600 } }); return r.ok ? r.json() : null; }
async function getText(u) { const r = await fetch(u, { cf: { cacheTtl: 600 } }); return r.ok ? r.text() : null; }

// --- parsers ---------------------------------------------------------------
function parseVisibility(csv) {
  if (!csv) return null;
  const lines = csv.trim().split(/\r?\n/).slice(1);
  let latest = "", vals = [];
  for (const ln of lines) {
    const [ts, , v] = ln.split(",");
    if (!v) continue;
    if (ts > latest) { latest = ts; vals = []; }
    if (ts === latest) {
      const km = parseFloat(v); // "29 km"
      if (Number.isFinite(km)) vals.push(km);
    }
  }
  return vals.length ? Math.min(...vals) : null; // worst (lowest) visibility
}

function parseAQHI(xml) {
  if (!xml) return null;
  // keep only General Stations; take latest DateTime per station; return max aqhi
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const latestByStation = {};
  for (const it of items) {
    if (!/General Stations/.test(it)) continue;
    const st = (it.match(/<StationName>(.*?)<\/StationName>/) || [])[1];
    const dt = (it.match(/<DateTime>(.*?)<\/DateTime>/) || [])[1];
    const aq = parseInt((it.match(/<aqhi>(.*?)<\/aqhi>/) || [])[1], 10);
    if (!st || !dt || !Number.isFinite(aq)) continue;
    const t = Date.parse(dt);
    if (!latestByStation[st] || t > latestByStation[st].t) latestByStation[st] = { t, aq };
  }
  const vals = Object.values(latestByStation).map((x) => x.aq);
  return vals.length ? Math.max(...vals) : null; // worst general-station AQHI
}

function maxTempNow(rhr) {
  const d = rhr?.temperature?.data || [];
  const vals = d.map((x) => x.value).filter((v) => Number.isFinite(v));
  const hko = d.find((x) => /天文台|Observatory/.test(x.place))?.value;
  return { max: vals.length ? Math.max(...vals) : null, hko: hko ?? null };
}
function humidityNow(rhr) {
  const d = rhr?.humidity?.data || [];
  return d.length ? d[0].value : null;
}
function uvNow(rhr) {
  const u = rhr?.uvindex;
  if (!u || typeof u === "string") return null; // "" outside daylight
  return u?.data?.[0]?.value ?? null;
}
function activeWarnings(warn) {
  if (!warn || typeof warn !== "object") return [];
  return Object.values(warn).map((w) => ({ code: w.code, name: w.name, type: w.type }))
    .filter((w) => w.name);
}

// --- scoring ---------------------------------------------------------------
// Start at 10, deduct per factor. Warnings can hard-cap the score.
function scoreDay(d) {
  const f = [];
  let s = 10;
  const add = (key, name, value, status, note, penalty) => {
    s -= penalty || 0;
    f.push({ key, name, value, status, note });
  };

  // temperature — use the warmer of (current max, forecast max) for exertion
  const tEval = Math.max(d.tNowMax ?? -99, d.tMaxFc ?? -99);
  if (tEval > -99) {
    let p = 0, st = "good", note = "氣溫舒適,適合運動";
    if (tEval >= 35) { p = 6; st = "bad"; note = "酷熱,中暑風險高,避免劇烈運動"; }
    else if (tEval >= 33) { p = 4; st = "bad"; note = "非常炎熱,宜清晨或傍晚並多補水"; }
    else if (tEval >= 31) { p = 2.5; st = "warn"; note = "炎熱,避開正午、注意補水"; }
    else if (tEval >= 28) { p = 1; st = "warn"; note = "溫暖,適量補水"; }
    else if (tEval >= 16) { p = 0; st = "good"; note = "氣溫舒適,適合運動"; }
    else if (tEval >= 12) { p = 1; st = "warn"; note = "微涼,注意熱身"; }
    else if (tEval >= 8) { p = 2; st = "warn"; note = "天氣寒冷,做好保暖"; }
    else { p = 3; st = "bad"; note = "嚴寒,慎防著涼"; }
    add("temp", "氣溫", `${tEval}°C`, st, note, p);
  }

  // humidity — use higher of current / forecast max
  const rhEval = Math.max(d.rhNow ?? -1, d.rhMaxFc ?? -1);
  if (rhEval >= 0) {
    let p = 0, st = "good", note = "濕度適中";
    if (rhEval >= 90) { p = 2; st = "bad"; note = "非常潮濕焗促,汗水難蒸發"; }
    else if (rhEval >= 80) { p = 1; st = "warn"; note = "潮濕,體感更熱"; }
    else if (rhEval < 30) { p = 0.5; st = "warn"; note = "乾燥,注意補水潤喉"; }
    add("humidity", "濕度", `${rhEval}%`, st, note, p);
  }

  // rain / thunderstorm — forecast probability + weather text
  const txt = d.weatherText || "";
  let rp = 0, rst = "good", rnote = "降雨機會低", rval = d.psr || "低";
  if (/雷暴|暴雨|大雨/.test(txt)) { rp = 5; rst = "bad"; rnote = "有雷暴/大雨,戶外運動危險"; rval = "雷暴/大雨"; }
  else if (d.psr === "高") { rp = 3; rst = "bad"; rnote = "降雨機會高,帶備雨具或改期"; }
  else if (d.psr === "中") { rp = 1.5; rst = "warn"; rnote = "間中有雨,留意天色"; }
  else if (/驟雨|有雨|微雨/.test(txt)) { rp = 1; rst = "warn"; rnote = "或有零星驟雨"; }
  s -= rp; f.push({ key: "rain", name: "降雨", value: rval, status: rst, note: rnote });

  // AQHI
  if (d.aqhi != null) {
    let p = 0, st = "good", note = "空氣質素良好";
    if (d.aqhi >= 10) { p = 5; st = "bad"; note = "空氣污染嚴重,避免戶外運動"; }
    else if (d.aqhi >= 7) { p = 2.5; st = "bad"; note = "空氣健康風險高,減少劇烈運動"; }
    else if (d.aqhi >= 4) { p = 0.5; st = "warn"; note = "空氣中等,敏感人士注意"; }
    add("aqhi", "空氣質素 AQHI", String(d.aqhi), st, note, p);
  }

  // visibility (haze/fog)
  if (d.vis != null) {
    let p = 0, st = "good", note = "能見度良好";
    if (d.vis < 2) { p = 2; st = "bad"; note = "濃霧/嚴重煙霞,能見度極低"; }
    else if (d.vis < 5) { p = 1; st = "warn"; note = "能見度偏低(煙霞)"; }
    add("vis", "能見度", `${d.vis} km`, st, note, p);
  }

  // UV — advisory (you can still exercise with protection)
  if (d.uv != null) {
    let p = 0, st = "good", note = "紫外線偏低";
    if (d.uv >= 11) { p = 1; st = "bad"; note = "紫外線極端,正午避免曝曬、做好防曬"; }
    else if (d.uv >= 8) { p = 0.5; st = "warn"; note = "紫外線甚高,塗防曬、戴帽"; }
    else if (d.uv >= 6) { p = 0; st = "warn"; note = "紫外線偏高,建議防曬"; }
    add("uv", "紫外線 UV", String(d.uv), st, note, p);
  }

  // warnings — hard caps
  const wnames = d.warnings.map((w) => w.name).join("、");
  for (const w of d.warnings) {
    const n = w.name || "";
    if (/八號|九號|十號|颶風|黑色暴雨|紅色暴雨|暴雨/.test(n)) s = Math.min(s, 1);
    else if (/雷暴/.test(n)) s = Math.min(s, 4);
    else if (/酷熱/.test(n)) s = Math.min(s, 4);
    else if (/寒冷/.test(n)) s = Math.min(s, 5);
    else if (/三號|一號/.test(n)) s -= 1;
  }
  if (d.warnings.length) f.push({ key: "warn", name: "天氣警告", value: wnames, status: "bad", note: "留意官方警告,安全第一" });

  s = Math.max(1, Math.min(10, Math.round(s * 10) / 10));
  return { score: s, factors: f };
}

function levelOf(s) {
  if (s >= 9) return { label: "極佳", emoji: "🟢", tone: "green" };
  if (s >= 7) return { label: "良好", emoji: "🟢", tone: "green" };
  if (s >= 5) return { label: "一般", emoji: "🟡", tone: "amber" };
  if (s >= 3) return { label: "欠佳", emoji: "🟠", tone: "orange" };
  return { label: "不宜", emoji: "🔴", tone: "red" };
}

function adviceOf(score, factors, forecast) {
  const bad = factors.filter((x) => x.status === "bad");
  const tips = [];
  if (score >= 9) tips.push("今日天氣理想,放心出門運動!");
  else if (score >= 7) tips.push("適合戶外運動,留意以下小提示。");
  else if (score >= 5) tips.push("尚可運動,但要避開不利因素。");
  else if (score >= 3) tips.push("條件欠佳,宜縮短時間或改室內。");
  else tips.push("不建議戶外運動,改室內為佳。");
  for (const b of bad) tips.push(b.note);
  if (/雷暴|驟雨/.test(forecast?.weather || "") && score > 2) tips.push("驟雨/雷暴多於午後,清晨相對安全。");
  return [...new Set(tips)];
}

// --- handler ---------------------------------------------------------------
export async function onRequest(context) {
  try {
    const [rhr, fnd, warn, visCsv, aqhiXml] = await Promise.all([
      getJSON(SRC.rhrread), getJSON(SRC.fnd), getJSON(SRC.warn), getText(SRC.vis), getText(SRC.aqhi),
    ]);

    const t = maxTempNow(rhr);
    const fc0 = fnd?.weatherForecast?.[0] || {};
    const d = {
      tNowMax: t.max, tNowHKO: t.hko, rhNow: humidityNow(rhr), uv: uvNow(rhr),
      tMaxFc: fc0?.forecastMaxtemp?.value ?? null, tMinFc: fc0?.forecastMintemp?.value ?? null,
      rhMaxFc: fc0?.forecastMaxrh?.value ?? null, psr: fc0?.PSR ?? null,
      weatherText: fc0?.forecastWeather ?? "", wind: fc0?.forecastWind ?? "",
      vis: parseVisibility(visCsv), aqhi: parseAQHI(aqhiXml),
      warnings: activeWarnings(warn),
    };

    const { score, factors } = scoreDay(d);
    const level = levelOf(score);
    const forecast = {
      date: fc0?.forecastDate, weather: d.weatherText, wind: d.wind, psr: d.psr,
      maxT: d.tMaxFc, minT: d.tMinFc, maxRH: d.rhMaxFc,
    };
    const body = {
      score, level, factors,
      advice: adviceOf(score, factors, forecast),
      forecast,
      obs: { tempMax: d.tNowMax, tempHKO: d.tNowHKO, humidity: d.rhNow, uv: d.uv, visibility: d.vis, aqhi: d.aqhi },
      warnings: d.warnings,
      updatedAt: new Date().toISOString(),
      source: "香港天文台 (HKO) + 環保署 (EPD) 公開數據",
    };
    return new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=1200", // 20 min
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
}
