/**
 * Immutable-reference, per-municipality indexes for the FairValue map.
 * Public transaction rows are kept unchanged. No imputation or aggregation
 * here: each lookup only selects the exact source municipality.
 */
const key=(prefecture,city)=>prefecture+"\u0000"+city;

export function indexMunicipalityRows(rows){
  const byCity=new Map();
  for(const row of rows??[]){
    if(row?.category!=="condo"||!row.prefecture||!row.city)continue;
    const id=key(row.prefecture,row.city);
    if(!byCity.has(id))byCity.set(id,[]);
    byCity.get(id).push(row);
  }
  return byCity;
}

export function selectMunicipalityRows(coreIndex,supplementIndex,prefecture,city){
  const id=key(prefecture,city);
  const original=coreIndex?.get(id)??[];
  const supplemental=supplementIndex?.get(id)??[];
  if(!original.length)return supplemental;
  if(!supplemental.length)return original;
  // This is a safety fallback. The reviewed index normally forbids a
  // municipality appearing in both the core and supplemental datasets.
  return original.concat(supplemental);
}
