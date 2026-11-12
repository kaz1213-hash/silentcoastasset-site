/**
 * v076: isolated, read-only 2026Q2 transaction overlay.
 * Never passes any Q2 row into the frozen reference-price model.
 * Each source file is SHA-256 verified before map or display.
 */
import {setQuarterAreaMapRows} from "./area_map_ui.mjs";
import {historicalObservations} from "./supplemental_prices.mjs";
import {formatMan} from "./estimator.mjs";

const $=id=>document.getElementById(id);
const count=n=>Number(n).toLocaleString("ja-JP");
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))]
 .map(b=>b.toString(16).padStart(2,"0")).join("");
let manifest=null;
const loaded=new Map(),inflight=new Map(),rejected=new Set();

function clearPrices(){
 $("q2Summary").hidden=true;
 $("q2Context").hidden=true;
 $("q2Context").textContent="";
 $("q2Rows").replaceChildren();
 $("q2Status").textContent="";
}
function status(text){
 $("q2Status").textContent=text;
}
function prefCode(name){
 return manifest?.prefectures?.[name]??"";
}
function syncQuarterDistricts(){
 if(!manifest)return;
 const code=prefCode($("prefecture").value),city=$("city").value;
 const selected=$("district");
 const rows=loaded.get(code)?.filter(r=>r.city===city)??[];
 const present=new Set([...selected.options].map(o=>o.value));
 for(const name of [...new Set(rows.map(r=>r.district).filter(Boolean))]){
  if(present.has(name))continue;
  selected.add(new Option(name,name));present.add(name);
 }
}
function renderCity(){
 if(!manifest)return;
 const pref=$("prefecture").value,city=$("city").value;
 const code=prefCode(pref);
 if(!code||!city){
  clearPrices();status("都道府県と市区町村を選択してください。");return;
 }
 if(rejected.has(code)){
  clearPrices();status("Q2の原本ハッシュを検証できませんでした。Q2表示を停止しました。");return;
 }
 if(!loaded.has(code)){
  clearPrices();status("2026年第2四半期の公表取引を検証して読み込んでいます。");
  void loadPrefecture(code);
  return;
 }
 const records=loaded.get(code).filter(r=>r.prefecture===pref&&r.city===city);
 syncQuarterDistricts();
 clearPrices();
 const where=pref+" "+city;
 if(!records.length){
  status(where+"：2026年第2四半期の収録取引はありません。既存の参考価格が最新相場を示すものではありません。");return;
 }
 const area=$("area").value;
 if(!area){
  status(where+"：2026年第2四半期の収録取引 "+count(records.length)+
   "件。専有面積を入力すると、条件が近い公表取引（5件以上の場合のみ）を表示します。");
  return;
 }
 const query={
  prefecture:pref,city,district:$("district").value,
  area,station:$("station").value,
  ageYears:$("ageYears").value===""?null:Number($("ageYears").value),
  layout:$("layout").value,structure:$("structure").value
 };
 const result=historicalObservations(records,query);
 const basis=[
  pref+" "+city,
  "取引時期 2026年4〜6月",
  "専有面積 "+count(Number(area))+"㎡（比較対象は±25%）",
  query.district?"地区 "+query.district:"市区町村全域",
  query.ageYears==null?"":"築年数 "+count(query.ageYears)+"年",
  query.station?"指定駅 "+query.station:""
 ].filter(Boolean).join(" ／ ");
 if(!result.ok){
  const hasUnavailableStation=manifest.entries[code]?.source==="MLIT_XIT001_API"&&Boolean(query.station);
  status(where+"：Q2の市区町村内記録 "+count(records.length)+"件。"+
   "入力条件に近いQ2の記録は"+count(result.observedCount??0)+
   "件です。5件未満なので価格や個別事例は表示しません。"+
   (hasUnavailableStation?" 国交省APIのこの地域のQ2データには駅名がないため、駅指定では比較できません。駅の絞り込みを解除すると件数を確認できます。":""));
  return;
 }
 status(where+"：Q2の市区町村内記録 "+count(records.length)+"件。"+
  "条件に近い公表取引 "+count(result.count)+"件（現時点の査定ではありません）。");
 $("q2Context").textContent=basis+" ／ 比較できた公表取引 "+count(result.count)+"件";
 $("q2Context").hidden=false;
 $("q2Median").textContent=formatMan(result.medianObservedYen);
 $("q2Band").textContent=formatMan(result.q25ObservedYen)+" ～ "+formatMan(result.q75ObservedYen);
 $("q2Count").textContent=count(result.count)+"件";
 const body=$("q2Rows");body.replaceChildren();
 for(const r of result.samples){
  const tr=document.createElement("tr");
  for(const s of [r.district||"地区非公開",count(r.area)+"㎡",
     String(r.year)+"年Q"+String(r.quarter),formatMan(r.priceYen)]){
    const td=document.createElement("td");td.textContent=s;tr.append(td);
  }
  body.append(tr);
 }
 $("q2Summary").hidden=false;
}

