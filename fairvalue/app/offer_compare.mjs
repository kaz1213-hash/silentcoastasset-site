/**
 * TANUKI FairValue — anonymous multi-offer comparison (research beta v0.4.4).
 * No user data persistence, transmission, AI valuation, or dealer recommendation.
 * Broker valuations are NON-BINDING expected transaction prices, never firm bids.
 * Each offer is an independently entered scenario; all mortgage debt is shared.
 */
import {
  parseMan,calculateBrokerage,calculateDirect,brokerageBreakEvenForDirect
} from "./seller_proceeds.mjs";

export const MAX_OFFERS=8;
export const EVIDENCE_TYPES=Object.freeze({
  unknown:"確認状況は未確認",
  written:"書面で提示された条件（本人入力）",
  oral:"口頭で伝えられた条件（本人入力）",
  scenario:"比較のための仮定額"
});
export const TIMING_TYPES=Object.freeze({
  unknown:"時期未確認",
  within_month:"1か月以内の見込み（本人入力）",
  one_to_three:"1〜3か月の見込み（本人入力）",
  after_three:"3か月超の見込み（本人入力）"
});
export const REDUCTION_TYPES=Object.freeze({
  unknown:"契約後減額・解除条件未確認",
  none_reported:"減額・解除条件なしと説明された（本人申告）",
  conditions:"減額・解除条件あり（内容を要確認）"
});

export function cleanLabel(text,fallback,max=40) {
  const normalized=String(text??"").normalize("NFKC").trim();
  if(normalized.length>max) throw new RangeError("名称・備考は"+max+"文字以内で入力してください。");
  if(/[\u0000-\u001F\u007F]/.test(normalized))
    throw new RangeError("入力文に制御文字が含まれています。");
  return normalized||fallback;
}

function requireEnum(value,available,field) {
  const key=String(value??"unknown");
  if(!Object.hasOwn(available,key))
    throw new RangeError(field+"の選択項目が不正です。");
  return key;
}

