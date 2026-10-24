import { formatMan } from "./estimator.mjs";
import { estimateFairValue } from "./fairvalue.mjs";
import { comparablePropertyEvidence } from "./attribute_evidence.mjs";
import { assessEvidence } from "./confidence_intervals.mjs";
import { analyzeFreshness, quarterLabel } from "./freshness.mjs";
import { mountAreaMap } from "./area_map_ui.mjs";
import {validNationalCatalog,sortedPrefectures,listedCities,observedCityCounts,cityDataState} from "./nationwide.mjs";

const el = id => document.getElementById(id);
const fmt = number => Number(number).toLocaleString("ja-JP");
let dataset = {metadata:{status:"no_official_data",count:0},transactions:[]};
let validation = null;
let intervalProfiles = null;
let officialFreshness = null;
let nationwideCatalog = null;
let recordedCityCounts = new Map();

function setOptions(select, labels, emptyLabel, preferred="") {
  select.replaceChildren();
  if (emptyLabel) {
    const placeholder = document.createElement("option");
    placeholder.value="";
    placeholder.textContent=emptyLabel;
    select.appendChild(placeholder);
  }
  for (const label of labels) {
    const option=document.createElement("option");
    option.value=label;
    option.textContent=label;
    select.appendChild(option);
  }
  if (preferred && labels.includes(preferred)) select.value=preferred;
  else if (emptyLabel) select.value="";
}

const sortLabels = labels => [...new Set(labels.filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));

