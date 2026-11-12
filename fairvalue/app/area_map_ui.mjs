/**
 * TANUKI FairValue offline-first area map (v0.4.6).
 *
 * Municipality outline = MLIT N03 2026 administrative boundary.
 * Each marker = Digital Agency ABR *town reference point*, NOT actual sale location.
 * Marker value = aggregated ≥5 public condo transactions in that district.
 * No external map tiles, reverse geocoding, cookies, telemetry or API calls.
 */
import {statsForMunicipality,mapViewBounds,mapProjection,geometryPath,districtKey,quartile,boundsForGeometry}
  from "./area_map_stats.mjs";
import {focusUrbanBounds,roadSvgPath,roadColor,gsiTilePlan} from "./street_basemap.mjs";
import {findNationLocation,validatePrefGeometry} from "./nationwide.mjs";
import {indexMunicipalityRows,selectMunicipalityRows} from "./map_row_index.mjs";

const SVG_NS="http://www.w3.org/2000/svg";
const el=id=>document.getElementById(id);
const format=n=>Number(n).toLocaleString("ja-JP");
const unit=n=>Number(n).toLocaleString("ja-JP",{maximumFractionDigits:1})+"万円/㎡";
const volume=n=>format(n)+"件";
const palette=["#d5e3d3","#a8c4ab","#709b80","#305e46"];
const CITY_PREFIX="地区の代表点に、過去の地区単位の公表取引を集計しています。";
let coreIndex=new Map(),sourceMetadata=null,geo=null,zoom="areas",selected="",lastStats=null,lastCity="";
const supplementIndexByPrefecture=new Map();
const quarterIndexByPrefecture=new Map();
export function setSupplementaryAreaMapRows(rows,prefectureCode) {
  // Keep only an index for each lazily loaded prefecture. Do not repeatedly
  // concatenate all previously visited prefecture rows on every city change.
  if(!/^\d{2}$/.test(prefectureCode))throw Error("Official prefecture code required");
  supplementIndexByPrefecture.set(prefectureCode,indexMunicipalityRows(rows));
  if(geo)render();
}
export function setQuarterAreaMapRows(rows,prefectureCode){
  if(!/^\d{2}$/.test(prefectureCode))throw Error("Official Q2 prefecture code required");
  quarterIndexByPrefecture.set(prefectureCode,indexMunicipalityRows(rows));
  if(geo)render();
}
let streetData=null,basemap="local";
const MAX_INTERACTIVE_ZOOM=7;
let viewportBounds=null,viewportScale=1,viewportCityExtent=null,mapPaintContext=null;
const supplementTownPoints=new Map();

/**
 * Pure geo-viewport pan/zoom. Geometry remains official N03 shapes; points
 * remain ABR town centroids, never individual property coordinates.
 * A projected geographic pan changes only view bounds, not public price rows.
 */
