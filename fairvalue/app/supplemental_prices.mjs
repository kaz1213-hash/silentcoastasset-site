/**
 * Lazy prefecture price supplements: never overwrite the 15 verified core cities.
 *
 * Source CSV is public MLIT condominium transaction data, *not* market prices
 * or dealer direct-buy bids. New-city categories:
 *  RESEARCH_BETA: v0.2 model with >=80 past forecasts and interval coverage gate.
 *  OBSERVED_ONLY: >=5 public transactions; show descriptive distribution only.
 *  SPARSE_ONLY: fewer than 5 transactions; no individual value.
 */
import {layoutClass,structureClass} from "./property_features.mjs";
export const SHARD_SCHEMA="tanuki-prefecture-supplement-v1";
export const SHARD_INDEX_SCHEMA="tanuki-prefecture-shard-index-v1";
const TIERS=new Set(["RESEARCH_BETA","OBSERVED_ONLY","SPARSE_ONLY"]);
const median=(values)=>values[Math.floor((values.length-1)/2)];
const quartile=(values,part)=>values[Math.floor((values.length-1)*part)];

export function validShardIndex(index,coreMetadata){
  if(index?.schema!==SHARD_INDEX_SCHEMA||
     index.legacySourceFingerprint!==coreMetadata?.sourceFingerprint||
     index.legacyCount!==coreMetadata?.count || !index.entries)return false;
  for(const [code,entry] of Object.entries(index.entries)){
    if(entry.geoFile!=="data/prefecture_shards/town_"+code+".json"||
       !/^[0-9a-f]{64}$/.test(entry.geoSha256))return false;
    if(!/^\d{2}$/.test(code)||entry.file!=="data/prefecture_shards/"+code+".json"||
       !entry.sourceFingerprint||!Number.isInteger(entry.additionalRows)||entry.additionalRows<0||
       !entry.cityTiers)return false;
    if(entry.dataOrigin!=null && entry.dataOrigin!=="MLIT_XIT001_API")return false;
    if(entry.dataOrigin==="MLIT_XIT001_API" &&
       (entry.priceDataCities!==0||Object.values(entry.cityTiers).some(e=>
         e.tier==="RESEARCH_BETA"||e.validated===true)))return false;
    if(entry.latestObservationPeriod!==undefined &&
       (!/^2026Q[2-4]$/.test(entry.latestObservationPeriod)||
        !/^[0-9a-f]{64}$/.test(entry.latestQuarterReceiptSha256||"")))return false;
    if(entry.supplementScope==="UNPRICED_MUNICIPALITIES_ONLY"){
      if(entry.dataOrigin!=="MLIT_XIT001_API"||
         !Array.isArray(entry.excludedCoreMunicipalityCodes)||
         entry.excludedCoreMunicipalityCodes.length===0 ||
         !Number.isInteger(entry.excludedCoreApiObservations)||
         entry.excludedCoreApiObservations<1 ||
         Object.values(entry.cityTiers).some(e=>
           entry.excludedCoreMunicipalityCodes.includes(e.cityCode)))return false;
    }else if(entry.supplementScope && entry.supplementScope!=="PREFECTURE_WITHOUT_CORE")
      return false;
    for(const e of Object.values(entry.cityTiers)){
      if(!TIERS.has(e.tier)||!Number.isInteger(e.rows)||e.rows<1)return false;
      if(e.tier!=="SPARSE_ONLY"&&e.rows<5)return false;
    }
  }
  return true;
}

