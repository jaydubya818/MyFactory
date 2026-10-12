import {readFileSync} from 'node:fs';
const pins=JSON.parse(readFileSync(new URL('./retained-evidence-pins.json',import.meta.url)));
// Only reviewed immutable record/source bindings. No discovery or caller fallback.
export function retainedEvidenceBinding(id,record){
  const historical=Object.hasOwn(pins.entries,id)?pins.entries[id]:null;
  const candidates=[historical,...(pins.currentEntries??[]).filter(pin=>pin.id===id)].filter(Boolean);
  const matches=candidates.filter(pin=>record?.sha256===pin.recordSha256);
  const pin=matches.length===1?matches[0]:null;
  if(!pin||!pin.dependencies||!Object.keys(pin.dependencies).length||Object.values(pin.dependencies).some(value=>typeof value!=='string'||!value))throw Error('RETAINED_EVIDENCE_PROVENANCE_UNQUALIFIED:'+id);
  return Object.freeze({dependencies:Object.freeze({...pin.dependencies}),checks:pin.checks?Object.freeze([...pin.checks]):null,reviewer:pin.reviewer??null});
}
export function retainedEvidenceDependencies(id,record){
  return retainedEvidenceBinding(id,record).dependencies;
}
export function validateEvidenceSelection(selection){
  if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('EVIDENCE_SELECTION_INVALID');
  for(const [id,ref]of Object.entries(selection)){
    if(!Object.hasOwn(pins.entries,id)||!ref||Object.keys(ref).sort().join(',')!=='path,root'||typeof ref.root!=='string'||!ref.root||typeof ref.path!=='string'||!ref.path||ref.path.startsWith('/')||ref.path.split('/').includes('..'))throw Error('EVIDENCE_SELECTION_INVALID:'+id);
  }
}
