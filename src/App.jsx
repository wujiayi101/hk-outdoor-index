import { useEffect, useState } from "react";

const TONE = { green: "#18a965", amber: "#e8a33d", orange: "#f0851f", red: "#e2574c" };
const STAT = { good: "#18a965", warn: "#e8a33d", bad: "#e2574c" };
const ICON = { temp: "🌡️", humidity: "💧", rain: "🌧️", aqhi: "🍃", vis: "👁️", uv: "☀️", warn: "⚠️" };

const UI = {
  tc: {
    title: "今日戶外運動合適指數", loc: "📍 香港", today: "今日",
    warnPrefix: "⚠️ 生效警告:", temp: "氣溫", humidity: "濕度", rain: "降雨",
    factors: "各項因素", updated: "更新時間:", refresh: "重新整理", source: "數據:",
    disclaimer: "指數為綜合估算,僅供參考。惡劣天氣請以天文台官方警告為準。",
    loading: "載入中…", failed: "載入失敗:", retry: "重試", toggle: "EN",
    fmtDate: (s) => `${+String(s).slice(4, 6)}月${+String(s).slice(6, 8)}日`,
  },
  en: {
    title: "Outdoor Exercise Index", loc: "📍 Hong Kong", today: "Today",
    warnPrefix: "⚠️ Active warnings: ", temp: "Temp", humidity: "Humidity", rain: "Rain",
    factors: "Factors", updated: "Updated: ", refresh: "Refresh", source: "Source: ",
    disclaimer: "An estimated composite index, for reference only. In bad weather, follow official HKO warnings.",
    loading: "Loading…", failed: "Failed to load: ", retry: "Retry", toggle: "中文",
    fmtDate: (s) => { const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${m[+String(s).slice(4,6)-1]} ${+String(s).slice(6,8)}`; },
  },
};

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem("hk_out_lang") || "tc");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const u = UI[lang];

  const load = (lg) => {
    setErr(null); setD(null);
    const fb = lg === "en" ? "sample.en.json" : "sample.json";
    fetch(`/api/today?lang=${lg}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .catch(() => fetch(`${import.meta.env.BASE_URL}${fb}`).then((r) => r.json()))
      .then((j) => (j.error ? Promise.reject(new Error(j.error)) : setD(j)))
      .catch((e) => setErr(String(e)));
  };
  useEffect(() => { localStorage.setItem("hk_out_lang", lang); load(lang); }, [lang]);

  if (err) return <div className="wrap center"><p>{u.failed}{err}</p><button onClick={() => load(lang)}>{u.retry}</button></div>;
  if (!d) return <div className="wrap center"><div className="spin" />{u.loading}</div>;

  const tone = TONE[d.level?.tone] || TONE.amber;
  const ringPct = (d.score / 10) * 100;
  const updStr = new Date(d.updatedAt).toLocaleString(lang === "en" ? "en-HK" : "zh-HK",
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const warnNames = d.warnings?.map((w) => w.name).join(lang === "en" ? ", " : "、");

  return (
    <div className="wrap">
      <button className="langtoggle" onClick={() => setLang(lang === "tc" ? "en" : "tc")}>{u.toggle}</button>
      <header>
        <h1>{u.title}</h1>
        <p className="loc">{u.loc} · {d.forecast?.date ? u.fmtDate(d.forecast.date) : u.today}</p>
      </header>

      {d.warnings?.length > 0 && <div className="warnbar">{u.warnPrefix}{warnNames}</div>}

      <div className="gauge card">
        <div className="dial" style={{ background: `conic-gradient(${tone} ${ringPct}%, #e9edf3 ${ringPct}% 100%)` }}>
          <div className="dial-in">
            <div className="score" style={{ color: tone }}>{d.score}</div>
            <div className="outof">/ 10</div>
          </div>
        </div>
        <div className="verdict" style={{ color: tone }}>{d.level?.emoji} {d.level?.label}</div>
        <ul className="advice">{d.advice?.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>

      <div className="forecast card">
        <div className="fc-row">
          <span>🌡️ {d.forecast?.minT}–{d.forecast?.maxT}°C</span>
          <span>💧 {u.humidity} ≤{d.forecast?.maxRH}%</span>
          <span>🌧️ {u.rain} {d.forecast?.psr || "—"}</span>
        </div>
        <p className="fc-text">{d.forecast?.weather}</p>
        {d.forecast?.wind && <p className="fc-wind">💨 {d.forecast.wind}</p>}
      </div>

      <h2>{u.factors}</h2>
      <div className="factors">
        {d.factors?.map((f) => (
          <div key={f.key} className="factor card" style={{ borderLeftColor: STAT[f.status] }}>
            <div className="f-top">
              <span className="f-name">{ICON[f.key] || "•"} {fname(f, d, lang)}</span>
              <span className="f-val" style={{ color: STAT[f.status] }}>{f.key === "warn" ? warnNames : f.value}</span>
            </div>
            <p className="f-note">{f.note}</p>
          </div>
        ))}
      </div>

      <footer>
        <p>{u.updated}{updStr} · <button className="link" onClick={() => load(lang)}>{u.refresh}</button></p>
        <p className="src">{u.source}{d.source}</p>
        <p className="dis">{u.disclaimer}</p>
      </footer>
    </div>
  );
}

// factor display name — API doesn't send names; derive from key for both langs
const FNAME = {
  tc: { temp: "氣溫", humidity: "濕度", rain: "降雨", aqhi: "空氣質素 AQHI", vis: "能見度", uv: "紫外線 UV", warn: "天氣警告" },
  en: { temp: "Temperature", humidity: "Humidity", rain: "Rain", aqhi: "Air Quality AQHI", vis: "Visibility", uv: "UV Index", warn: "Warnings" },
};
function fname(f, d, lang) { return (FNAME[lang] || FNAME.tc)[f.key] || f.key; }