export function panGeoBounds(bounds,dx,dy,canvasWidth,canvasHeight,cityBounds=null){
  if(!bounds||![dx,dy,canvasWidth,canvasHeight].every(Number.isFinite)||
     canvasWidth<=0||canvasHeight<=0)return bounds;
  const centerLon=(bounds.minLon+bounds.maxLon)/2;
  const centerLat=(bounds.minLat+bounds.maxLat)/2;
  const projection=mapProjection(bounds);
  if(!projection)return bounds;
  const spanLon=bounds.maxLon-bounds.minLon,spanLat=bounds.maxLat-bounds.minLat;
  const pxLon=(projection(bounds.maxLon,centerLat).x-projection(bounds.minLon,centerLat).x)/spanLon;
  const pxLat=(projection(centerLon,bounds.minLat).y-projection(centerLon,bounds.maxLat).y)/spanLat;
  if(!(pxLon>0&&pxLat>0))return bounds;
  let lon=centerLon-(dx*720/canvasWidth)/pxLon;
  let lat=centerLat+(dy*500/canvasHeight)/pxLat;
  if(cityBounds){
    const lonMargin=Math.max(spanLon*.65,(cityBounds.maxLon-cityBounds.minLon)*.05);
    const latMargin=Math.max(spanLat*.65,(cityBounds.maxLat-cityBounds.minLat)*.05);
    lon=Math.max(cityBounds.minLon-lonMargin,Math.min(cityBounds.maxLon+lonMargin,lon));
    lat=Math.max(cityBounds.minLat-latMargin,Math.min(cityBounds.maxLat+latMargin,lat));
  }
  return {minLon:lon-spanLon/2,maxLon:lon+spanLon/2,
    minLat:lat-spanLat/2,maxLat:lat+spanLat/2};
}
export function zoomGeoBounds(bounds,factor,x=.5,y=.5){
  if(!bounds||!Number.isFinite(factor)||factor<=0)return bounds;
  const fractionX=Math.max(0,Math.min(1,x)),fractionY=Math.max(0,Math.min(1,y));
  const centerLon=(bounds.minLon+bounds.maxLon)/2;
  const centerLat=(bounds.minLat+bounds.maxLat)/2;
  const spanLon=bounds.maxLon-bounds.minLon,spanLat=bounds.maxLat-bounds.minLat;
  const projection=mapProjection(bounds);
  if(!projection)return bounds;
  const pxLon=(projection(bounds.maxLon,centerLat).x-projection(bounds.minLon,centerLat).x)/spanLon;
  const pxLat=(projection(centerLon,bounds.minLat).y-projection(centerLon,bounds.maxLat).y)/spanLat;
  if(!(pxLon>0&&pxLat>0))return bounds;
  const xPixels=fractionX*720-360,yPixels=fractionY*500-250;
  const anchorLon=centerLon+xPixels/pxLon,anchorLat=centerLat-yPixels/pxLat;
  const newCenterLon=anchorLon-xPixels/(pxLon*factor);
  const newCenterLat=anchorLat+yPixels/(pxLat*factor);
  const newLon=spanLon/factor,newLat=spanLat/factor;
  return {minLon:newCenterLon-newLon/2,maxLon:newCenterLon+newLon/2,
    minLat:newCenterLat-newLat/2,maxLat:newCenterLat+newLat/2};
}
function clearMapViewport(){
  viewportBounds=null;
  viewportScale=1;
  viewportCityExtent=null;
  mapPaintContext=null;
  resetMapDragPreview();
}
function updateMapNavigation(){
  el("areaMapZoomIn").disabled=!mapPaintContext||viewportScale>=MAX_INTERACTIVE_ZOOM-1e-6;
  el("areaMapZoomOut").disabled=!mapPaintContext||viewportScale<=1+1e-6;
  el("areaMapPanReset").disabled=!mapPaintContext||
    (viewportScale<=1+1e-6&&!viewportBounds?.isPanned);
}
function boundCenterWithinCity(bounds){
  // This preserves the current zoom and stops a drag wandering indefinitely.
  return panGeoBounds(bounds,0,0,720,500,viewportCityExtent);
}
function resetMapDragPreview(){
  for(const id of ["areaMapSvg","areaMapMarkers"]){
    const item=el(id);
    if(item){item.style.transform="";item.style.transformOrigin="";}
  }
  el("areaMapCanvas")?.classList.remove("is-dragging");
}
function applyMapZoom(factor,x=.5,y=.5,{repaint=true}={}){
  if(!viewportBounds||!mapPaintContext)return false;
  const nextScale=Math.max(1,Math.min(MAX_INTERACTIVE_ZOOM,viewportScale*factor));
  if(Math.abs(nextScale-viewportScale)<1e-5)return false;
  const realFactor=nextScale/viewportScale;
  viewportBounds=boundCenterWithinCity(zoomGeoBounds(viewportBounds,realFactor,x,y));
  viewportBounds.isPanned=true;
  viewportScale=nextScale;
  if(repaint)paintMapViewport();
  return true;
}
function applyMapPan(dx,dy,{repaint=true}={}){
  const canvas=el("areaMapCanvas"),r=canvas.getBoundingClientRect();
  if(!viewportBounds||!mapPaintContext||!(r.width>0&&r.height>0))return false;
  if(Math.abs(dx)+Math.abs(dy)<.25)return false;
  viewportBounds=panGeoBounds(viewportBounds,dx,dy,r.width,r.height,viewportCityExtent);
  viewportBounds.isPanned=true;
  if(repaint)paintMapViewport();
  return true;
}

