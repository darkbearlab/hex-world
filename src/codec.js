// 把含 TypedArray 的狀態物件轉成可 JSON 化的格式（用於打包創世檔），以及反向還原
const TYPES={Float32Array,Float64Array,Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array};
const b64e=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)};
const b64d=s=>{const bin=atob(s),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return u8};
export function encode(v){
  if(ArrayBuffer.isView(v))return {$t:v.constructor.name,$d:b64e(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
  if(Array.isArray(v))return v.map(encode);
  if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=encode(v[k]);return o}
  return v}
export function decode(v){
  if(v&&typeof v==='object'&&v.$t){const u8=b64d(v.$d);return new TYPES[v.$t](u8.buffer.slice(0))}
  if(Array.isArray(v))return v.map(decode);
  if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=decode(v[k]);return o}
  return v}