function cleanDate(value) {
  if(!value)return "";
  const date=String(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new RangeError("有効期限は年月日で入力してください。");
  const dt=new Date(date+"T00:00:00Z");
  if(!Number.isFinite(dt.valueOf())||dt.toISOString().slice(0,10)!==date)
    throw new RangeError("存在しない日付は入力できません。");
  return date;
}

export function classifyEntry(raw,index) {
  const kind=String(raw?.kind??"direct");
  if(kind!=="direct" && kind!=="brokerage")
    throw new RangeError("取引方法が不正です。");
  const saleMan=raw?.priceMan??"";
  if(String(saleMan).trim()==="") {
    // If any nondefault fields were supplied, fail instead of quietly dropping a quote.
    if(String(raw?.name??"").trim() || String(raw?.notes??"").trim() ||
       String(raw?.otherMan??"").trim() || String(raw?.manualFeeMan??"").trim() ||
       String(raw?.expiryDate??"").trim() ||
       String(raw?.evidence??"unknown")!=="unknown" ||
       String(raw?.timing??"unknown")!=="unknown" ||
       String(raw?.reduction??"unknown")!=="unknown")
      throw new RangeError("候補"+(index+1)+"には提示額・想定成約価格が必要です。");
    return null;
  }
  const priceYen=parseMan(saleMan,{required:true,label:"候補"+(index+1)+"の価格",allowZero:false});
  const name=cleanLabel(raw?.name,"候補"+(index+1),40);
  const evidence=requireEnum(raw?.evidence,EVIDENCE_TYPES,"提示の確認状況");
  const timing=requireEnum(raw?.timing,TIMING_TYPES,"売却時期");
  const reduction=requireEnum(raw?.reduction,REDUCTION_TYPES,"減額・解除条件");
  const notes=cleanLabel(raw?.notes,"",250);
  const expiryDate=cleanDate(raw?.expiryDate);
  const otherMan=raw?.otherMan??"";
  const feeMode=kind==="brokerage"?(raw?.feeMode??"ceiling"):"ceiling";
  const specialLowPrice=kind==="brokerage" && raw?.specialLowPrice===true;
  const manualFeeMan=feeMode==="manual"?raw?.manualFeeMan:"";
  if(kind==="direct" &&
     (String(raw?.manualFeeMan??"").trim()||raw?.specialLowPrice===true))
    throw new RangeError("直接買取に仲介報酬の設定が含まれています。");
  return {id:String(raw?.id??("entry_"+(index+1))),kind,name,
    saleMan:String(saleMan),priceYen,evidence,timing,reduction,notes,expiryDate,
    otherMan:String(otherMan),feeMode,manualFeeMan,specialLowPrice
  };
}

export function negotiationQuestions(entry) {
  const prompts=[];
  if(entry.kind==="brokerage") {
    prompts.push("この仲介査定額の根拠となる類似成約事例と、売却までの想定期間を教えてください。");
    if(entry.feeMode==="ceiling")
      prompts.push("仲介手数料の実際の税込合意額はいくらですか。");
  } else {
    prompts.push("業者が買主であること、買取代金の支払日・支払方法を文書で確認できますか。");
  }
  if(entry.evidence!=="written")
    prompts.push("提示した金額と前提条件を、書面で確認できますか。");
  if(entry.reduction!=="none_reported")
    prompts.push("契約後の減額・解除条項、費用負担、手付・違約金などの条件を文書で示せますか。");
  if(entry.timing==="unknown")
    prompts.push("契約締結・引渡し・代金入金の予定日はいつですか。");
  if(!entry.expiryDate)
    prompts.push("この提示額・査定額の有効期限はいつまでですか。");
  if(!entry.otherCostProvided)
    prompts.push("印紙代、登記・抵当権抹消、精算金、ローン返済手数料等を含めた売主負担費用はいくらですか。");
  return prompts;
}

export function compareOffers({offers,loanMan=""}={}) {
  if(!Array.isArray(offers)||offers.length>MAX_OFFERS||offers.length<2)
    throw new RangeError("2〜8件の候補を用意してください。");
  const sharedLoanYen=parseMan(loanMan,{label:"共通のローン残債"})??0;
  const entries=offers.map((raw,i)=>classifyEntry(raw,i)).filter(Boolean);
  if(entries.length<2)throw new RangeError("価格を入力した候補が2件以上必要です。");
  const ids=new Set(entries.map(entry=>entry.id));
  if(ids.size!==entries.length)throw new RangeError("内部候補IDが重複しています。");
  const results=entries.map(entry=>{
    const calc=entry.kind==="brokerage"
      ?calculateBrokerage({
        saleMan:entry.saleMan,otherMan:entry.otherMan,loanMan,
        feeMode:entry.feeMode,manualFeeMan:entry.manualFeeMan,
        specialLowPrice:entry.specialLowPrice
      })
      :calculateDirect({saleMan:entry.saleMan,otherMan:entry.otherMan,loanMan});
    const caution=[];
    if(entry.kind==="brokerage"){
      caution.push("仲介の査定額・売出想定額は成約を約束する提示ではありません。");
      if(entry.feeMode==="ceiling")
        caution.push("仲介手数料は合意額ではなく法定上限を仮置きしています。");
    } else caution.push("直接買取価格も契約締結と条件確定前は変更・撤回される場合があります。");
    if(entry.evidence==="unknown")caution.push("提示内容の書面・口頭の確認状況が未確認。");
    if(entry.evidence==="scenario")caution.push("比較のための仮定であり、実際に提示された額ではありません。");
    if(entry.reduction!=="none_reported")caution.push(REDUCTION_TYPES[entry.reduction]+"。");
    if(entry.timing==="unknown")caution.push("引渡し時期が未確認。");
    return {
      ...entry,kindLabel:entry.kind==="brokerage"?"仲介・想定成約額":"業者直接買取・提示額",
      ...calc,
      priceYen:entry.priceYen,
      evidenceLabel:EVIDENCE_TYPES[entry.evidence],
      timingLabel:TIMING_TYPES[entry.timing],
      reductionLabel:REDUCTION_TYPES[entry.reduction],
      isBinding:false, // Not inferable from user-selected document category
      caution,loanYen:sharedLoanYen,
      otherCostProvided:String(entry.otherMan).trim()!==""
    };
  });
  const ranked=results.slice().sort((a,b)=>b.proceedsYen-a.proceedsYen||
    offers.findIndex(x=>String(x.id)===a.id)-offers.findIndex(x=>String(x.id)===b.id));
  const highest=ranked[0];
  const lowest=ranked[ranked.length-1];
  const hasBroker=results.some(item=>item.kind==="brokerage");
  const hasDirect=results.some(item=>item.kind==="direct");
  const bestDirect=results.filter(item=>item.kind==="direct")
    .sort((a,b)=>b.proceedsYen-a.proceedsYen)[0]??null;
  const withBreakEven=results.map(item=>{
    const breakEvenYen=item.kind==="brokerage"&&item.feeMode==="ceiling"&&bestDirect
      ?brokerageBreakEvenForDirect({
        direct:bestDirect,brokerageOtherYen:item.otherYen,loanYen:sharedLoanYen,
        specialLowPrice:item.specialLowPrice
      }):null;
    return {...item,breakEvenYen,breakEvenReferenceId:breakEvenYen==null?null:bestDirect.id,
      negotiationQuestions:negotiationQuestions(item)};
  });
  const byId=new Map(withBreakEven.map(item=>[item.id,item]));
  return {
    version:"0.4.4",count:results.length,loanYen:sharedLoanYen,
    compared:ranked.map(item=>byId.get(item.id)),asEntered:withBreakEven,
    highestYen:highest.proceedsYen,lowestYen:lowest.proceedsYen,
    spreadYen:highest.proceedsYen-lowest.proceedsYen,
    includesBrokerage:hasBroker,includesDirect:hasDirect,
    missingOtherCostEstimates:results.filter(item=>!item.otherCostProvided).length,
    rankingLabel:"入力した金額・既知の費用だけで計算した手取り順（契約の優劣・確実性ではありません）",
    disclaimer:"仲介査定額は成約価格の保証ではなく、直接買取提示額も契約条件が確定するまで確約とは限りません。譲渡所得税、印紙税、登記費用、ローン返済手数料、精算金等の未入力額と売却に必要な時間・リスクは比較に含みません。"
  };
}

export function formatNotesForNegotiation(report) {
  if(!report?.compared?.length)return "";
  const yen=v=>(v<0?"−":"")+Math.abs(v).toLocaleString("ja-JP")+"円";
  const lines=[
    "TANUKI FairValue｜匿名の売却条件比較（利用者入力・交渉用）",
    "※売却額はすべて利用者入力の提示／想定額。仲介査定は成約保証ではありません。",
    "共通ローン返済："+yen(report.loanYen),
    ""
  ];
  for(const [i,r] of report.compared.entries()){
    lines.push((i+1)+". "+r.name+"｜"+r.kindLabel+"｜"+r.evidenceLabel,
      "価格："+yen(r.priceYen)+"／手数料："+yen(r.feeYen)+
      "／その他費用："+yen(r.otherYen)+"／手取り試算："+yen(r.proceedsYen),
      "引渡し："+r.timingLabel+"／減額・解除："+r.reductionLabel+
        (r.expiryDate?"／提示期限："+r.expiryDate:""),
      ...(r.notes?["メモ："+r.notes]:[]),
      ...(r.caution.length?["要確認："+r.caution.join("／")]:[]),
      "業者への確認事項："+r.negotiationQuestions.join("／"),
      ""
    );
  }
  lines.push(report.disclaimer);
  return lines.join("\n");
}
