/**
 * Recovery for chunk load failures after a deployment.
 *
 * Every production build rewrites the hashed names under /_next/static, so a
 * page that stays open across a build — an iOS PWA is normally never reloaded —
 * keeps referencing chunks that no longer exist on the server. The next lazy
 * import (a route change, opening a file tab, mounting a panel) then rejects
 * with ChunkLoadError and the app stays broken until the tab is closed and
 * reopened. Reloading is the only fix: the fresh HTML carries the new chunk map,
 * and navigation is network-first in the service worker so it cannot be served
 * from a stale cache.
 *
 * The cooldown keeps a genuinely dead or rolled-back server from turning that
 * recovery into a reload loop; the listener is installed from an inline script
 * because the page bundle itself can be the missing chunk.
 */
export const CHUNK_RECOVERY_STORAGE_KEY = "pi-web:chunk-recovery";
export const CHUNK_RECOVERY_COOLDOWN_MS = 15_000;

/** Error constructor names that always mean a chunk failed to load. */
export const CHUNK_FAILURE_ERROR_NAMES = ["ChunkLoadError"];

/**
 * Message patterns for browsers that report a chunk failure as a plain Error or
 * TypeError instead of webpack's ChunkLoadError.
 */
export const CHUNK_FAILURE_MESSAGE_SOURCES = [
  "Loading chunk .+ failed",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

export function isChunkLoadFailure(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const shaped = typeof value === "string"
    ? { message: value }
    : value as { name?: unknown; message?: unknown };
  if (CHUNK_FAILURE_ERROR_NAMES.includes(String(shaped.name ?? ""))) return true;
  const message = String(shaped.message ?? "");
  return CHUNK_FAILURE_MESSAGE_SOURCES.some((source) => new RegExp(source, "i").test(message));
}

export const CHUNK_RECOVERY_SCRIPT = `(function(){
var KEY=${JSON.stringify(CHUNK_RECOVERY_STORAGE_KEY)};
var COOLDOWN_MS=${CHUNK_RECOVERY_COOLDOWN_MS};
var ERROR_NAMES=${JSON.stringify(CHUNK_FAILURE_ERROR_NAMES)};
var MESSAGE_SOURCES=${JSON.stringify(CHUNK_FAILURE_MESSAGE_SOURCES)};
function isChunkFailure(value){
if(value===null||value===undefined)return false;
if(typeof value==="string")value={message:value};
if(ERROR_NAMES.indexOf(String(value.name||""))>=0)return true;
var message=String(value.message||"");
for(var i=0;i<MESSAGE_SOURCES.length;i++){if(new RegExp(MESSAGE_SOURCES[i],"i").test(message))return true}
return false;
}
function isNextStaticAsset(target){
if(!target||typeof target!=="object")return false;
var tag=target.tagName?String(target.tagName).toUpperCase():"";
if(tag!=="SCRIPT"&&tag!=="LINK")return false;
return String(target.src||target.href||"").indexOf("/_next/static/")>=0;
}
function reload(){
var now=Date.now();
try{
if(now-Number(sessionStorage.getItem(KEY)||0)<COOLDOWN_MS)return;
sessionStorage.setItem(KEY,String(now));
}catch(e){}
window.location.reload();
}
function recover(reason){
if(isChunkFailure(reason))reload();
}
window.addEventListener("unhandledrejection",function(event){recover(event&&event.reason)});
window.addEventListener("error",function(event){
var target=event&&event.target;
if(isNextStaticAsset(target)){reload();return}
recover(event&&(event.error||event.message));
},true);
})();`;
