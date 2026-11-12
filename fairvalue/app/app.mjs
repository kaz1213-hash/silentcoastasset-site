import { formatMan } from "./estimator.mjs";
import { estimateFairValue } from "./fairvalue.mjs";
import { comparablePropertyEvidence } from "./attribute_evidence.mjs";
import { assessEvidence } from "./confidence_intervals.mjs";
import { analyzeFreshness, quarterLabel } from "./freshness.mjs";
import { mountAreaMap, setSupplementaryAreaMapRows, setSupplementaryAreaMapGeography } from "./area_map_ui.mjs";
import {validShardIndex,validateSupplement,validateSupplementTownGeo,shardTier,historicalObservations} from "./supplemental_prices.mjs";
import {validNationalCatalog,sortedPrefectures,listedCities,cityCoverageGroups,observedCityCounts,cityDataState} from "./nationwide.mjs";

const el = id => document.getElementById(id);
const fmt = number => Number(number).toLocaleString("ja-JP");
let dataset = {metadata:{status:"no_official_data",count:0},transactions:[]};
let validation = null;
let intervalProfiles = null;
let officialFreshness = null;
let nationwideCatalog = null;
let recordedCityCounts = new Map();
let shardIndex=null;
const loadedShards=new Map();
const mappedShardTowns=new Map();
const inflightShards=new Map();
const failedShards=new Set();

