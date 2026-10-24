/**
 * TANUKI FairValue offline-first area map (v0.4.6).
 *
 * Municipality outline = MLIT N03 2026 administrative boundary.
 * Each marker = Digital Agency ABR *town reference point*, NOT actual sale location.
 * Marker value = aggregated ≥5 public condo transactions in that district.
 * No external map tiles, reverse geocoding, cookies, telemetry or API calls.
 */
import {statsForMunicipality,mapViewBounds,mapProjection,geometryPath,districtKey,quartile}
  from "./area_map_stats.mjs";
import {focusUrbanBounds,roadSvgPath,roadColor,gsiTilePlan} from "./street_basemap.mjs";
import {findNationLocation,validatePrefGeometry} from "./nationwide.mjs";

const SVG_NS="http://www.w3.org/2000/svg";
const el=id=>document.getElementById(id);
const format=n=>Number(n).toLocaleString("ja-JP");
const unit=n=>Number(n).toLocaleString("ja-JP",{maximumFractionDigits:1})+"万円/㎡";
const volume=n=>format(n)+"件";
const palette=["#cbdcd5","#91b8a8","#508477","#215849"];
const CITY_PREFIX="地区の代表点に、過去の地区単位の公表取引を集計しています。";
let records=[],sourceMetadata=null,geo=null,zoom="areas",selected="",lastStats=null,lastCity="";
let streetData=null,basemap="local";
let nationwideCatalog=null;
const prefectShapeCache=new Map(),prefectShapePromises=new Map(),shapeFailed=new Set();
function nationwideCityEntry(prefecture,cityName) {
  const region=findNationLocation(nationwideCatalog,prefecture,cityName);
  if(!region)return null;
  if(prefectShapeCache.has(region.prefCode)){
    const source=prefectShapeCache.get(region.prefCode)?.cities?.[region.code];
    return source?[region.code,{...source,districtPoints:{}}]:null;
  }
  if(shapeFailed.has(region.prefCode))return null;
  if(!prefectShapePromises.has(region.prefCode)){
    const prefCode=region.prefCode;
    const job=fetch("./data/national_shapes/"+prefCode+".json",{cache:"no-store"})
      .then(async response=>{
        if(!response.ok)throw Error("HTTP "+response.status);
        const parsed=await response.json();
        if(!validatePrefGeometry(parsed,nationwideCatalog,prefCode))
          throw Error("Municipality shape source invalid");
        prefectShapeCache.set(prefCode,parsed);
      })
      .catch(_error=>{shapeFailed.add(prefCode);})
      .finally(()=>{
        prefectShapePromises.delete(prefCode);
        // Use selected city at the time of completion; no stale country change.
        render();
      });
    prefectShapePromises.set(prefCode,job);
  }
  return {pending:true};
}
function warning(text){el("areaMapWarning").textContent=text;}
function emptyDisplay(message){
  el("areaMapCityName").textContent="地図データを確認してください";
  el("areaMapTotal").textContent="—";
  el("areaMapStatus").textContent=message;
  el("areaMapLegend").textContent=message;
  el("areaMapDistrictList").replaceChildren();
  el("areaMapMarkers").replaceChildren();
  el("areaMapSvg").replaceChildren();
  el("areaMapSelected").textContent="地域を選ぶと公表取引の集計を表示します。";
  el("areaMapAnalyze").disabled=true;
  warning(message.replace(/。+$/,"")+"。個々の売買物件の位置を推定して表示することはありません。");
}
function readFilters(){
  return {
    area:el("area").value,
    station:el("station").value,
    ageYears:el("ageYears").value,
    layout:el("layout").value,
    structure:el("structure").value,
  };
}
function create(tag,cls,text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function svgNode(tag,attributes={}){
  const node=document.createElementNS(SVG_NS,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
}
function offlineRoads(root,project,code,bounds){
  const source=streetData?.cities?.[code];
  if(!source?.roads?.length)return false;
  const group=svgNode("g",{class:"map-road-network"});
  const roads=source.roads;
  let visible=0;
  for(const road of roads){
    if(!road.coordinates?.some(([lon,lat])=>
      lon>=bounds.minLon-.01&&lon<=bounds.maxLon+.01&&
      lat>=bounds.minLat-.01&&lat<=bounds.maxLat+.01))continue;
    const d=roadSvgPath(road,project);
    if(!d)continue;
    const style=roadColor(road.kind);
    group.appendChild(svgNode("path",{d,stroke:style.color,
      "stroke-width":style.width,fill:"none",
      "stroke-linejoin":"round","stroke-linecap":"round"}));
    visible++;
  }
  root.appendChild(group);
  const labelLayer=svgNode("g",{class:"map-offline-labels"});
  const occupied=[];
  for(const station of source.stations||[]){
    const pos=project(station.lon,station.lat);
    if(pos.x<25||pos.x>680||pos.y<20||pos.y>480)continue;
    labelLayer.appendChild(svgNode("circle",{
      cx:pos.x,cy:pos.y,r:4,fill:"#245b98",stroke:"#fff","stroke-width":2
    }));
    const tag=svgNode("text",{x:pos.x+7,y:pos.y-8,class:"map-station-label"});
    tag.textContent=station.name;
    labelLayer.appendChild(tag);
    occupied.push(pos);
  }
  const names=new Map();
  for(const road of roads){
    if(!road.name||!["motorway","trunk","primary","secondary","tertiary"].includes(road.kind))continue;
    const within=road.coordinates.filter(([lon,lat])=>
      lon>=bounds.minLon&&lon<=bounds.maxLon&&lat>=bounds.minLat&&lat<=bounds.maxLat);
    if(within.length<3)continue;
    if(!names.has(road.name)||within.length>names.get(road.name).length)names.set(road.name,within);
  }
  let shown=0;
  for(const [name,points] of [...names].sort((a,b)=>b[1].length-a[1].length)){
    if(shown>=13)break;
    const [lon,lat]=points[Math.floor(points.length/2)],pos=project(lon,lat);
    if(pos.x<35||pos.x>670||pos.y<20||pos.y>470)continue;
    if(occupied.some(o=>Math.abs(o.x-pos.x)<82&&Math.abs(o.y-pos.y)<23))continue;
    const tag=svgNode("text",{x:pos.x,y:pos.y,class:"map-road-label"});
    tag.textContent=name;
    labelLayer.appendChild(tag);
    occupied.push(pos);
    shown++;
  }
  root.appendChild(labelLayer);
  return visible>0;
}
function gsiImageTiles(root,bounds,project){
  const group=svgNode("g",{class:"map-gsi-tiles"});
  for(const tile of gsiTilePlan(bounds,project)){
    group.appendChild(svgNode("image",{
      x:tile.svgX.toFixed(2),y:tile.svgY.toFixed(2),
      width:tile.svgWidth.toFixed(2),height:tile.svgHeight.toFixed(2),
      preserveAspectRatio:"none",href:tile.uri
    }));
  }
  root.appendChild(group);
}
function drawBaseShape(geometry,project,code,bounds,stats){
  const root=el("areaMapSvg");
  root.replaceChildren();
  root.appendChild(svgNode("rect",{width:720,height:500,fill:"#eef2ed"}));
  if(basemap==="gsi")gsiImageTiles(root,bounds,project);
  const path=svgNode("path",{
    d:geometryPath(geometry,project),
    fill:basemap==="gsi"?"rgba(217,231,220,.02)":"#d9e7dc",
    "fill-rule":"evenodd",
    stroke:basemap==="gsi"?"#43856b":"#7d9e88",
    "stroke-width":basemap==="gsi"?1.4:1.5,
    "stroke-linejoin":"round"
  });
  root.appendChild(path);
  const haveRoads=basemap==="local"&&offlineRoads(root,project,code,bounds);
  if(basemap==="local"&&!haveRoads){
    const occupied=[];
    for(const item of stats.districts){
      if(occupied.length>=15)break;
      const pos=project(item.lon,item.lat);
      if(pos.x<24||pos.x>680||pos.y<20||pos.y>480)continue;
      if(occupied.some(o=>Math.abs(o.x-pos.x)<88&&Math.abs(o.y-pos.y)<26))continue;
      const txt=svgNode("text",{x:pos.x,y:pos.y,class:"map-town-label"});
      txt.textContent=item.district;
      root.appendChild(txt);
      occupied.push(pos);
    }
  }
  return haveRoads;
}
function valueFor(item,metric){
  return metric==="volume"?item.count:item.unitMan;
}
function categoryColor(value,thresholds){
  let bucket=0;
  for(let i=0;i<thresholds.length;i++)if(value>thresholds[i])bucket++;
  return palette[Math.min(palette.length-1,bucket)];
}
function createMarker(item,project,thresholds,metric,isSelected){
  const pos=project(item.lon,item.lat);
  if(pos.x<-30||pos.x>750||pos.y<-30||pos.y>530)return null;
  const button=create("button","area-map-dot"+(isSelected?" selected":""));
  button.type="button";button.dataset.district=item.district;
  button.style.left=(pos.x/720*100)+"%";
  button.style.top=(pos.y/500*100)+"%";
  button.style.setProperty("--point-color",categoryColor(valueFor(item,metric),thresholds));
  button.style.setProperty("--point-size",(Math.min(24,10+Math.sqrt(item.count)*1.65))+"px");
  button.title=item.district+"｜取引"+volume(item.count)+"／過去の㎡単価中央値 "+unit(item.unitMan)+"｜町字代表点";
  button.setAttribute("aria-label",button.title);
  button.addEventListener("click",()=>selectDistrict(item.district));
  return button;
}
function selectDistrict(name){
  selected=name;
  const box=el("district");
  const option=[...box.options].find(opt=>districtKey(opt.value)===name);
  if(option)box.value=option.value;
  // Invokes app's own selectors but does not send or submit search.
  box.dispatchEvent(new Event("change",{bubbles:true}));
}
function selectedDetails(items){
  const block=el("areaMapSelected");
  block.replaceChildren();
  const item=items.find(r=>r.district===selected)??null;
  const analyze=el("areaMapAnalyze");
  if(!item){
    block.appendChild(create("p","area-map-empty-info",
      selected?"この地区は、現在の表示条件では公表取引5件以上の基準を満たしません。":
      "地区の丸印または右の一覧から選ぶと、取引件数と㎡単価を確認できます。"));
    analyze.disabled=true;
    return;
  }
  block.appendChild(create("p","area-map-selected-label","選択中の地区"));
  block.appendChild(create("h3","",item.district));
  const dl=create("dl","area-map-info-dl");
  for(const [label,value] of [
    ["公表取引",volume(item.count)],
    ["㎡単価の中央値",unit(item.unitMan)],
    ["㎡単価の中間50%",unit(item.unitQ25Man)+" 〜 "+unit(item.unitQ75Man)],
    ["取引総額の中央値",format(item.totalMedianMan)+"万円"]
  ]){
    dl.appendChild(create("dt","",label));dl.appendChild(create("dd","",value));
  }
  block.appendChild(dl);
  block.appendChild(create("p","area-map-location-note",
    "位置はデジタル庁ABRの町字代表点です。物件の位置ではありません。"));
  const area=Number(el("area").value);
  analyze.disabled=!Number.isFinite(area)||area<15||area>300;
  analyze.textContent=analyze.disabled?"専有面積を入力すると価格を確認できます":"この地区の参考価格を確認する";
}
function renderDistrictList(items,metric){
  const list=el("areaMapDistrictList");
  list.replaceChildren();
  if(!items.length){
    list.appendChild(create("p","area-map-empty-info",
      "件数が5件以上で地理的な代表点が確認できる地区がありません。検索条件を緩めてください。"));
    return;
  }
  for(const district of items){
    const button=create("button","area-map-list-item"+(selected===district.district?" selected":""));
    button.type="button";
    button.dataset.district=district.district;
    const name=create("span","",district.district);
    const value=create("strong","",metric==="volume"?volume(district.count):unit(district.unitMan));
    const sub=create("small","","公表取引 "+volume(district.count));
    button.append(name,value,sub);
    button.addEventListener("click",()=>selectDistrict(district.district));
    list.appendChild(button);
  }
}
function legend(metric,items,thresholds,stats){
  const panel=el("areaMapLegend");panel.replaceChildren();
  const title=create("span","area-map-legend-title",
    metric==="volume"?"色：地区の取引件数":"色：過去に公表された地区の㎡単価中央値");
  panel.appendChild(title);
  if(items.length){
    for(let i=0;i<palette.length;i++){
      const sample=create("span","area-map-legend-step");
      const dot=create("i","");
      dot.style.backgroundColor=palette[i];
      const min=i===0?Math.min(...items.map(d=>valueFor(d,metric))):thresholds[i-1];
      const max=i===palette.length-1?Math.max(...items.map(d=>valueFor(d,metric))):thresholds[i];
      sample.append(dot,create("small","",metric==="volume"?
        format(min)+"〜"+format(max)+"件":Math.round(min)+"〜"+Math.round(max)+"万円/㎡"));
      panel.appendChild(sample);
    }
  }
  panel.appendChild(create("span","area-map-legend-disclaimer",
    "丸印の大きさ＝取引件数。色は"+(metric==="volume"?"件数":"㎡単価")+"。個別物件の位置ではありません。"));
}
function render(){
  if(!geo)return;
  const cityName=el("city").value,pref=el("prefecture").value;
  let cityEntry=Object.entries(geo.cities).find(([,v])=>v.prefecture===pref&&v.city===cityName);
  if(!cityEntry) {
    const fallback=nationwideCityEntry(pref,cityName);
    if(fallback?.pending){
      emptyDisplay("全国行政区域を読み込んでいます。");
      el("areaMapCityName").textContent=pref+" "+cityName;
      return;
    }
    cityEntry=Array.isArray(fallback)?fallback:null;
  }
  if(!cityEntry){
    emptyDisplay(cityName?"行政区域データが利用できません。":"市区町村を選択してください。");
    return;
  }
  const [code,city]=cityEntry;
  if(lastCity!==code){lastCity=code;zoom="areas";selected="";}
  const value=el("district").value;
  const formDistrict=districtKey(value);
  if(value&&formDistrict)selected=formDistrict;
  const stats=statsForMunicipality(records,city,readFilters());
  lastStats=stats;
  el("areaMapCityName").textContent=pref+" "+cityName;
  const noPrices=stats.totalCityRecords===0;
  el("areaMapTotal").textContent=noPrices?"価格未収録":volume(stats.plottedRecords);
  el("areaMapStatus").textContent=noPrices
    ?"全国の行政区域は表示できますが、この地域の公表取引価格はまだ取得していません。"
    :"地区数 "+format(stats.districtCount)+
    "／現在の条件に合う公表取引 "+volume(stats.filteredRecords)+
    "。位置・5件基準を満たす取引を地図表示。";
  el("areaMapZoom").textContent=zoom==="areas"?"市区全体を見る":"地区の集中部を見る";
  const bounds=focusUrbanBounds(city.geometry,stats.districts,code,zoom,streetData);
  const project=mapProjection(bounds);
  if(!project){
    emptyDisplay("境界データを投影できません。");
    return;
  }
  const hasOfflineRoads=drawBaseShape(city.geometry,project,code,bounds,stats);
  const basemapSwitch=el("areaMapBasemap");
  basemapSwitch.setAttribute("aria-pressed",String(basemap==="gsi"));
  basemapSwitch.textContent=basemap==="gsi"?"ローカル地図に戻る":"地理院の道路地図（通信あり）";
  const text=basemap==="gsi"
    ?"国土地理院の地図を表示中。タイルの取得先に表示範囲が送信されます。"
    :hasOfflineRoads
      ?"道路・駅名はローカル保存のOpenStreetMapデータ（外部通信なし）。地理院の道路地図への切替時だけ表示範囲が送信されます。"
      :"地理院の道路地図を表示すると道路・駅名・地名が見えます。切替時だけ地図の表示範囲が送信されます。";
  el("areaMapNetworkInfo").textContent=text;
  const metric=el("areaMapMetric").value;
  const metrics=stats.districts.map(x=>valueFor(x,metric));
  const thresholds=[.25,.5,.75].map(q=>quartile(metrics,q)).filter(Number.isFinite);
  const markerBox=el("areaMapMarkers");
  markerBox.replaceChildren();
  for(const item of stats.districts){
    const mark=createMarker(item,project,thresholds,metric,selected===item.district);
    if(mark)markerBox.appendChild(mark);
  }
  legend(metric,stats.districts,thresholds,stats);
  selectedDetails(stats.districts);
  renderDistrictList(stats.districts,metric);
  const unavailable=stats.smallRecords+stats.unmatchedRecords+stats.unassignedRecords;
  const filters=stats.filters;
  const active=[
    filters.area!=null?"専有面積 "+filters.area+"㎡±35%":null,
    filters.station?"最寄り駅 "+filters.station:null,
    filters.ageYears!=null?"築年数 "+filters.ageYears+"年±10年":null,
    filters.layout?"間取り "+filters.layout:null,
    filters.structure?"構造 "+filters.structure:null,
  ].filter(Boolean);
  if(noPrices){
    warning("この自治体は地図のみ表示しています。過去の取引価格・参考査定額は未提供です。個別物件の位置を示すピンはありません。");
    el("areaMapAnalyze").disabled=true;
    return;
  }
  warning(
    CITY_PREFIX+
    (active.length?" 適用条件："+active.join("・")+"。":" 市区全体を集計。")+
    " 位置不明や5件未満のため地図から除いた取引："+volume(unavailable)+"。"+
    "代表点は住宅の正確な所在地ではなく、過去の公開取引価格をその地点で観測したことを意味しません。"
  );
}

export async function mountAreaMap(transactions,metadata,nationalCatalog=null){
  records=transactions;sourceMetadata=metadata;nationwideCatalog=nationalCatalog;
  try{
    const response=await fetch("./data/geography.json",{cache:"no-store"});
    if(!response.ok)throw Error("HTTP "+response.status);
    const loaded=await response.json();
    if(loaded.schema!=="tanuki-geo-v1"||!loaded.cities ||
       loaded.metadata?.priceSourceFingerprint!==metadata?.sourceFingerprint)
      throw Error("地図・取引情報の世代が一致しません。");
    geo=loaded;
    const tracked=["prefecture","city","district","station","area","ageYears","layout","structure"];
    for(const id of tracked){
      // Listening to both input and blur/change re-creates markers mid-click:
      // focused numeric input fires change on blur between pointerdown/up.
      // Use only input for numeric fields, only change for selects.
      const eventName=el(id).tagName==="INPUT"?"input":"change";
      el(id).addEventListener(eventName,render);
    }
    el("areaMapMetric").addEventListener("change",render);
    el("areaMapBasemap").addEventListener("click",()=>{
      basemap=basemap==="local"?"gsi":"local";render();
    });
    el("areaMapZoom").addEventListener("click",()=>{
      zoom=zoom==="areas"?"city":"areas";
      render();
    });
    el("areaMapAnalyze").addEventListener("click",()=>{
      if(!lastStats?.ok||!selected)return;
      const input=el("area");
      const area=Number(input.value);
      if(!input.value||!Number.isFinite(area)||area<15||area>300){
        input.focus();return;
      }
      const district=el("district");
      const found=[...district.options].find(o=>districtKey(o.value)===selected);
      if(!found)return;
      district.value=found.value;
      district.dispatchEvent(new Event("change",{bubbles:true}));
      el("estimateForm").requestSubmit();
    });
    try {
      const streetRes=await fetch("./data/street_context.json",{cache:"no-store"});
      if(streetRes.ok) {
        const candidate=await streetRes.json();
        if(candidate.schema==="tanuki-offline-streets-v1")streetData=candidate;
      }
    }catch(_error) {streetData=null;}
    render();
  }catch(err){
    console.error("TANUKI FairValue geographic layer failed:",err);
    geo=null;
    emptyDisplay("地図データの読込に失敗、または価格データとの整合が確認できません。");
  }
}