export function validateSupplement(document,entry,coreMetadata,coreCityKeys,nationwideCatalog){
  if(document?.schema!==SHARD_SCHEMA||
     document?.metadata?.legacySourceFingerprint!==coreMetadata?.sourceFingerprint ||
     document?.metadata?.prefectureSourceFingerprint!==entry?.sourceFingerprint||
     document?.metadata?.additionalRows!==entry?.additionalRows ||
     !Array.isArray(document.transactions)||
     document.transactions.length!==entry.additionalRows||
     JSON.stringify(document.metadata.cities)!==JSON.stringify(entry.cityTiers))return false;
  if(entry.dataOrigin==="MLIT_XIT001_API" &&
    (document.metadata.dataOrigin!==entry.dataOrigin||
     document.metadata.stationFeaturesUnavailable!==true||
     document.metadata.isNationwideAppraisal!==false||
     Object.values(entry.cityTiers).some(e=>e.tier==="RESEARCH_BETA"||e.validated===true)))return false;
  const lastApi=entry.latestObservationPeriod||"2026Q1";
  const maxApiQuarter=2026*4+Number(lastApi.slice(-1));
  if(entry.dataOrigin==="MLIT_XIT001_API" &&
     (document.metadata.periodMax!==lastApi ||
      (entry.latestObservationPeriod &&
       (document.metadata.quarterlyReviewStatus!=="OFFICIAL_OBSERVATIONS_ONLY" ||
        document.metadata.latestQuarterReceiptSha256!==entry.latestQuarterReceiptSha256))))
    return false;
  const allCities=nationwideCatalog?.prefectures?.find(p=>
    p.code===document.metadata.prefectureCode)?.municipalities??[];
  const validCities=new Map(allCities.map(c=>[c.name,c.code]));
  if(entry.supplementScope==="UNPRICED_MUNICIPALITIES_ONLY"){
    const protectedCodes=entry.excludedCoreMunicipalityCodes;
    if(JSON.stringify(protectedCodes)!==JSON.stringify(document.metadata.excludedCoreMunicipalityCodes)||
       document.metadata.supplementScope!==entry.supplementScope ||
       entry.excludedCoreApiObservations!==document.metadata.excludedCoreApiObservations||
       document.metadata.sourceTotal!==entry.additionalRows+entry.excludedCoreApiObservations||
       !protectedCodes.every(code=>allCities.some(c=>c.code===code &&
           coreCityKeys.has(entry.prefecture+"|"+c.name))))return false;
  }
  const seen=new Map();
  for(const record of document.transactions){
    if(record.category!=="condo"||
       record.prefecture!==entry.prefecture ||
       coreCityKeys.has(record.prefecture+"|"+record.city)||
       (entry.supplementScope==="UNPRICED_MUNICIPALITIES_ONLY" &&
         entry.excludedCoreMunicipalityCodes.includes(record.municipalityCode))||
       !record.city || !validCities.has(record.city) ||
       record.municipalityCode!==validCities.get(record.city) ||
       !Number.isFinite(record.priceYen)||
       !Number.isFinite(record.area)||record.area<15||record.area>300)return false;
    if(entry.dataOrigin==="MLIT_XIT001_API" &&
      (record.station||record.stationMinutes!=null||
       !Number.isInteger(record.year)||record.year<2023||record.year>2026||
       !Number.isInteger(record.quarter)||record.quarter<1||record.quarter>4||
       record.year*4+record.quarter>maxApiQuarter))return false;
    seen.set(record.city,(seen.get(record.city)??0)+1);
  }
  for(const [city,info] of Object.entries(entry.cityTiers)){
    if(seen.get(city)!==info.rows)return false;
    const validation=document.validation?.byMunicipality?.[entry.prefecture+" "+city];
    if(info.tier==="RESEARCH_BETA" && !(validation?.evaluated>=80 &&
       validation.sufficientForDisplay))return false;
  }
  return seen.size===Object.keys(entry.cityTiers).length;
}

export function shardTier(index,prefecture,city,nationalCatalog){
  const pref=nationalCatalog?.prefectures?.find(item=>item.name===prefecture);
  if(!pref)return null;
  return index?.entries?.[pref.code]?.cityTiers?.[city]??null;
}