function currentLocationRows() {
  return dataset.transactions.filter(r => r.prefecture===el("prefecture").value && r.city===el("city").value);
}
function refreshCity() {
  const prefecture=el("prefecture").value;
  const cities=nationwideCatalog ? listedCities(nationwideCatalog,prefecture) :
    sortLabels(dataset.transactions.filter(r=>r.prefecture===prefecture).map(r=>r.city));
  const defaultCity=cities.includes("松本市")?"松本市":cities.length===1?cities[0]:"";
  setOptions(el("city"),cities,"市区町村を選択",defaultCity);
  refreshLocalFields();
}
function refreshLocalFields() {
  const rows=currentLocationRows();
  setOptions(el("district"),sortLabels(rows.map(r=>r.district)),"指定しない（市区町村全体）");
  setOptions(el("station"),sortLabels(rows.map(r=>r.station)),"指定しない");
  updateCityAvailability();
}
function updateCityAvailability(){
  const coverage=cityDataState(recordedCityCounts,
    el("prefecture").value,el("city").value);
  const display=el("regionCoverage");
  display.textContent=coverage.message;
  display.dataset.state=coverage.state;
  const pricingReady=dataset.metadata?.status==="official_csv_imported" &&
    coverage.state==="PRICE_DATA";
  el("submitButton").disabled=!pricingReady;
  if(!pricingReady){
    el("resultPanel").hidden=true;
    el("emptyState").hidden=true;
    el("matchedPanel").hidden=true;
  }
}
function updateMeta() {
  const meta=dataset.metadata;
  if (meta.status==="official_csv_imported" && dataset.transactions.length) {
    const nationalSummary=nationwideCatalog?.metadata;
    el("nationalScope").textContent=nationalSummary
      ?"地図：47都道府県・"+fmt(nationalSummary.municipalities)+"市区町村等 ／ 価格分析用の公表取引："+
        fmt(recordedCityCounts.size)+"市区・"+fmt(meta.count)+"件（研究版）"
      :"価格分析用の公表取引："+fmt(recordedCityCounts.size)+"市区・"+fmt(meta.count)+
        "件。全国行政区域の索引は利用できません。";
    const freshness=analyzeFreshness(meta,officialFreshness);
    const periodName=freshness.latestRecordQuarterLabel;
    el("dataStatus").textContent="公開取引 "+fmt(meta.count)+"件 / 最終収録 "+(meta.periodMax||"不明");
    const checked=freshness.checkedDateJst?"公式公開状況の確認日："+freshness.checkedDateJst+"。":"";
    el("sourceDetail").textContent=
      "出典：国土交通省「不動産情報ライブラリ」。取込済み："+fmt(meta.count)+"件。最終収録："+periodName+"。"+
      checked+"取込日時："+(meta.importedAt?new Date(meta.importedAt).toLocaleDateString("ja-JP"):"不明")+
      "。取引価格は公表時に丸められることがあり、すべての成約を網羅していません。";
    let notice="この分析は最終収録期（"+periodName+"）までの過去取引が基準。現在の売却査定額ではありません。";
    if(freshness.state==="OFFICIAL_MATCHES_LOCAL")
      notice+=" "+freshness.checkedDateJst+"時点では公式公開画面も同じ最終期を表示。";
    else if(freshness.state==="OFFICIAL_UPDATE_AVAILABLE")
      notice+=" 国の公開画面には新しい期がありますが、まだアプリへ反映していません。";
    else if(freshness.state==="OFFICIAL_CHECK_EXPIRED")
      notice+=" 国の公開状況の最終確認から30日以上経過。最新公開期の再確認が必要です。";
    else if(freshness.state==="UNVERIFIED")
      notice+=" 国の公開状況が最新であるか未確認です。";
    if(freshness.daysSinceQuarter!=null && freshness.daysSinceQuarter>180)
      notice+=" 最終収録期の終了から半年以上経過しており、直近の相場変化は反映できません。";
    el("sourceAgeNotice").textContent=notice;
    updateCityAvailability();
  } else {
    el("dataStatus").textContent="実取引データ未取込 / 価格算出停止中";
    el("sourceAgeNotice").textContent="公式データが取り込まれていないため参考価格を表示できません。";
    el("sourceDetail").textContent="現在は公式データ未取込。価格推定機能は利用できません。";
    el("submitButton").disabled=true;
    el("formError").hidden=false;
    el("formError").textContent="公的取引データがまだありません。開発者が公式CSVを取り込むと利用可能になります。";
  }
}
function setCell(row,text) {
  const cell=document.createElement("td");
  cell.textContent=String(text);
  row.appendChild(cell);
}
function updateComparables(comps) {
  const body=el("comparableRows");
  body.replaceChildren();
  for (const r of comps) {
    const tr=document.createElement("tr");
    setCell(tr,r.district||"地区非公開");
    setCell(tr,fmt(r.area)+"㎡");
    setCell(tr,r.ageYears==null?"—":fmt(r.ageYears)+"年");
    setCell(tr,r.year+"年 Q"+r.quarter);
    setCell(tr,formatMan(r.priceYen));
    body.appendChild(tr);
  }
  el("compCount").textContent="代表 "+comps.length+"件を表示";
}
function renderMatchedEvidence(query) {
  const panel=el("matchedPanel");
  const record=comparablePropertyEvidence(dataset.transactions,query);
  if(record.status==="NOT_REQUESTED"){
    panel.hidden=true;
    return;
  }
  panel.hidden=false;
  el("matchedFilters").textContent=record.activeFilters?.join(" ／ ")||
    "間取り・構造を指定してください。";
  const summary=el("matchedObservedSummary");
  el("matchedExplanation").textContent=record.reason??record.note??"";
  if(!record.ok) {
    summary.hidden=true;
    el("matchedRows").replaceChildren();
    return;
  }
  summary.hidden=false;
  el("matchedMedian").textContent=formatMan(record.medianObservedYen);
  el("matchedInterquartile").textContent=
    formatMan(record.q25ObservedYen)+" 〜 "+formatMan(record.q75ObservedYen);
  el("matchedCount").textContent=fmt(record.count)+"件";
  el("matchedPeriod").textContent="対象時期："+record.periodEarliest+"〜"+record.periodLatest+
    "。これは実取引の記述統計で、個別物件の価格査定ではありません。";
  const tbody=el("matchedRows");
  tbody.replaceChildren();
  for(const r of record.representatives){
    const tr=document.createElement("tr");
    setCell(tr,r.district||"地区非公開");
    setCell(tr,r.layout||"不明");
    setCell(tr,r.structure||"不明");
    setCell(tr,fmt(r.area)+"㎡");
    setCell(tr,r.year+"年 Q"+r.quarter);
    setCell(tr,formatMan(r.priceYen));
    tbody.appendChild(tr);
  }
}
function offerMessage(estimateResult) {
  const offerMan=Number(el("offerMan").value);
  if (!el("offerMan").value || !Number.isFinite(offerMan) || offerMan<=0) {
    el("offerAssessment").hidden=true;
    return;
  }
  const offered=offerMan*10000;
  let message="";
  if (offered < estimateResult.lowYen) message="過去取引価格の参考範囲より低めです。ただし、直接買取では業者の再販費用・リスク等により仲介の成約価格を下回り得ます。これだけで損だとは判断できません。";
  else if (offered > estimateResult.highYen) message="過去取引価格の参考範囲より高めです。提示額からの減額条件、仲介手数料、売却時期と手取りを確認してください。";
  else message="過去取引価格の参考範囲内です。ただし査定方法、物件状態、契約条件、手取りまで比べて判断してください。";
  const node=el("offerAssessment");
  node.textContent="提示額 "+fmt(offerMan)+"万円： "+message+
    " ※市場の取引価格と不動産会社の直接買取提示額は別の価格概念です。";
  node.hidden=false;
}
function updateValidation(query) {
  const key = query.prefecture + " " + query.city;
  const result=validation?.byMunicipality?.[key];
  if (!result || !result.sufficientForDisplay) {
    el("factError").textContent="検証件数不足";
    el("validationNote").textContent="この地域は時系列の後追い検証件数が不足しています。";
    return;
  }
  el("factError").textContent=result.medianAbsolutePctError+"%（"+fmt(result.evaluated)+"件）";
  const tendency=result.medianSignedPctError<0
    ? "中央値で"+Math.abs(result.medianSignedPctError)+"%の低め方向"
    : "中央値で"+Math.abs(result.medianSignedPctError)+"%の高め方向";
  el("validationNote").textContent=
    "直近4四半期について各取引より前のデータだけで検証した、研究版v0.2の誤差です。"+tendency+
    "の偏りもあります。モデル開発で確認済みの地域・期間であり、完全独立テストではありません。将来の成約価格や手取り額の精度を保証しません。";
}
function updateIntervalAnalysis(result,query) {
  const key=query.prefecture+" "+query.city;
  const profile=intervalProfiles?.byMunicipality?.[key]??null;
  const analysis=assessEvidence(result,query,profile);
  const regionEvaluations=profile?.evaluationCount??0;
  const seenRate=profile?.evaluationCoverage;
  const lower=profile?.evaluationCoverageWilsonLower;
  el("intervalCoverage").textContent=regionEvaluations>=80 && seenRate!=null
    ?(seenRate*100).toFixed(1)+"%（"+fmt(regionEvaluations)+"件）"
    :"検証数不足（"+fmt(regionEvaluations)+"件）";
  if(analysis.priceInterval) {
    const range=analysis.priceInterval;
    el("intervalPanel").hidden=false;
    el("intervalRange").textContent=formatMan(range.lowYen)+" 〜 "+formatMan(range.highYen);
    el("intervalExplanation").textContent=
      "この地域の過去"+fmt(regionEvaluations)+"件で価格帯的中率"+
      (seenRate*100).toFixed(1)+"%。80%は目標値で、将来の個別物件に対する的中保証ではありません。";
    el("intervalGrade").textContent="参考帯を表示（要注意）";
    el("intervalWarning").textContent=
      "過去の値動きが続くという仮定は置けません。築年・階数・管理・眺望等で大きく外れる場合があります。"+
      (lower==null?"":"地域の過去的中率の95%Wilson下限："+(lower*100).toFixed(1)+"%。");
  } else {
    el("intervalPanel").hidden=true;
    el("intervalGrade").textContent="価格帯の表示を見送り";
    const reasons=analysis.reasons.length?analysis.reasons.join("／"):"地域別の評価情報不足";
    el("intervalWarning").textContent=
      "参考価格は表示しますが、80%目標帯の表示は控えています。理由："+reasons+
      "。根拠が不十分な場合、価格帯を捏造しません。";
  }
}
function renderResult(r,query) {
  el("resultPanel").hidden=false;
  el("emptyState").hidden=true;
  el("priceMedian").textContent=formatMan(r.medianYen);
  el("priceRange").textContent=formatMan(r.lowYen)+" 〜 "+formatMan(r.highYen);
  const minPrice=Math.max(0,Math.min(r.lowYen,r.medianYen)*.92);
  const maxPrice=Math.max(r.highYen,r.medianYen)*1.08;
  const span=Math.max(1,maxPrice-minPrice);
  el("lowLabel").textContent=formatMan(minPrice);
  el("highLabel").textContent=formatMan(maxPrice);
  el("rangeBand").style.left=((r.lowYen-minPrice)/span*100).toFixed(1)+"%";
  el("rangeBand").style.width=((r.highYen-r.lowYen)/span*100).toFixed(1)+"%";
  el("rangeBand").style.right="auto";
  el("rangeCenter").style.left=((r.medianYen-minPrice)/span*100).toFixed(1)+"%";
  const isHedonic=r.pricingMethod==="ridge_v02";
  el("priceLabel").textContent=isHedonic
    ?"面積・築年・駅・取引時期を補正した推定参考価格"
    :"過去の類似取引の単価中央値（補正モデルは利用不可）";
  el("factModel").textContent=isHedonic
    ?"統計回帰 v0.2（学習 "+fmt(r.modelTrainingCount)+"件）"
    :"取引事例比較 v0.1";
  el("priceNote").textContent=isHedonic
    ?"上の価格は統計回帰、帯は過去類似取引の単価分布を面積換算したものです。別々の方法のため一致しません。将来の売却額の予測区間ではありません。"
    :"比較事例の単価から算出した参考値です。将来の売却額の予測区間ではありません。";
  el("resultBadge").textContent="参考事例 "+fmt(r.count)+"件";
  el("factCount").textContent=fmt(r.count)+"件（市区町村内 "+fmt(r.poolCount)+"件）";
  el("factScope").textContent=r.scope;
  el("factArea").textContent=r.areaScope;
  el("factPeriod").textContent=r.newestPeriod+"（取引時点）";
  el("factConfidence").textContent=r.confidence;
  updateValidation(query);
  updateIntervalAnalysis(r,query);
  updateComparables(r.comparable);
  renderMatchedEvidence(query);
  offerMessage(r);
  el("resultPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function showMissing(reason) {
  el("resultPanel").hidden=true;
  el("emptyState").hidden=false;
  el("emptyReason").textContent=reason;
  el("emptyState").scrollIntoView({behavior:"smooth",block:"center"});
}
function handleSubmit(event) {
  event.preventDefault();
  el("formError").hidden=true;
  const q = {
    prefecture:el("prefecture").value,
    city:el("city").value,
    district:el("district").value,
    station:el("station").value,
    area:el("area").value,
    ageYears:el("ageYears").value===""?null:Number(el("ageYears").value),
    stationMinutes:el("stationMinutes").value===""?null:Number(el("stationMinutes").value),
    layout:el("layout").value,
    structure:el("structure").value
  };
  if (!q.prefecture || !q.city || Number(q.area)<15 || Number(q.area)>300 ||
     !Number.isFinite(Number(q.area))) {
    el("formError").hidden=false;
    el("formError").textContent="都道府県、市区町村、専有面積（15〜300㎡）を指定してください。";
    return;
  }
  const result=estimateFairValue(dataset.transactions,q);
  if (result.ok) renderResult(result,q);
  else showMissing(result.reason);
}
async function initialize() {
  el("submitButton").disabled=true;
  el("estimateForm").addEventListener("submit",handleSubmit);
  el("prefecture").addEventListener("change",refreshCity);
  el("city").addEventListener("change",refreshLocalFields);
  try {
    const response=await fetch("./data/transactions.json",{cache:"no-store"});
    if (!response.ok) throw new Error("HTTP "+response.status);
    const parsed=await response.json();
    if (!Array.isArray(parsed.transactions)) throw new Error("invalid format");
    dataset=parsed;
    recordedCityCounts=observedCityCounts(dataset.transactions);
    try {
      const nationalResponse=await fetch("./data/national_catalog.json",{cache:"no-store"});
      if(nationalResponse.ok){
        const candidate=await nationalResponse.json();
        if(validNationalCatalog(candidate)) nationwideCatalog=candidate;
      }
    } catch (_error) {nationwideCatalog=null;}
    const prefs=nationwideCatalog ? sortedPrefectures(nationwideCatalog) :
      sortLabels(dataset.transactions.map(r=>r.prefecture));
    const defaultPref=prefs.includes("長野県")?"長野県":prefs.length===1?prefs[0]:"";
    setOptions(el("prefecture"),prefs,"都道府県を選択",defaultPref);
    refreshCity();
  } catch (error) {
    el("dataStatus").textContent="データの読込に失敗";
    el("sourceDetail").textContent="データ取得状況を確認してください。";
    el("formError").hidden=false;
    el("formError").textContent="公開データファイルを読み込めません。ローカルファイルを直接開かず、ローカルサーバーからアクセスしてください。";
    return;
  }
  try {
    const validationResponse=await fetch("./data/validation.json",{cache:"no-store"});
    if (validationResponse.ok) {
      const candidate=await validationResponse.json();
      if(candidate.sourceFingerprint &&
         candidate.sourceFingerprint===dataset.metadata.sourceFingerprint)
        validation=candidate;
    }
  } catch (_error) {
    validation=null;
  }
  try {
    const intervalResponse=await fetch("./data/interval_profiles.json",{cache:"no-store"});
    if(intervalResponse.ok) {
      const loaded=await intervalResponse.json();
      // データ更新後に古い検証記録が流用されないよう件数と時期を検証。
      if(loaded.sourceCount===dataset.metadata.count&&
         loaded.sourcePeriod===dataset.metadata.periodMax&&
         loaded.sourceFingerprint===dataset.metadata.sourceFingerprint)
        intervalProfiles=loaded;
    }
  } catch (_error) {
    intervalProfiles=null;
  }
  try {
    const sourceCheckResponse=await fetch("./data/freshness.json",{cache:"no-store"});
    if(sourceCheckResponse.ok) officialFreshness=await sourceCheckResponse.json();
  } catch (_error) { officialFreshness=null; }
  updateMeta();
  // The geographic layer is advisory only; a missing map never blocks pricing.
  mountAreaMap(dataset.transactions,dataset.metadata,nationwideCatalog).catch(()=>{});
}
initialize();
