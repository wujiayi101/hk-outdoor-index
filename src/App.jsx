import { useEffect, useState } from "react";

const TONE = { green: "#18a965", amber: "#e8a33d", orange: "#f0851f", red: "#e2574c" };
const STAT = { good: "#18a965", warn: "#e8a33d", bad: "#e2574c" };
const ICON = { temp: "🌡️", humidity: "💧", rain: "🌧️", aqhi: "🍃", vis: "👁️", uv: "☀️", warn: "⚠️" };

export default function App() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => {
    setErr(null);
    // /api/today = live Cloudflare Pages Function; sample.json = local-dev fallback
    fetch("/api/today")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .catch(() => fetch(`${import.meta.env.BASE_URL}sample.json`).then((r) => r.json()))
      .then((j) => (j.error ? Promise.reject(new Error(j.error)) : setD(j)))
      .catch((e) => setErr(String(e)));
  };
  useEffect(load, []);

  if (err) return <div className="wrap center"><p>載入失敗:{err}</p><button onClick={load}>重試</button></div>;
  if (!d) return <div className="wrap center"><div className="spin" />載入中…</div>;

  const tone = TONE[d.level?.tone] || TONE.amber;
  const ringPct = (d.score / 10) * 100;
  const upd = new Date(d.updatedAt);
  const updStr = upd.toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="wrap">
      <header>
        <h1>今日戶外運動合適指數</h1>
        <p className="loc">📍 香港 · {d.forecast?.date ? fmtDate(d.forecast.date) : "今日"}</p>
      </header>

      {d.warnings?.length > 0 && (
        <div className="warnbar">⚠️ 生效警告:{d.warnings.map((w) => w.name).join("、")}</div>
      )}

      <div className="gauge card">
        <div className="dial" style={{ background: `conic-gradient(${tone} ${ringPct}%, #e9edf3 ${ringPct}% 100%)` }}>
          <div className="dial-in">
            <div className="score" style={{ color: tone }}>{d.score}</div>
            <div className="outof">/ 10</div>
          </div>
        </div>
        <div className="verdict" style={{ color: tone }}>{d.level?.emoji} {d.level?.label}</div>
        <ul className="advice">
          {d.advice?.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>

      <div className="forecast card">
        <div className="fc-row">
          <span>🌡️ {d.forecast?.minT}–{d.forecast?.maxT}°C</span>
          <span>💧 濕度 ≤{d.forecast?.maxRH}%</span>
          <span>🌧️ 降雨{d.forecast?.psr || "—"}</span>
        </div>
        <p className="fc-text">{d.forecast?.weather}</p>
        {d.forecast?.wind && <p className="fc-wind">💨 {d.forecast.wind}</p>}
      </div>

      <h2>各項因素</h2>
      <div className="factors">
        {d.factors?.map((f) => (
          <div key={f.key} className="factor card" style={{ borderLeftColor: STAT[f.status] }}>
            <div className="f-top">
              <span className="f-name">{ICON[f.key] || "•"} {f.name}</span>
              <span className="f-val" style={{ color: STAT[f.status] }}>{f.value}</span>
            </div>
            <p className="f-note">{f.note}</p>
          </div>
        ))}
      </div>

      <footer>
        <p>更新時間:{updStr} · <button className="link" onClick={load}>重新整理</button></p>
        <p className="src">數據:{d.source}</p>
        <p className="dis">指數為綜合估算,僅供參考。惡劣天氣請以天文台官方警告為準。</p>
      </footer>
    </div>
  );
}

function fmtDate(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${+s.slice(4, 6)}月${+s.slice(6, 8)}日`;
}
