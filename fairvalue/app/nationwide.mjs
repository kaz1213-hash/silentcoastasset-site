/**
 * Geographic coverage for all 47 prefectures and 1,905 N03 municipal units.
 * This is NOT a statement that all municipalities have price observations.
 * Price eligibility is derived from loaded MLIT rows and local model gates.
 */
export function validNationalCatalog(value){
  if(value?.metadata?.schema!=="tanuki-national-catalog-v1"||
     !Array.isArray(value.prefectures)||value.prefectures.length!==47) return false;
  const codes=new Set();
  for(const pref of value.prefectures){
    if(!/^\d{2}$/.test(pref?.code)||!pref.name||
       !Array.isArray(pref.municipalities))return false;
    for(const city of pref.municipalities){
      if(!/^\d{5}$/.test(city?.code)||city.code.slice(0,2)!==pref.code||!city.name||
         codes.has(city.code))return false;
      codes.add(city.code);
    }
  }
  return codes.size===1905;
}
export function findNationLocation(catalog,prefecture,cityName){
  const pref=catalog?.prefectures?.find(p=>p.name===prefecture);
  if(!pref)return null;
  const municipality=pref.municipalities?.find(c=>c.code===cityName) ??
    pref.municipalities?.find(c=>c.name===cityName);
  return municipality?{prefecture,city:municipality.name,code:municipality.code,prefCode:pref.code}:null;
}
export function sortedPrefectures(catalog){
  return (catalog?.prefectures??[]).map(p=>p.name);
}
export function listedCities(catalog,prefecture){
  const pref=catalog?.prefectures?.find(p=>p.name===prefecture);
  return (pref?.municipalities??[]).map(c=>c.name);
}
/**
 * Classify every official municipal option without inventing price coverage.
 * A core CSV municipality always keeps its reviewed research tier; API-only
 * tier metadata never grants forecasts. Grouping is an immediate index lookup,
 * not a request for the (potentially 15 MB) prefecture transaction file.
 */
export function cityCoverageGroups(catalog,prefecture,coreCounts,shardIndex){
  const pref=catalog?.prefectures?.find(p=>p.name===prefecture);
  const groups=[
    {tier:"RESEARCH",label:"参考価格の研究版",cities:[]},
    {tier:"OBSERVED_ONLY",label:"過去取引実績のみ",cities:[]},
    {tier:"SPARSE_ONLY",label:"取引件数不足・金額非表示",cities:[]},
    {tier:"MAP_ONLY",label:"価格未収録・地図のみ",cities:[]}
  ];
  if(!pref)return groups;
  const repetitions=new Map();
  for(const city of pref.municipalities)
    repetitions.set(city.name,(repetitions.get(city.name)??0)+1);
  for(const city of pref.municipalities){
    const cityCount=coreCounts?.get(prefecture+"|"+city.name)??0;
    const shard=shardIndex?.entries?.[pref.code]?.cityTiers?.[city.name];
    const tier=cityCount>0||shard?.tier==="RESEARCH_BETA"?"RESEARCH":
      shard?.tier==="OBSERVED_ONLY"?"OBSERVED_ONLY":
      shard?.tier==="SPARSE_ONLY"?"SPARSE_ONLY":"MAP_ONLY";
    const ambiguous=(repetitions.get(city.name)??0)>1;
    groups.find(g=>g.tier===tier).cities.push({
      name:city.name,code:city.code,
      value:ambiguous?city.code:city.name,
      label:ambiguous?city.name+"（行政コード "+city.code+"）":city.name
    });
  }
  return groups;
}
export function observedCityCounts(records){
  const counts=new Map();
  for(const r of records||[]){
    if(!r?.prefecture||!r?.city||r.category!=="condo")continue;
    const key=r.prefecture+"|"+r.city;
    counts.set(key,(counts.get(key)??0)+1);
  }
  return counts;
}
export function cityDataState(countMap,prefecture,city){
  if(!prefecture||!city)return {state:"SELECT_CITY",count:0,
    message:"市区町村を選ぶと、行政区域の地図を確認できます。"};
  const count=countMap.get(prefecture+"|"+city)??0;
  if(count===0)return {state:"MAP_ONLY",count,
    message:"この市区町村の取引価格データはまだ取り込んでいません。行政区域の地図のみ表示できます。金額は算出しません。"};
  return {state:"PRICE_DATA",count,
    message:"この地域の公表取引："+count.toLocaleString("ja-JP")+"件。データが足りない物件では参考価格を表示しません。"};
}
export function validatePrefGeometry(document,catalog,prefCode){
  const pref=catalog?.prefectures?.find(p=>p.code===prefCode);
  if(!pref||document?.schema!=="tanuki-n03-prefecture-v1"||
      document.prefectureCode!==prefCode||
      document.sourceSha256!==catalog.metadata.sourceSha256)return false;
  const values=document.cities;
  if(!values||typeof values!=="object")return false;
  return pref.municipalities.every(m=>values[m.code]?.city===m.name&&
    values[m.code]?.prefecture===pref.name&&
    ["Polygon","MultiPolygon"].includes(values[m.code]?.geometry?.type));
}