function codeForPrefecture(prefecture){
  return nationwideCatalog?.prefectures?.find(p=>p.name===prefecture)?.code??"";
}
function extraCityTier(prefecture,city){
  return shardTier(shardIndex,prefecture,city,nationwideCatalog);
}
function currentShard(){
  const code=codeForPrefecture(el("prefecture").value);
  return loadedShards.get(code)??null;
}
function shardCityRows(prefecture,city){
  const code=codeForPrefecture(prefecture);
  const supplement=loadedShards.get(code);
  return supplement?.transactions?.filter(r=>r.prefecture===prefecture&&r.city===city)??[];
}
function cityRows(prefecture,city){
  const core=dataset.transactions.filter(r=>r.prefecture===prefecture&&r.city===city);
  return core.length?core:shardCityRows(prefecture,city);
}
function shardReportsFor(q){
  const code=codeForPrefecture(q.prefecture);
  const doc=loadedShards.get(code);
  const key=q.prefecture+" "+q.city;
  return {
    validation:doc?.validation?.byMunicipality?.[key]??null,
    profile:doc?.intervalProfiles?.byMunicipality?.[key]??null
  };
}
function refreshMapSupplement(code){
  const shard=loadedShards.get(code);
  if(shard)setSupplementaryAreaMapRows(shard.transactions,code);
  const geo=mappedShardTowns.get(code);
  if(geo)setSupplementaryAreaMapGeography(geo.cities);
}
async function ensureShard(prefecture){
  const code=codeForPrefecture(prefecture);
  const entry=shardIndex?.entries?.[code];
  if(!entry || loadedShards.has(code) || failedShards.has(code))return;
  if(inflightShards.has(code))return inflightShards.get(code);
  const job=(async()=>{
    try {
      const response=await fetch("./"+entry.file,{cache:"no-cache"});
      if(!response.ok)throw Error("HTTP "+response.status);
      const sourceBytes=await response.arrayBuffer();
      const digest=await crypto.subtle.digest("SHA-256",sourceBytes);
      const actualDigest=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
      if(actualDigest!==entry.sha256)throw Error("Prefecture file checksum mismatch");
      const candidate=JSON.parse(new TextDecoder("utf-8").decode(sourceBytes));
      const coreKeys=new Set(dataset.transactions.map(r=>r.prefecture+"|"+r.city));
      if(!validateSupplement(candidate,entry,dataset.metadata,coreKeys,nationwideCatalog))
        throw Error("Prefecture shard source mismatch");
      loadedShards.set(code,candidate);
      // Geographic sidecar is optional. Any failure leaves valid price data available.
      try{
        const geoResponse=await fetch("./"+entry.geoFile,{cache:"no-cache"});
        if(geoResponse.ok){
          const geoBytes=await geoResponse.arrayBuffer();
          const geoDigest=await crypto.subtle.digest("SHA-256",geoBytes);
          const geoActual=[...new Uint8Array(geoDigest)]
            .map(b=>b.toString(16).padStart(2,"0")).join("");
          if(geoActual===entry.geoSha256){
            const extraGeo=JSON.parse(new TextDecoder("utf-8").decode(geoBytes));
            if(validateSupplementTownGeo(extraGeo,entry,dataset.metadata,nationwideCatalog))
              mappedShardTowns.set(code,extraGeo);
          }
        }
      }catch(_geoError){/* price-only fallback */}
      refreshMapSupplement(code);
      if(el("prefecture").value===prefecture)refreshLocalFields();
    } catch(_error){
      failedShards.add(code);
      if(el("prefecture").value===prefecture)updateCityAvailability();
    } finally{inflightShards.delete(code);}
  })();
  inflightShards.set(code,job);
  return job;
}

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
const additionalFilterIds=["district","station","ageYears","stationMinutes","layout","structure","offerMan"];
function updateAdvancedFilterIndicator(){
  const count=additionalFilterIds.reduce((n,id)=>n+(el(id).value.trim()!==""?1:0),0);
  el("advancedFilterIndicator").textContent=count?count+"項目を指定中":"未指定";
}
function mountAdvancedFilterIndicator(){
  for(const id of additionalFilterIds){
    const input=el(id);
    input.addEventListener(input.tagName==="INPUT"?"input":"change",updateAdvancedFilterIndicator);
  }
  updateAdvancedFilterIndicator();
}
// A newly edited form must never show a quote calculated for older inputs.
function invalidateDisplayedResults(){
  const shown=["resultPanel","historicalPanel","emptyState"].some(id=>!el(id).hidden);
  if(!shown)return;
  for(const id of ["resultPanel","historicalPanel","emptyState","matchedPanel"])
    el(id).hidden=true;
  el("resultUpdateHint").hidden=false;
}
function formatResultContext(q){
  return [
    [q.prefecture,q.city,q.district].filter(Boolean).join(" "),
    "専有面積 "+fmt(Number(q.area))+"㎡",
    q.ageYears==null?"":"築年数 "+fmt(q.ageYears)+"年",
    q.station?"最寄り駅 "+q.station:""
  ].filter(Boolean).join(" ／ ");
}
function setCityOptions(select,prefecture,cities,defaultCity){
  // Option TEXT remains the official municipality name for keyboard access,
  // Playwright and map linkage. Group labels provide discoverability only.
  const groups=cityCoverageGroups(nationwideCatalog,prefecture,recordedCityCounts,shardIndex);
  select.replaceChildren();
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="市区町村を選択";
  select.appendChild(placeholder);
  for(const group of groups){
    if(!group.cities.length)continue;
    const optgroup=document.createElement("optgroup");
    optgroup.label=group.label+"（"+fmt(group.cities.length)+"市区町村等）";
    for(const city of group.cities){
      const option=document.createElement("option");
      option.value=city.value;option.textContent=city.label;optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  // Fallback for a missing national catalog; never drop legacy cities.
  if(!nationwideCatalog)setOptions(select,cities,"市区町村を選択",defaultCity);
  else select.value=defaultCity||"";
  const label=el("prefCoverageSummary");
  if(label){
    const counts=Object.fromEntries(groups.map(g=>[g.tier,g.cities.length]));
    label.textContent=prefecture+
      "：参考価格の研究版 "+fmt(counts.RESEARCH)+" ／ 過去取引のみ "+
      fmt(counts.OBSERVED_ONLY)+" ／ 件数不足 "+fmt(counts.SPARSE_ONLY)+
      " ／ 価格未収録 "+fmt(counts.MAP_ONLY)+
      "。未収録地域も行政区域の地図は表示できます。";
  }
}

function currentLocationRows() {
  return cityRows(el("prefecture").value,el("city").value);
}
function refreshCity() {
  const prefecture=el("prefecture").value;
  const cities=nationwideCatalog ? listedCities(nationwideCatalog,prefecture) :
    sortLabels(dataset.transactions.filter(r=>r.prefecture===prefecture).map(r=>r.city));
  const defaultCity=cities.includes("松本市")?"松本市":cities.length===1?cities[0]:"";
  setCityOptions(el("city"),prefecture,cities,defaultCity);
  refreshLocalFields();
  void ensureShard(prefecture);
}
function refreshLocalFields() {
  const rows=currentLocationRows();
  setOptions(el("district"),sortLabels(rows.map(r=>r.district)),"指定しない（市区町村全体）");
  setOptions(el("station"),sortLabels(rows.map(r=>r.station)),"指定しない");
  updateAdvancedFilterIndicator();
  updateCityAvailability();
  void ensureShard(el("prefecture").value);
}
function updateCityAvailability(){
  const pref=el("prefecture").value,city=el("city").value;
  const core=cityDataState(recordedCityCounts,pref,city);
  const tier=core.state==="PRICE_DATA"?null:extraCityTier(pref,city);
  const code=codeForPrefecture(pref);
  let state=core.state,message=core.message;
  if(tier){
    if(failedShards.has(code)) {
      state="SHARD_UNAVAILABLE";
      message="県別取引データを検証できませんでした。この地域は地図のみ表示します。";
    } else if(!loadedShards.has(code)) {
      state="SHARD_LOADING";
      message="この地域の公的取引データを必要なときだけ読み込んでいます。";
    } else if(tier.tier==="RESEARCH_BETA"){
      state="RESEARCH_BETA";
      message="この地域の取引："+fmt(tier.rows)+"件。過去の予測誤差を確認した研究版の参考価格を表示します（現在の査定額ではありません）。";
    } else if(tier.tier==="OBSERVED_ONLY"){
      state="OBSERVED_ONLY";
      const apiOnly=shardIndex?.entries?.[code]?.dataOrigin==="MLIT_XIT001_API";
      message="この地域の公表取引："+fmt(tier.rows)+"件。"+(apiOnly
        ?"国交省APIから収録した過去の取引実績のみ。駅名・駅徒歩分数は未収録で、個別の売却予想はしません。"
        :"精度検証が不足しているため、過去の観測取引価格だけを表示します。");
    } else {
      state="SPARSE_ONLY";
      message="この地域の取引は"+fmt(tier.rows)+"件。根拠が少ないため価格を表示しません。";
    }
  }
  const display=el("regionCoverage");
  display.textContent=message; display.dataset.state=state;
  const fromApi=Boolean(tier && shardIndex?.entries?.[code]?.dataOrigin==="MLIT_XIT001_API");
  el("mapApiAttribution").hidden=!fromApi;
  const ready=dataset.metadata?.status==="official_csv_imported" &&
    (state==="PRICE_DATA"||state==="RESEARCH_BETA"||state==="OBSERVED_ONLY");
  el("submitButton").disabled=!ready;
  el("submitButton").textContent=state==="OBSERVED_ONLY"?"過去の取引実績を見る":"参考価格を確認する ↗";
  el("historicalPanel").hidden=true;
  if(!ready || state!=="PRICE_DATA"){
    el("resultPanel").hidden=true;
    el("emptyState").hidden=true;
    el("matchedPanel").hidden=true;
  }
}
function updateMeta() {
  const meta=dataset.metadata;
  if (meta.status==="official_csv_imported" && dataset.transactions.length) {
    const nationalSummary=nationwideCatalog?.metadata;
    const extraCount=shardIndex?.additionalRows??0;
    const newResearch=Object.values(shardIndex?.entries??{}).reduce((n,item)=>
      n+item.priceDataCities,0);
    const descriptive=Object.values(shardIndex?.entries??{}).reduce((n,item)=>
      n+item.historicalOnlyCities,0);
    const shards=Object.entries(shardIndex?.entries??{});
    const legacyRegions=new Set(dataset.transactions.map(r=>r.municipalityCode.slice(0,2)));
    const reviewedCsvPrefectures=shards.filter(([,e])=>e.dataOrigin!=="MLIT_XIT001_API").length;
    const apiOnlyPrefectures=shards.filter(([code,e])=>
      e.dataOrigin==="MLIT_XIT001_API"&&!legacyRegions.has(code)).length;
    const mixedCoreApiPrefectures=shards.filter(([code,e])=>
      e.dataOrigin==="MLIT_XIT001_API"&&legacyRegions.has(code)).length;
    el("nationalScope").textContent=nationalSummary
      ?"全国地図：47都道府県・"+fmt(nationalSummary.municipalities)+"市区町村等 ／ 県別公開取引：CSV "+fmt(reviewedCsvPrefectures)+"府県・APIの過去取引のみ "+fmt(apiOnlyPrefectures)+"県・既存市区＋API補完 "+fmt(mixedCoreApiPrefectures)+"県 ／ 参考価格の研究版："+
        fmt(recordedCityCounts.size+newResearch)+"市区 ／ 過去取引のみ：追加"+fmt(descriptive)+"市区"
      :"価格分析用の公表取引："+fmt(recordedCityCounts.size)+"市区・"+fmt(meta.count)+
        "件。全国行政区域の索引は利用できません。";
    const freshness=analyzeFreshness(meta,officialFreshness);
    const periodName=freshness.latestRecordQuarterLabel;
    el("dataStatus").textContent="公開取引 "+fmt(meta.count)+"件（既存）"+
      (shardIndex?"＋県別追加 "+fmt(shardIndex.additionalRows)+"件":"")+
      " / 最終収録 "+(meta.periodMax||"不明");
    // Live from the reviewed source manifest, never a static marketing claim.
    const overviewCount=el("overviewTransactions");
    if(overviewCount)overviewCount.textContent=fmt(meta.count+extraCount);
    const overviewPeriod=el("overviewPeriod");
    if(overviewPeriod)overviewPeriod.textContent=meta.periodMax||"不明";
    const checked=freshness.checkedDateJst?"公式公開状況の確認日："+freshness.checkedDateJst+"。":"";
    el("sourceDetail").textContent=
      "出典：国土交通省「不動産情報ライブラリ」。公表取引："+fmt(meta.count)+"件（既存15市区）"+
      (shardIndex?"＋県別追加 "+fmt(extraCount)+"件":"")+
      "。最終収録："+periodName+"。"+
      checked+"取込日時："+(meta.importedAt?new Date(meta.importedAt).toLocaleDateString("ja-JP"):"不明")+
      "。取引価格は公表時に丸められることがあり、すべての成約を網羅していません。";
    // Prominent disclaimer: short, scannable facts. Full source and
    // observation-period provenance remains available in #sourceDetail.
    let notice="データの対象："+periodName+"までの公表取引。現在の売却査定額ではありません。";
    if(freshness.state==="OFFICIAL_MATCHES_LOCAL")
      notice+=" 公式公開状況："+freshness.checkedDateJst+"確認済み。";
    else if(freshness.state==="OFFICIAL_UPDATE_AVAILABLE")
      notice+=" Q2の公表取引は下の研究用欄に別表示しています。参考価格モデルはQ1までで凍結しています。";
    else if(freshness.state==="OFFICIAL_CHECK_EXPIRED")
      notice+=" 国の公開状況の確認から30日以上経過しています。";
    else if(freshness.state==="UNVERIFIED")
      notice+=" 国の最新公開期は未確認です。";
    if(freshness.daysSinceQuarter!=null && freshness.daysSinceQuarter>180)
      notice+=" 直近半年の相場変化は反映していません。";
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
  const record=comparablePropertyEvidence(cityRows(query.prefecture,query.city),query);
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
  const result=validation?.byMunicipality?.[key]??shardReportsFor(query).validation;
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
  const profile=intervalProfiles?.byMunicipality?.[key]??shardReportsFor(query).profile;
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
  el("resultContext").textContent=formatResultContext(query);
  el("historicalPanel").hidden=true;
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
function renderHistorical(historical,query) {
  el("historicalContext").textContent=formatResultContext(query);
  el("resultPanel").hidden=true;
  el("matchedPanel").hidden=true;
  el("emptyState").hidden=true;
  const section=el("historicalPanel");
  section.hidden=false;
  el("apiAttribution").hidden=shardIndex?.entries?.[codeForPrefecture(el("prefecture").value)]?.dataOrigin!=="MLIT_XIT001_API";
  el("historicalMedian").textContent=formatMan(historical.medianObservedYen);
  el("historicalRange").textContent=
    formatMan(historical.q25ObservedYen)+" 〜 "+formatMan(historical.q75ObservedYen);
  el("historicalCount").textContent=fmt(historical.count)+"件";
  el("historicalUnits").textContent=
    "観測取引の㎡単価の中央値："+formatMan(historical.medianUnitYen)+"/㎡。"+
    "過去取引の記述統計であり、個別物件の補正査定額ではありません。";
  el("historicalPeriod").textContent=
    "対象取引時期："+historical.oldestPeriod+"〜"+historical.newestPeriod;
  const body=el("historicalRows");
  body.replaceChildren();
  for(const r of historical.samples){
    const tr=document.createElement("tr");
    setCell(tr,r.district||"地区非公開");
    setCell(tr,fmt(r.area)+"㎡");
    setCell(tr,r.layout||"不明");
    setCell(tr,r.structure||"不明");
    setCell(tr,r.year+"年 Q"+r.quarter);
    setCell(tr,formatMan(r.priceYen));
    body.appendChild(tr);
  }
  el("historicalWarning").textContent=historical.label+
    " この地域は予測誤差の検証基準を満たしていないため、推定価格を表示しません。";
  section.scrollIntoView({behavior:"smooth",block:"start"});
}
function showMissing(reason) {
  el("historicalPanel").hidden=true;
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
  el("resultUpdateHint").hidden=true;
  const hasCore=(recordedCityCounts.get(q.prefecture+"|"+q.city)??0)>0;
  const tier=hasCore?null:extraCityTier(q.prefecture,q.city);
  const rows=cityRows(q.prefecture,q.city);
  if(!hasCore && tier?.tier==="OBSERVED_ONLY"){
    const historical=historicalObservations(rows,q);
    if(historical.ok)renderHistorical(historical,q);
    else showMissing(historical.reason);
    return;
  }
  if(!hasCore && tier?.tier!=="RESEARCH_BETA"){
    showMissing("この地域はモデルの検証基準に達していません。観測取引が5件以上集まるまで価格を表示しません。");
    return;
  }
  if(!rows.length){showMissing("公的取引データを読込めませんでした。");return;}
  const result=estimateFairValue(rows,q);
  if (result.ok) renderResult(result,q);
  else showMissing(result.reason);
}
async function initialize() {
  el("submitButton").disabled=true;
  el("estimateForm").addEventListener("submit",handleSubmit);
  el("estimateForm").addEventListener("input",invalidateDisplayedResults);
  el("estimateForm").addEventListener("change",invalidateDisplayedResults);
  mountAdvancedFilterIndicator();
  el("prefecture").addEventListener("change",refreshCity);
  el("city").addEventListener("change",refreshLocalFields);
  try {
    const response=await fetch("./data/transactions.json",{cache:"no-cache"});
    if (!response.ok) throw new Error("HTTP "+response.status);
    const parsed=await response.json();
    if (!Array.isArray(parsed.transactions)) throw new Error("invalid format");
    dataset=parsed;
    recordedCityCounts=observedCityCounts(dataset.transactions);
    try {
      const nationalResponse=await fetch("./data/national_catalog.json",{cache:"no-cache"});
      if(nationalResponse.ok){
        const candidate=await nationalResponse.json();
        if(validNationalCatalog(candidate)) nationwideCatalog=candidate;
      }
    } catch (_error) {nationwideCatalog=null;}
    try {
      const shardResponse=await fetch("./data/prefecture_shards/index.json",{cache:"no-cache"});
      if(shardResponse.ok){
        const candidate=await shardResponse.json();
        if(validShardIndex(candidate,dataset.metadata))shardIndex=candidate;
      }
    } catch (_error){shardIndex=null;}
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
    const validationResponse=await fetch("./data/validation.json",{cache:"no-cache"});
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
    const intervalResponse=await fetch("./data/interval_profiles.json",{cache:"no-cache"});
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
    const sourceCheckResponse=await fetch("./data/freshness.json",{cache:"no-cache"});
    if(sourceCheckResponse.ok) officialFreshness=await sourceCheckResponse.json();
  } catch (_error) { officialFreshness=null; }
  updateMeta();
  // The geographic layer is advisory only; a missing map never blocks pricing.
  mountAreaMap(dataset.transactions,dataset.metadata,nationwideCatalog).catch(()=>{});
}
initialize();