function sameText(a,b){
  return String(a??"").normalize("NFKC").replace(/\s+/g,"")===
    String(b??"").normalize("NFKC").replace(/\s+/g,"");
}
export function historicalObservations(rows,q){
  const area=Number(q?.area);
  if(!q?.prefecture||!q?.city||!Number.isFinite(area)||area<15||area>300)
    return {ok:false,reason:"都道府県・市区町村と専有面積を正しく指定してください。"};
  const comparable=(rows??[]).filter(r=>{
    if(r.prefecture!==q.prefecture||r.city!==q.city||
       r.category!=="condo"||!Number.isFinite(Number(r.priceYen))||
       !Number.isFinite(Number(r.area))||Number(r.priceYen)<=0)return false;
    const rel=Number(r.area)/area;
    if(rel<.75||rel>1.25)return false;
    if(q.district && !sameText(q.district,r.district))return false;
    if(q.station && !sameText(q.station,r.station))return false;
    if(q.ageYears!==null&&q.ageYears!==""&&q.ageYears!==undefined &&
       (r.ageYears==null||Math.abs(Number(r.ageYears)-Number(q.ageYears))>10))
      return false;
    if(q.layout && layoutClass(r.layout)!==layoutClass(q.layout))return false;
    if(q.structure && structureClass(r.structure)!==structureClass(q.structure))return false;
    return true;
  });
  if(comparable.length<5)return {
    ok:false,observedCount:comparable.length,
    reason:"指定条件に近い過去の公表取引は"+comparable.length+
      "件です。5件未満のため価格の集計は表示できません。駅・築年・間取りなどの条件を見直してください。"
  };
  const prices=comparable.map(r=>Number(r.priceYen)).sort((a,b)=>a-b);
  const units=comparable.map(r=>Number(r.priceYen)/Number(r.area)).sort((a,b)=>a-b);
  const newest=Math.max(...comparable.map(r=>r.year*4+r.quarter-1));
  const oldest=Math.min(...comparable.map(r=>r.year*4+r.quarter-1));
  const periodLabel=p=>Math.floor(p/4)+"年第"+(p%4+1)+"四半期";
  return {
    ok:true,count:comparable.length,
    medianObservedYen:median(prices),
    q25ObservedYen:quartile(prices,.25),
    q75ObservedYen:quartile(prices,.75),
    medianUnitYen:median(units),
    q25UnitYen:quartile(units,.25),
    q75UnitYen:quartile(units,.75),
    oldestPeriod:periodLabel(oldest),newestPeriod:periodLabel(newest),
    samples:comparable.slice().sort((a,b)=>
       (b.year*4+b.quarter)-(a.year*4+a.quarter))
       .slice(0,8).map(r=>({
          district:r.district,area:r.area,priceYen:r.priceYen,
          year:r.year,quarter:r.quarter,layout:r.layout,structure:r.structure,
          station:r.station
       })),
    label:"これは過去の取引価格の記述統計。物件の売却予想額・80%予測帯・現在の業者買取額ではありません。面積±25%以内の複数の異なる物件を含みます。"
  };
}

export function validateSupplementTownGeo(document,entry,legacyMetadata,nationCatalog){
  if(document?.schema!=="tanuki-prefecture-abrtown-v1"||
     document?.metadata?.prefecturePriceSourceFingerprint!==entry?.sourceFingerprint ||
     document?.metadata?.legacySourceFingerprint!==legacyMetadata?.sourceFingerprint||
     !document?.cities)return false;
  const prefCode=nationCatalog?.prefectures?.find(p=>p.name===entry.prefecture)?.code;
  if(document.metadata.prefectureCode!==prefCode)return false;
  const cityCodes=Object.fromEntries(Object.entries(entry.cityTiers).map(([name,v])=>[v.cityCode,name]));
  if(Object.keys(document.cities).length!==Object.keys(cityCodes).length)return false;
  for(const [code,record] of Object.entries(document.cities)){
    if(cityCodes[code]!==record.name||!record.districtPoints)return false;
    for(const pos of Object.values(record.districtPoints)){
      if(!Number.isFinite(pos.lat)||!Number.isFinite(pos.lon)||
         pos.lon<122||pos.lon>155||pos.lat<24||pos.lat>46 ||
         !String(pos.pointType||"").includes("実物件の位置ではありません"))return false;
    }
  }
  return true;
}
