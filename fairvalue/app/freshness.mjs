/**
 * Separate 'latest official publicly selectable quarter' from
 * 'date of most recent transaction' and 'date we checked the official page'.
 */
const DAY=86_400_000;
export function quarterOrdinal(value) {
  const m=/^(20\d{2})Q([1-4])$/.exec(String(value||""));
  return m?Number(m[1])*4+Number(m[2])-1:null;
}
export function quarterEndUtc(value) {
  const n=quarterOrdinal(value);
  if(n==null)return null;
  const year=Math.floor(n/4),quarter=n%4+1;
  return new Date(Date.UTC(year,quarter*3,0,23,59,59,999));
}
export function quarterLabel(value) {
  const n=quarterOrdinal(value);
  if(n==null)return "時期不明";
  return Math.floor(n/4)+"年第"+(n%4+1)+"四半期";
}
export function analyzeFreshness(metadata,officialSnapshot,asOf=new Date()){
  const latest=metadata?.periodMax??null;
  const latestIndex=quarterOrdinal(latest);
  const officialIndex=quarterOrdinal(officialSnapshot?.latestSelectablePeriod);
  const checkedUtc=officialSnapshot?.checkedAtUtc?new Date(officialSnapshot.checkedAtUtc):null;
  const checkedValid=checkedUtc && Number.isFinite(checkedUtc.getTime())&&checkedUtc.getTime()<=asOf.getTime()+DAY;
  const daysSinceCheck=checkedValid?Math.max(0,Math.floor((asOf.getTime()-checkedUtc.getTime())/DAY)):null;
  const asOfEnd=quarterEndUtc(latest);
  const daysSinceQuarter=asOfEnd?Math.max(0,Math.floor((asOf.getTime()-asOfEnd.getTime())/DAY)):null;
  let state="UNVERIFIED";
  if(latestIndex!==null && officialIndex!==null && checkedValid && daysSinceCheck!==null && daysSinceCheck<=30) {
    state=officialIndex>latestIndex?"OFFICIAL_UPDATE_AVAILABLE":
      officialIndex===latestIndex?"OFFICIAL_MATCHES_LOCAL":"LOCAL_PERIOD_AHEAD_OF_OFFICIAL";
  } else if(officialIndex!==null && checkedValid && daysSinceCheck>30) {
    state="OFFICIAL_CHECK_EXPIRED";
  }
  return {
    state,
    latestRecordQuarter:latest,
    latestRecordQuarterLabel:quarterLabel(latest),
    latestOfficialQuarter:officialSnapshot?.latestSelectablePeriod??null,
    latestOfficialLabel:quarterLabel(officialSnapshot?.latestSelectablePeriod),
    daysSinceCheck,
    daysSinceQuarter,
    checkedAtUtc:checkedValid?checkedUtc.toISOString():null,
    checkedDateJst:checkedValid?checkedUtc.toLocaleDateString("ja-JP",{timeZone:"Asia/Tokyo"}):null,
    isCurrentMarketPrice:false,
  };
}