// Adds Q2 records to the *map's descriptive* rows, never to app.mjs datasets.
// Never mark a sparse individual district as an actual sale pin.
async function loadPrefecture(code){
 if(loaded.has(code)||rejected.has(code))return;
 if(inflight.has(code))return inflight.get(code);
 const task=(async()=>{
  try{
   const entry=manifest.entries[code];
   if(entry.file!=="data/q2_transactions/pref_"+code+".json")throw Error("Unexpected Q2 filename");
   const reply=await fetch("./"+entry.file,{cache:"no-store"});
   if(!reply.ok)throw Error("Q2 source missing");
   const bytes=await reply.arrayBuffer();
   if(await sha(bytes)!==entry.sha256)throw Error("Q2 integrity failed");
   const doc=JSON.parse(new TextDecoder("utf-8").decode(bytes));
   if(doc.schema!=="tanuki-q2-research-overlay-v076"||doc.period!=="2026Q2"||
      doc.prefectureCode!==code||doc.transactions.length!==entry.count||
      doc.sourceCandidateSha256!==entry.sourceCandidateSha256)
     throw Error("Unexpected Q2 source generation");
   const pref=Object.entries(manifest.prefectures).find(([,v])=>v===code)?.[0];
   if(!pref||doc.transactions.some(r=>r.prefecture!==pref||
       r.municipalityCode?.slice(0,2)!==code||r.year!==2026||r.quarter!==2||
       r.category!=="condo"||!Number.isFinite(r.priceYen)||r.priceYen<=0||
       !Number.isFinite(r.area)||r.area<15||r.area>300))
     throw Error("Q2 source contains invalid official observation");
   loaded.set(code,doc.transactions);
   syncQuarterDistricts();
   setQuarterAreaMapRows(doc.transactions,code);
  }catch(_err){rejected.add(code);}
  finally{
   inflight.delete(code);
   if(prefCode($("prefecture").value)===code)renderCity();
  }
 })();
 inflight.set(code,task);
 return task;
}
function bootListeners(){
 const rerender=()=>queueMicrotask(renderCity);
 for(const key of ["prefecture","city","district","station","area",
                   "ageYears","layout","structure"]){
  const node=$(key);
  node.addEventListener(node.tagName==="INPUT"?"input":"change",rerender);
 }
 // The frozen-model app may repopulate district options after lazy shard load.
 // Q2-only new district options are added without selecting them or training.
 const watch=new MutationObserver(syncQuarterDistricts);
 watch.observe($("district"),{childList:true});
}
async function init(){
 bootListeners();
 try{
  const r=await fetch("./data/q2_transactions/index.json",{cache:"no-store"});
  if(!r.ok)throw Error("Q2 manifest missing");
  const index=await r.json();
  if(index.schema!=="tanuki-q2-research-index-v076"||index.period!=="2026Q2"||
     index.priorPublishedRows!==167559||index.newRows!==5763||
     Object.keys(index.entries??{}).length!==47||
     Object.keys(index.prefectures??{}).length!==47||
     Object.values(index.entries).reduce((n,e)=>n+e.count,0)!==5763)
    throw Error("Q2 manifest audit failed");
  manifest=index;
  $("q2NationalCount").textContent=count(index.newRows);
  // The app initializes these fields asynchronously.
  const select=$("prefecture");
  const observer=new MutationObserver(()=>{
   if(select.options.length>=48){observer.disconnect();renderCity();}
  });
  observer.observe(select,{childList:true});
  if(select.options.length>=48){observer.disconnect();renderCity();}
 }catch(_err){
  clearPrices();
  status("研究用Q2資料を確認できないため、更新データは表示していません。");
 }
}
init();
