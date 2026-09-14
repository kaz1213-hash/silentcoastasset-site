function safeKey(value) {
  const key=String(value??'').trim();
  if (!key || key.length>256 || /[\r\n\0]/.test(key)) throw new Error('RATE_KEY_INVALID');
  return key;
}

export class FixedWindowRateLimiter {
  constructor({ windowMs=60_000, maxEntries=10_000 }={}) {
    this.windowMs=Math.max(1000,Number(windowMs)||60_000);
    this.maxEntries=Math.max(100,Number(maxEntries)||10_000);
    this.rows=new Map();
  }

  cleanup(now=Date.now()) {
    for (const [key,row] of this.rows) if (row.resetAt<=now) this.rows.delete(key);
    if (this.rows.size<=this.maxEntries) return;
    const ordered=[...this.rows.entries()].sort((a,b)=>a[1].resetAt-b[1].resetAt);
    for (const [key] of ordered.slice(0,this.rows.size-this.maxEntries)) this.rows.delete(key);
  }

  hit(key,{ limit=60, now=Date.now() }={}) {
    const id=safeKey(key);
    const cap=Math.max(1,Math.min(10_000,Number(limit)||60));
    this.cleanup(now);
    let row=this.rows.get(id);
    if (!row || row.resetAt<=now) row={count:0,resetAt:now+this.windowMs};
    row.count+=1;
    this.rows.set(id,row);
    const allowed=row.count<=cap;
    return {
      allowed,
      limit:cap,
      remaining:Math.max(0,cap-row.count),
      reset_at:row.resetAt,
      retry_after_seconds:allowed?0:Math.max(1,Math.ceil((row.resetAt-now)/1000)),
    };
  }
}