export function setSupplementaryAreaMapGeography(cities){
  for(const [code,item] of Object.entries(cities||{})){
    if(!/^\d{5}$/.test(code)||!item?.districtPoints)continue;
    supplementTownPoints.set(code,item.districtPoints);
  }
  if(geo)render();
}
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
    const job=fetch("./data/national_shapes/"+prefCode+".json",{cache:"no-cache"})
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
  mapPaintContext=null;
  viewportBounds=null;
  resetMapDragPreview();
  updateMapNavigation();
  el("areaMapCityName").textContent="地図データを確認してください";
  el("areaMapTotal").textContent="—";
  el("areaMapStatus").textContent=message;
  el("areaMapLegend").textContent=message;
  el("areaMapDistrictList").replaceChildren();
  el("areaMapListStatus").textContent="表示できる地区 0件";
  el("areaMapSort").disabled=true;
  el("areaMapMarkers").replaceChildren();
  el("areaMapSvg").replaceChildren();
  el("areaMapSelected").textContent="地域を選ぶと公表取引の集計を表示します。";
  el("areaMapAnalyze").disabled=true;
  el("areaMapAnalyze").hidden=true;
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
      cx:pos.x,cy:pos.y,r:4,fill:"#577977",stroke:"#fff","stroke-width":2
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
/**
 * Place only legible high-evidence district labels beside, never on top of,
 * their ABR reference markers. All positions are in SVG 720x500 coordinates;
 * there is no access to precise home/sale location in this layout.
 * Pure so collision and small-sample behavior can be independently tested.
 */
