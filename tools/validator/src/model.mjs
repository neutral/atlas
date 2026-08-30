export class Diagnostic {
  constructor(code, severity, message, location = {}) {
    this.code = code; this.severity = severity; this.message = message;
    for (const key of ['path','pointer','line','column','details']) if (location[key] !== undefined) this[key] = location[key];
  }
}
export class ValidationResult {
  constructor({ profile, specificationRevision='0.7.0', complete=true, diagnostics=[], normalized=null }) {
    this.profile=profile; this.complete=complete; this.diagnostics=[...diagnostics].sort(compareDiagnostics);
    this.valid=complete && !this.diagnostics.some((item)=>item.severity==='error');
    this.specificationRevision=specificationRevision;
    this.implementation={name:'atlas-reference-validator',version:'0.7.0',status:'working'};
    if (normalized !== null && this.valid) this.normalized=normalized;
  }
  toJSON(){ return {profile:this.profile,complete:this.complete,valid:this.valid,specificationRevision:this.specificationRevision,implementation:this.implementation,diagnostics:this.diagnostics,...(this.normalized!==undefined?{normalized:this.normalized}:{})}; }
}
export function compareCodePoints(left,right){ const a=Array.from(String(left)),b=Array.from(String(right)); const n=Math.min(a.length,b.length); for(let i=0;i<n;i++){const d=a[i].codePointAt(0)-b[i].codePointAt(0);if(d!==0)return d;}return a.length-b.length; }
export function compareDiagnostics(left,right){ for(const key of ['path','line','column','code','message']){const a=left[key]??'',b=right[key]??'';if(typeof a==='number'&&typeof b==='number'){if(a!==b)return a-b;}else{const c=compareCodePoints(a,b);if(c!==0)return c;}}return 0; }
