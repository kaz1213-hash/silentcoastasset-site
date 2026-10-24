/**
 * TANUKI FairValue map aggregation — deterministic, no geocoding at runtime.
 * Real properties have NO longitude/latitude. Aggregates alone are assigned
 * to official *town representative points* when >=5 public observations match.
 */
import {normalizeLabel} from "./estimator.mjs";
import {layoutClass,structureClass} from "./property_features.mjs";
export const MAP_MIN_DISTRICT_COUNT=5;

export function districtKey(raw) {
  return normalizeLabel(raw).replace(/^大字/,"");
}

export function quartile(values,q){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return null;
  return a[Math.floor(q*(a.length-1))];
}

export function statsForMunicipality(records,cityGeo,filters={}){
  if(!cityGeo)return {ok:false,reason:"行政区域の地理情報が未収録"};
  const pref=cityGeo.prefecture,city=cityGeo.city;
  const base=records.filter(r=>r.category==="condo"&&r.prefecture===pref&&r.city===city);
  const station=normalizeLabel(filters.station);
  const areaInput=filters.area;
  const a=areaInput!==""&&areaInput!=null?Number(areaInput):null;
  const validArea=Number.isFinite(a) && a>=15 && a<=300;
  const ageInput=filters.ageYears;
  const age=ageInput!==""&&ageInput!=null?Number(ageInput):null;
  const validAge=Number.isFinite(age)&&age>=0&&age<=100;
  const layout=filters.layout?layoutClass(filters.layout):"";
  const structure=filters.structure?structureClass(filters.structure):"";
  const subset=base.filter(r=>{
    if(layout && layoutClass(r.layout)!==layout)return false;
    if(structure && structureClass(r.structure)!==structure)return false;
    if(station&&normalizeLabel(r.station)!==station)return false;
    if(validArea && (Number(r.area)<a*.65||Number(r.area)>a*1.35))return false;
    if(validAge&&(r.ageYears==null||Math.abs(Number(r.ageYears)-age)>10))return false;
    return Number.isFinite(Number(r.area))&&Number(r.area)>0&&
      Number.isFinite(Number(r.priceYen))&&Number(r.priceYen)>0;
  });
  const grouped=new Map();
  for(const row of subset){
    const district=districtKey(row.district);
    if(!district)continue;
    if(!grouped.has(district))grouped.set(district,[]);
    grouped.get(district).push(row);
  }
  let smallCount=0,unmatchedCount=0,unmappedDistricts=0,smallDistricts=0;
  const districts=[];
  for(const [district,items] of grouped){
    if(items.length<MAP_MIN_DISTRICT_COUNT){
      smallCount+=items.length;smallDistricts++;continue;
    }
    const position=cityGeo.districtPoints?.[district];
    if(!position || !Number.isFinite(position.lon) || !Number.isFinite(position.lat)){
      unmatchedCount+=items.length;unmappedDistricts++;continue;
    }
    const sqm=items.map(item=>Number(item.priceYen)/Number(item.area)/10000);
    const prices=items.map(item=>Number(item.priceYen)/10000);
    districts.push({
      district,lon:position.lon,lat:position.lat,count:items.length,
      unitMan:quartile(sqm,.5),unitQ25Man:quartile(sqm,.25),unitQ75Man:quartile(sqm,.75),
      totalMedianMan:quartile(prices,.5),
      newestYear:Math.max(...items.map(r=>Number(r.year))),
      pointType:"町字代表点（実取引の所在地ではありません）"
    });
  }
  districts.sort((a,b)=>b.count-a.count||a.district.localeCompare(b.district,"ja"));
  return {
    ok:true,municipality:pref+" "+city,
    totalCityRecords:base.length,filteredRecords:subset.length,
    districtCount:districts.length,plottedRecords:districts.reduce((s,r)=>s+r.count,0),
    smallRecords:smallCount,smallDistricts,
    unmatchedRecords:unmatchedCount,unmatchedDistricts:unmappedDistricts,
    unassignedRecords:subset.length-[...grouped.values()].reduce((s,g)=>s+g.length,0),
    filters:{
      station:station||"",layout:layout||"",structure:structure||"",
      area:validArea?a:null,ageYears:validAge?age:null
    },
    districts
  };
}

export function boundsForGeometry(geometry) {
  let minLon=Infinity,minLat=Infinity,maxLon=-Infinity,maxLat=-Infinity;
  function walk(coords){
    if(!Array.isArray(coords))return;
    if(coords.length>=2&&typeof coords[0]==="number"&&typeof coords[1]==="number"){
      const [lon,lat]=coords;
      minLon=Math.min(lon,minLon); maxLon=Math.max(lon,maxLon);
      minLat=Math.min(lat,minLat); maxLat=Math.max(lat,maxLat);
    }else for(const part of coords)walk(part);
  }
  if(geometry?.type!=="Polygon"&&geometry?.type!=="MultiPolygon")return null;
  walk(geometry.coordinates);
  if(![minLon,minLat,maxLon,maxLat].every(Number.isFinite)||maxLon<=minLon||maxLat<=minLat)return null;
  return {minLon,minLat,maxLon,maxLat};
}

export function mapViewBounds(geometry,plotted,mode="areas") {
  const city=boundsForGeometry(geometry);
  if(!city)return null;
  if(mode!=="areas"||!plotted?.length) return city;
  const lons=plotted.map(p=>p.lon),lats=plotted.map(p=>p.lat);
  const minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats);
  const deltaLon=Math.max(maxLon-minLon,.012),deltaLat=Math.max(maxLat-minLat,.012);
  return {
    minLon:Math.max(city.minLon,minLon-deltaLon*.26),
    maxLon:Math.min(city.maxLon,maxLon+deltaLon*.26),
    minLat:Math.max(city.minLat,minLat-deltaLat*.26),
    maxLat:Math.min(city.maxLat,maxLat+deltaLat*.26)
  };
}

export function mapProjection(bounds,width=720,height=500){
  if(!bounds)return null;
  const midLat=(bounds.minLat+bounds.maxLat)/2;
  const cosine=Math.cos(midLat*Math.PI/180);
  const lonDist=Math.max(.0001,(bounds.maxLon-bounds.minLon)*cosine);
  const latDist=Math.max(.0001,bounds.maxLat-bounds.minLat);
  const pad=26;
  const scale=Math.min((width-2*pad)/lonDist,(height-2*pad)/latDist);
  const centerLon=(bounds.minLon+bounds.maxLon)/2,centerLat=(bounds.minLat+bounds.maxLat)/2;
  return (lon,lat)=>({
    x:width/2+(lon-centerLon)*cosine*scale,
    y:height/2-(lat-centerLat)*scale,
  });
}

export function geometryPath(geometry,project){
  if(!geometry||!project)return "";
  const polygons=geometry.type==="Polygon"?[geometry.coordinates]
    :geometry.type==="MultiPolygon"?geometry.coordinates:[];
  const parts=[];
  for(const polygon of polygons){
    for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<3)continue;
      const first=project(ring[0][0],ring[0][1]);
      let path="M"+first.x.toFixed(2)+","+first.y.toFixed(2);
      for(const pair of ring.slice(1)){
        const pt=project(pair[0],pair[1]);
        path+="L"+pt.x.toFixed(2)+","+pt.y.toFixed(2);
      }
      parts.push(path+"Z");
    }
  }
  return parts.join(" ");
}