export function layoutDistrictLabels(districts,project,{width=720,height=500,maxLabels=9}={}){
  const nodes=(districts||[]).map(d=>{
    const pos=project(d.lon,d.lat);
    const radius=Math.min(24,10+Math.sqrt(Math.max(0,d.count))*1.65)/2+3;
    return {...d,x:pos.x,y:pos.y,radius};
  }).filter(d=>Number.isFinite(d.x)&&Number.isFinite(d.y)&&
    d.x>=0&&d.x<=width&&d.y>=0&&d.y<=height);
  const boxes=nodes.map(d=>({
    x:d.x-d.radius,y:d.y-d.radius,
    right:d.x+d.radius,bottom:d.y+d.radius
  }));
  const overlaps=(a,b,padding=3)=>a.x<b.right+padding&&a.right>b.x-padding&&
    a.y<b.bottom+padding&&a.bottom>b.y-padding;
  const laidOut=[],occupied=[];
  for(const district of [...nodes].sort((a,b)=>b.count-a.count||
      a.district.localeCompare(b.district,"ja"))){
    if(laidOut.length>=maxLabels)break;
    const name=String(district.district||"");
    // Conservative text-width estimate for bold Japanese labels at 13 SVG px.
    const widthEstimate=[...name].reduce((sum,c)=>sum+
       (/[^\\x00-\\x7F]/.test(c)?15:8),8);
    const w=Math.max(23,widthEstimate),h=19,offset=district.radius+10;
    const positions=[
      [district.x+offset,district.y-h-6],
      [district.x+offset,district.y+6],
      [district.x-offset-w,district.y-h-6],
      [district.x-offset-w,district.y+6],
      [district.x-w/2,district.y-offset-h],
      [district.x-w/2,district.y+offset]
    ];
    for(const [x,y] of positions){
      const box={x,y,right:x+w,bottom:y+h};
      if(box.x<12||box.y<12||box.right>width-12||box.bottom>height-13)continue;
      if(boxes.some(marker=>overlaps(box,marker,3)))continue;
      if(occupied.some(existing=>overlaps(box,existing,5)))continue;
      laidOut.push({district:name,x,y:y+14});
      occupied.push(box);
      break;
    }
  }
  return laidOut;
}
function drawBaseShape(geometry,project,code,bounds,stats){
  const root=el("areaMapSvg");
  root.replaceChildren();
  root.appendChild(svgNode("rect",{width:720,height:500,fill:"#eff2e9"}));
  if(basemap==="gsi")gsiImageTiles(root,bounds,project);
  const path=svgNode("path",{
    d:geometryPath(geometry,project),
    fill:basemap==="gsi"?"rgba(225,234,220,.02)":"#e1e9db",
    "fill-rule":"evenodd",
    stroke:basemap==="gsi"?"#658b70":"#91a994",
    "stroke-width":basemap==="gsi"?1.4:1.5,
    "stroke-linejoin":"round"
  });
  root.appendChild(path);
  const haveRoads=basemap==="local"&&offlineRoads(root,project,code,bounds);
  if(basemap==="local"&&!haveRoads){
    const labels=svgNode("g",{class:"map-town-labels",
      "aria-hidden":"true","pointer-events":"none"});
    for(const label of layoutDistrictLabels(stats.districts,project)){
      const txt=svgNode("text",{x:label.x,y:label.y,class:"map-town-label"});
      txt.textContent=label.district;
      labels.appendChild(txt);
    }
    root.appendChild(labels);
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
  button.setAttribute("aria-pressed",String(isSelected));
  button.addEventListener("click",()=>selectDistrict(item.district));
  return button;
}
/**
 * Reproject only the map layers when panning/zooming, not the statistical
 * summary or the district-price list. Opt-in GSI is the sole online tile mode.
 */
function paintMapViewport(){
  if(!mapPaintContext||!viewportBounds)return;
  resetMapDragPreview();
  const {city,code,stats,metric,thresholds}=mapPaintContext;
  const bounds=viewportBounds;
  const project=mapProjection(bounds);
  if(!project)return;
  const hasOfflineRoads=drawBaseShape(city.geometry,project,code,bounds,stats);
  const switcher=el("areaMapBasemap");
  switcher.setAttribute("aria-pressed",String(basemap==="gsi"));
  switcher.textContent=basemap==="gsi"?"ローカル地図に戻る":"道路地図（通信あり）";
  el("areaMapNetworkInfo").textContent=basemap==="gsi"
    ?"国土地理院の地図を表示中。タイルの取得先に表示範囲が送信されます。"
    :hasOfflineRoads
      ?"道路・駅名はローカル保存のOpenStreetMapデータ（外部通信なし）。地理院の道路地図への切替時だけ表示範囲が送信されます。"
      :"地理院の道路地図を表示すると道路・駅名・地名が見えます。切替時だけ地図の表示範囲が送信されます。";
  const markerBox=el("areaMapMarkers");
  markerBox.replaceChildren();
  for(const item of stats.districts){
    const marker=createMarker(item,project,thresholds,metric,selected===item.district);
    if(marker)markerBox.appendChild(marker);
  }
  updateMapNavigation();
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
      "地図の丸印か下の地区一覧から選ぶと、取引件数と㎡単価を確認できます。"));
    analyze.disabled=true;
    analyze.hidden=true;
    return;
  }
  analyze.hidden=false;
  block.appendChild(create("p","area-map-selected-label","選択中の地区"));
  block.appendChild(create("h3","",item.district));
  const clear=create("button","area-map-clear","市区町村全体に戻す");
  clear.type="button";
  clear.addEventListener("click",()=>selectDistrict(""));
  block.appendChild(clear);
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
  const observedOnly=el("regionCoverage")?.dataset.state==="OBSERVED_ONLY";
  analyze.textContent=analyze.disabled?"専有面積を入力すると確認できます":
    observedOnly?"この地区の過去取引を確認する":"この地区の参考価格を確認する";
}
/**
 * Sort only already-reviewed district aggregates. Never turn low-sample
 * districts into displayed prices or infer missing observations.
 */
