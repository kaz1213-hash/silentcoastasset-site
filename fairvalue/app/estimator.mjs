/**
 * TANUKI FairValue: 類似取引ベースの探索的参考価格推定。
 * 入力はブラウザ内で処理し、サーバへ送信しない。
 * 未検証の予測区間/将来成約確率を主張しない。
 */
export const MIN_COMPARABLES = 5;

export function normalizeLabel(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

export function validTarget(q) {
  return q && normalizeLabel(q.prefecture) && normalizeLabel(q.city)
    && Number.isFinite(Number(q.area)) && Number(q.area) >= 15 && Number(q.area) <= 300;
}

export function weightedQuantile(items, fraction) {
  if (!items.length) return null;
  const sorted = items.filter(v => Number.isFinite(v.value) && Number.isFinite(v.weight) && v.weight > 0)
    .slice().sort((a, b) => a.value - b.value);
  if (!sorted.length) return null;
  const total = sorted.reduce((s, item) => s + item.weight, 0);
  let running = 0;
  for (const item of sorted) {
    running += item.weight;
    if (running >= fraction * total) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function quarterIndex(r) {
  const y = Number(r.year);
  const q = Number(r.quarter);
  if (!Number.isInteger(y) || !Number.isInteger(q) || q < 1 || q > 4) return null;
  return y * 4 + q - 1;
}

function plausibility(record) {
  if (!record || record.category !== "condo") return false;
  const a = Number(record.area);
  const p = Number(record.priceYen);
  return Number.isFinite(a) && Number.isFinite(p) && a >= 15 && a <= 300
    && p >= 500000 && p <= 1000000000 && p / a >= 50000 && p / a <= 10000000
    && quarterIndex(record) !== null;
}

function similarity(record, target, newestQuarter) {
  const areaScore = Math.abs(Math.log(Number(record.area) / Number(target.area))) * 3.1;
  const age = Number(target.ageYears);
  const recordAge = Number(record.ageYears);
  const ageScore = target.ageYears !== "" && target.ageYears != null
    && Number.isFinite(age) && Number.isFinite(recordAge) && recordAge >= 0
    ? Math.min(Math.abs(recordAge - age), 40) * 0.035 : 0.18;
  const station = normalizeLabel(target.station);
  const stationScore = station && normalizeLabel(record.station) && station !== normalizeLabel(record.station) ? 0.8 : 0;
  const dist = Number(target.stationMinutes), otherDist = Number(record.stationMinutes);
  const walkScore = target.stationMinutes !== "" && target.stationMinutes != null
    && record.stationMinutes != null && Number.isFinite(dist) && Number.isFinite(otherDist)
    ? Math.min(Math.abs(dist - otherDist), 30) * 0.025 : 0;
  const recency = Math.max(0, newestQuarter - quarterIndex(record));
  return areaScore + ageScore + stationScore + walkScore + Math.min(recency * 0.022, 0.8);
}

export function estimate(transactions, query, options = {}) {
  if (!validTarget(query)) return { ok: false, reason: "都道府県・市区町村・専有面積を確認してください。", candidates: 0 };
  const area = Number(query.area);
  const city = normalizeLabel(query.city);
  const prefecture = normalizeLabel(query.prefecture);
  const cutoff = Number(options.maxPeriodExclusive);
  const pool = transactions.filter(r => plausibility(r)
    && normalizeLabel(r.prefecture) === prefecture
    && normalizeLabel(r.city) === city
    && (!Number.isFinite(cutoff) || quarterIndex(r) < cutoff));
  if (pool.length < MIN_COMPARABLES) {
    return { ok: false, reason: "この市区町村の比較可能な取引事例が不足しています。", candidates: pool.length };
  }
  const narrow = pool.filter(r => Math.abs(Math.log(Number(r.area) / area)) <= Math.log(1.35));
  const medium = pool.filter(r => Math.abs(Math.log(Number(r.area) / area)) <= Math.log(1.65));
  let selected = narrow.length >= MIN_COMPARABLES ? narrow : medium;
  let areaScope = narrow.length >= MIN_COMPARABLES ? "専有面積±約35%" : "専有面積±約65%";
  if (selected.length < MIN_COMPARABLES) {
    return { ok: false, reason: "面積が近い取引事例が5件に達しません。", candidates: selected.length };
  }
  const district = normalizeLabel(query.district);
  let scope = "市区町村";
  if (district) {
    const local = selected.filter(r => normalizeLabel(r.district) === district);
    if (local.length >= MIN_COMPARABLES) {
      selected = local;
      scope = "同一地区";
    }
  }
  const station = normalizeLabel(query.station);
  if (station) {
    const stationRows = selected.filter(r => normalizeLabel(r.station) === station);
    if (stationRows.length >= MIN_COMPARABLES) {
      selected = stationRows;
      scope += "・同一駅";
    }
  }
  const newestQuarter = Math.max(...selected.map(quarterIndex));
  const scored = selected.map(r => ({ ...r, score: similarity(r, query, newestQuarter) }))
    .sort((a,b) => a.score - b.score).slice(0, 70);
  const weights = scored.map(r => ({
    value: Number(r.priceYen) / Number(r.area),
    weight: 1 / Math.pow(1 + r.score, 2),
  }));
  const center = weightedQuantile(weights, .50) * area;
  const low = weightedQuantile(weights, .25) * area;
  const high = weightedQuantile(weights, .75) * area;
  const spread = center ? (high - low) / center : 1;
  const confidence = scored.length >= 20 && spread < .35 ? "比較事例多め"
    : scored.length >= 10 && spread < .55 ? "比較事例あり" : "参考事例が少ない";
  return {
    ok: true, medianYen: Math.round(center), lowYen: Math.round(low), highYen: Math.round(high),
    count: scored.length, poolCount: pool.length, scope, areaScope, confidence,
    newestPeriod: Math.floor(newestQuarter / 4) + "年第" + (newestQuarter % 4 + 1) + "四半期",
    comparable: scored.slice(0, 8).map(r => ({
      prefecture: r.prefecture, city: r.city, district: r.district,
      year: r.year, quarter: r.quarter, area: r.area,
      ageYears: r.ageYears ?? null, priceYen: r.priceYen,
      station: r.station ?? "", stationMinutes: r.stationMinutes ?? null
    })),
    warning: "参考価格帯は類似取引の単価の第25〜75百分位を換算したもので、将来の売却価格の予測区間ではありません。"
  };
}

export function formatMan(yen) {
  return (yen / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "万円";
}
