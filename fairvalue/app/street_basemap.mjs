/**
 * Offline OSM-derived street context and opt-in online GSI "pale" tiles.
 * Overlay dots represent ABR town reference points, not property positions.
 */
export function focusUrbanBounds(cityGeometry,districts,code,zoom,offline){
  const fallback=cityBounds(cityGeometry);
  if(!fallback)return null;
  if(zoom==="city")return fallback;
  if(code==="20202" && offline?.cities?.[code]?.roads?.length){
    return {minLon:137.928,maxLon:138.015,minLat:36.204,maxLat:36.263};
  }
  const centers=districts?.length?districts:[];
  if(!centers.length)return fallback;
  const median=a=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)/2)];
  const lons=[],lats=[];
  for(const p of centers){
    const rep=Math.min(15,Math.max(1,Math.round(p.count/7)));
    for(let i=0;i<rep;i++){lons.push(p.lon);lats.push(p.lat);}
  }
  const centerLon=median(lons),centerLat=median(lats);
  const sortedLons=[...lons].sort((a,b)=>a-b);
  const sortedLats=[...lats].sort((a,b)=>a-b);
  const p10=a=>a[Math.floor(a.length*.1)];
  const p90=a=>a[Math.min(a.length-1,Math.floor(a.length*.9))];
  const halfLon=Math.min(.090,Math.max(.033,(p90(sortedLons)-p10(sortedLons))*.68));
  const halfLat=Math.min(.055,Math.max(.022,(p90(sortedLats)-p10(sortedLats))*.68));
  return {
    minLon:Math.max(fallback.minLon,centerLon-halfLon),
    maxLon:Math.min(fallback.maxLon,centerLon+halfLon),
    minLat:Math.max(fallback.minLat,centerLat-halfLat),
    maxLat:Math.min(fallback.maxLat,centerLat+halfLat)
  };
}
function cityBounds(geometry){
  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
  const read=x=>{
    if(!Array.isArray(x))return;
    if(typeof x[0]==="number"&&typeof x[1]==="number"){
      const [lon,lat]=x;a=Math.min(a,lon);b=Math.min(b,lat);c=Math.max(c,lon);d=Math.max(d,lat);
    }else x.forEach(read);
  };
  read(geometry?.coordinates);
  return [a,b,c,d].every(Number.isFinite)&&c>a&&d>b?{minLon:a,minLat:b,maxLon:c,maxLat:d}:null;
}
function worldX(lon,z){return (lon+180)/360*Math.pow(2,z);}
function worldY(lat,z){
  const rad=Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180;
  return (1-Math.asinh(Math.tan(rad))/Math.PI)/2*Math.pow(2,z);
}
function mercatorToLon(tileX,z){return tileX/Math.pow(2,z)*360-180;}
function mercatorToLat(tileY,z){return Math.atan(Math.sinh(Math.PI*(1-2*tileY/Math.pow(2,z))))*180/Math.PI;}
export function gsiTilePlan(bounds,project,{maxTiles=72}={}){
  if(!bounds||!project)return [];
  const mid=(bounds.minLat+bounds.maxLat)/2;
  const a=project(bounds.minLon,mid),b=project(bounds.maxLon,mid);
  const scalePerDeg=(b.x-a.x)/(bounds.maxLon-bounds.minLon);
  let z=Math.max(9,Math.min(16,Math.floor(Math.log2(360*scalePerDeg/210))));
  for(;z>=9;z--){
    const x0=Math.floor(worldX(bounds.minLon,z)),x1=Math.floor(worldX(bounds.maxLon,z));
    const y0=Math.floor(worldY(bounds.maxLat,z)),y1=Math.floor(worldY(bounds.minLat,z));
    const n=(x1-x0+1)*(y1-y0+1);
    if(n>maxTiles)continue;
    const tiles=[];
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const tl=project(mercatorToLon(x,z),mercatorToLat(y,z));
        const br=project(mercatorToLon(x+1,z),mercatorToLat(y+1,z));
        tiles.push({
          z,x,y,svgX:tl.x,svgY:tl.y,svgWidth:br.x-tl.x,svgHeight:br.y-tl.y,
          uri:"https://cyberjapandata.gsi.go.jp/xyz/pale/"+z+"/"+x+"/"+y+".png"
        });
      }
    }
    return tiles;
  }
  return [];
}
export function roadSvgPath(road,project){
  const coords=road?.coordinates;
  if(!Array.isArray(coords)||coords.length<2)return "";
  let out="";
  for(const pair of coords){
    if(!Array.isArray(pair)||pair.length!==2)continue;
    const pt=project(pair[0],pair[1]);
    out+=(out?"L":"M")+pt.x.toFixed(1)+","+pt.y.toFixed(1);
  }
  return out;
}
export function roadColor(kind){
  if(["motorway","trunk","primary"].includes(kind))return {color:"#c8b7a1",width:4.2};
  if(["secondary","tertiary"].includes(kind))return {color:"#f9f7ef",width:2.4};
  return {color:"#ffffff",width:1.25};
}