export function orderDistricts(items,sortMode="count"){
  const list=Array.isArray(items)?[...items]:[];
  const mode=["count","unit-desc","unit-asc"].includes(sortMode)?sortMode:"count";
  const name=(a,b)=>String(a.district).localeCompare(String(b.district),"ja");
  if(mode==="unit-desc")return list.sort((a,b)=>b.unitMan-a.unitMan||b.count-a.count||name(a,b));
  if(mode==="unit-asc")return list.sort((a,b)=>a.unitMan-b.unitMan||b.count-a.count||name(a,b));
  return list.sort((a,b)=>b.count-a.count||name(a,b));
}
function renderDistrictList(items,metric){
  const list=el("areaMapDistrictList");
  const status=el("areaMapListStatus");
  const sort=el("areaMapSort").value;
  el("areaMapSort").disabled=!items.length;
  list.replaceChildren();
  if(!items.length){
    status.textContent="表示できる地区 0件";
    list.appendChild(create("p","area-map-empty-info",
      "取引件数5件以上で位置の確認ができる地区はありません。条件を緩めてください。"));
    return;
  }
  const sorted=orderDistricts(items,sort);
  status.textContent=sorted.length+"地区 · 過去の㎡単価中央値（取引5件以上）";
  for(const [i,district] of sorted.entries()){
    const isSelected=selected===district.district;
    const button=create("button","area-map-list-item"+(isSelected?" selected":""));
    button.type="button";
    button.dataset.district=district.district;
    button.setAttribute("aria-pressed",String(isSelected));
    button.setAttribute("aria-label",district.district+"、過去の㎡単価中央値 "+
      unit(district.unitMan)+"、公表取引 "+volume(district.count));
    const rank=create("i","area-map-list-rank",String(i+1).padStart(2,"0"));
    rank.setAttribute("aria-hidden","true");
    const name=create("span","area-map-list-name",district.district);
    const value=create("strong","area-map-list-price",unit(district.unitMan));
    const sub=create("small","area-map-list-sub","公表取引 "+volume(district.count));
    button.append(rank,name,value,sub);
    button.addEventListener("click",()=>selectDistrict(district.district));
    list.appendChild(button);
  }
  // Scrolling is confined to the results panel, not the whole document:
  // a pin click should reveal the matching district row without losing map.
  const active=[...list.children].find(button=>button.getAttribute("aria-pressed")==="true");
  if(active){
    const relativeTop=active.offsetTop; // list is position:relative, the button offsetParent
    const relativeBottom=relativeTop+active.offsetHeight;
    if(relativeTop<list.scrollTop)list.scrollTop=relativeTop;
    else if(relativeBottom>list.scrollTop+list.clientHeight)
      list.scrollTop=Math.max(0,relativeBottom-list.clientHeight);
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
      const identity=findNationLocation(nationwideCatalog,pref,cityName);
      el("areaMapCityName").textContent=pref+" "+(identity?.city??cityName)+
        (/^\d{5}$/.test(cityName)?"（行政コード "+cityName+"）":"");
      return;
    }
    cityEntry=Array.isArray(fallback)?fallback:null;
    if(cityEntry && supplementTownPoints.has(cityEntry[0])){
      cityEntry=[cityEntry[0],{...cityEntry[1],
        districtPoints:supplementTownPoints.get(cityEntry[0])}];
    }
  }
  if(!cityEntry){
    emptyDisplay(cityName?"行政区域データが利用できません。":"市区町村を選択してください。");
    return;
  }
  const [code,city]=cityEntry;
  if(lastCity!==code){
    clearMapViewport();
    lastCity=code;zoom="areas";selected="";
  }
  const value=el("district").value;
  const formDistrict=districtKey(value);
  if(value&&formDistrict)selected=formDistrict;
  const rows=selectMunicipalityRows(coreIndex,
    supplementIndexByPrefecture.get(code.slice(0,2)),city.prefecture,city.city);
  const q2Rows=selectMunicipalityRows(new Map(),
      quarterIndexByPrefecture.get(code.slice(0,2)),city.prefecture,city.city);
    const stats=statsForMunicipality(rows.concat(q2Rows),city,readFilters());
  lastStats=stats;
  el("areaMapCityName").textContent=pref+" "+city.city+
    (/^\d{5}$/.test(cityName)?"（行政コード "+code+"）":"");
  const noPrices=stats.totalCityRecords===0;
  el("areaMapTotal").textContent=noPrices?"価格未収録":volume(stats.plottedRecords);
  el("areaMapStatus").textContent=noPrices
    ?"全国の行政区域は表示できますが、この地域の公表取引価格はまだ取得していません。"
    :stats.districtCount===0
      ?"公表取引 "+volume(stats.filteredRecords)+"は収録しています。町字の代表点が未整備のため、地区の価格を地図上には配置していません。"
      :"地区数 "+format(stats.districtCount)+
        "／現在の条件に合う公表取引 "+volume(stats.filteredRecords)+
        "。位置・5件基準を満たす取引を地図表示。";
  el("areaMapZoom").textContent=zoom==="areas"?"市区全体を見る":"地区の集中部を見る";
  const focused=focusUrbanBounds(city.geometry,stats.districts,code,zoom,streetData);
  const projected=mapProjection(focused);
  if(!projected){
    emptyDisplay("境界データを投影できません。");
    return;
  }
  if(!viewportBounds)viewportBounds=focused;
  viewportCityExtent=boundsForGeometry(city.geometry);
  const metric=el("areaMapMetric").value;
  const metrics=stats.districts.map(x=>valueFor(x,metric));
  const thresholds=[.25,.5,.75].map(q=>quartile(metrics,q)).filter(Number.isFinite);
  mapPaintContext={city,code,stats,metric,thresholds};
  paintMapViewport();
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
  if(stats.districtCount===0){
    warning("この自治体には公開取引が収録されていますが、代表点の位置を公的データと照合できていないため、価格付きの丸印を描きません。上の入力欄から公開取引を確認できます。");
    return;
  }
  warning(
    CITY_PREFIX+
    (active.length?" 適用条件："+active.join("・")+"。":" 市区全体を集計。")+
    " 位置不明や5件未満のため地図から除いた取引："+volume(unavailable)+"。"+
    "代表点は住宅の正確な所在地ではなく、過去の公開取引価格をその地点で観測したことを意味しません。"
  );
}

/* Interactive map view: move the administrative/town layer, not the
   statistical data. The pointer gesture previews CSS movement cheaply, then
   reprojects the map once on release. This also avoids GSI tile churn when
   the user previously opted into the online basemap. */
const gesturePointers=new Map();
let activeMapGesture=null;
function showDragPreview(dx=0,dy=0,ratio=1,originX=.5,originY=.5){
  const factor=Math.max(.25,Math.min(5,ratio));
  const transform="translate3d("+dx.toFixed(1)+"px,"+dy.toFixed(1)+"px,0) scale("+factor.toFixed(4)+")";
  const anchor=(originX*100).toFixed(2)+"% "+(originY*100).toFixed(2)+"%";
  for(const id of ["areaMapSvg","areaMapMarkers"]){
    const item=el(id);
    item.style.transformOrigin=anchor;
    item.style.transform=transform;
  }
  el("areaMapCanvas").classList.add("is-dragging");
}
function gestureCenter(points){
  if(points.length!==2)return null;
  return {x:(points[0].x+points[1].x)/2,
    y:(points[0].y+points[1].y)/2,
    distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};
}
function finishMapGesture(commit){
  if(!activeMapGesture)return;
  const g=activeMapGesture;
  activeMapGesture=null;
  if(!commit){resetMapDragPreview();return;}
  let changed=false;
  if(g.type==="pinch"){
    const fingers=gestureCenter([...gesturePointers.values()]);
    if(fingers){
      const factor=fingers.distance/Math.max(1,g.start.distance);
      changed=applyMapZoom(factor,g.anchorX,g.anchorY,{repaint:false})||changed;
      const dx=fingers.x-g.start.x,dy=fingers.y-g.start.y;
      if(Math.hypot(dx,dy)>=4)
        changed=applyMapPan(dx,dy,{repaint:false})||changed;
    }
  }else if(g.type==="pan"){
    const pos=gesturePointers.get(g.pointerId);
    if(pos){
      const dx=pos.x-g.start.x,dy=pos.y-g.start.y;
      if(Math.hypot(dx,dy)>=4)
        changed=applyMapPan(dx,dy,{repaint:false})||changed;
    }
  }
  if(changed)paintMapViewport();else resetMapDragPreview();
}
function mountMapGestures(){
  const canvas=el("areaMapCanvas");
  const rectFraction=(clientX,clientY)=>{
    const rect=canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(clientX-rect.left)/Math.max(1,rect.width))),
      y:Math.max(0,Math.min(1,(clientY-rect.top)/Math.max(1,rect.height)))};
  };
  el("areaMapZoomIn").addEventListener("click",()=>applyMapZoom(1.5));
  el("areaMapZoomOut").addEventListener("click",()=>applyMapZoom(1/1.5));
  el("areaMapPanReset").addEventListener("click",()=>{
    viewportBounds=null;viewportScale=1;render();
  });
  canvas.addEventListener("pointerdown",event=>{
    if(!mapPaintContext||!viewportBounds)return;
    if(event.pointerType==="mouse"&&event.button!==0)return;
    if(event.target.closest?.(".area-map-dot"))return; // preserve clicking a real district
    gesturePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    try{canvas.setPointerCapture(event.pointerId);}catch(_error){}
    if(gesturePointers.size===1){
      activeMapGesture={type:"pan",pointerId:event.pointerId,
        start:{x:event.clientX,y:event.clientY}};
    }else if(gesturePointers.size===2){
      const start=gestureCenter([...gesturePointers.values()]);
      const anchor=rectFraction(start.x,start.y);
      activeMapGesture={type:"pinch",start,anchorX:anchor.x,anchorY:anchor.y};
    }
    if(event.pointerType==="touch")event.preventDefault();
  });
  canvas.addEventListener("pointermove",event=>{
    if(!gesturePointers.has(event.pointerId)||!activeMapGesture)return;
    gesturePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const g=activeMapGesture;
    if(g.type==="pan"&&g.pointerId===event.pointerId){
      const dx=event.clientX-g.start.x,dy=event.clientY-g.start.y;
      if(Math.hypot(dx,dy)>3)showDragPreview(dx,dy);
    }else if(g.type==="pinch"){
      const fingers=gestureCenter([...gesturePointers.values()]);
      if(!fingers)return;
      const ratio=fingers.distance/Math.max(1,g.start.distance);
      showDragPreview(fingers.x-g.start.x,fingers.y-g.start.y,ratio,
        g.anchorX,g.anchorY);
    }
    if(event.pointerType==="touch")event.preventDefault();
  });
  function pointerEnd(event,commit){
    if(!gesturePointers.has(event.pointerId))return;
    gesturePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    finishMapGesture(commit);
    for(const id of gesturePointers.keys()){
      try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch(_error){}
    }
    gesturePointers.clear();
  }
  canvas.addEventListener("pointerup",event=>pointerEnd(event,true));
  canvas.addEventListener("pointercancel",event=>pointerEnd(event,false));
  canvas.addEventListener("lostpointercapture",event=>{
    // Pointerup release is handled above; unexpected loss cancels preview.
    if(gesturePointers.has(event.pointerId)&&activeMapGesture){
      resetMapDragPreview();
      gesturePointers.clear();activeMapGesture=null;
    }
  });
  canvas.addEventListener("wheel",event=>{
    if(!mapPaintContext)return;
    if((event.deltaY>=0&&viewportScale<=1+1e-5)||
       (event.deltaY<0&&viewportScale>=MAX_INTERACTIVE_ZOOM-1e-5))return;
    event.preventDefault();
    const anchor=rectFraction(event.clientX,event.clientY);
    const delta=Math.max(-160,Math.min(160,event.deltaY));
    applyMapZoom(Math.exp(-delta*.003),anchor.x,anchor.y);
  },{passive:false});
  canvas.addEventListener("dblclick",event=>{
    if(event.target.closest?.(".area-map-dot")||!mapPaintContext)return;
    event.preventDefault();
    const anchor=rectFraction(event.clientX,event.clientY);
    applyMapZoom(1.65,anchor.x,anchor.y);
  });
  canvas.addEventListener("keydown",event=>{
    if(event.target!==canvas||!mapPaintContext)return;
    const moves={ArrowLeft:[55,0],ArrowRight:[-55,0],
      ArrowUp:[0,55],ArrowDown:[0,-55]};
    if(moves[event.key]){
      event.preventDefault();applyMapPan(...moves[event.key]);return;
    }
    if(event.key==="+"||event.key==="="){
      event.preventDefault();applyMapZoom(1.5);
    }else if(event.key==="-"||event.key==="_"){
      event.preventDefault();applyMapZoom(1/1.5);
    }else if(event.key==="Home"){
      event.preventDefault();viewportBounds=null;viewportScale=1;render();
    }
  });
  updateMapNavigation();
}

export async function mountAreaMap(transactions,metadata,nationalCatalog=null){
  coreIndex=indexMunicipalityRows(transactions);
  sourceMetadata=metadata;nationwideCatalog=nationalCatalog;
  try{
    const response=await fetch("./data/geography.json",{cache:"no-cache"});
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
    el("areaMapSort").addEventListener("change",()=>{
      if(lastStats?.ok)renderDistrictList(lastStats.districts,el("areaMapMetric").value);
    });
    el("areaMapBasemap").addEventListener("click",()=>{
      basemap=basemap==="local"?"gsi":"local";render();
    });
    el("areaMapZoom").addEventListener("click",()=>{
      zoom=zoom==="areas"?"city":"areas";
      viewportBounds=null;
      viewportScale=1;
      render();
    });
    mountMapGestures();
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
      const streetRes=await fetch("./data/street_context.json",{cache:"no-cache"});
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
