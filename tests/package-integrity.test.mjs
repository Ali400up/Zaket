import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import vm from "node:vm";
import { storageKey } from "../js/storage-scope.js";
const root=new URL("../",import.meta.url);
async function files(dir=root) {
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.name==="node_modules")continue;
    const path=new URL(entry.name+(entry.isDirectory()?"/":""),dir);
    result.push(...(entry.isDirectory()?await files(path):[path]));
  }
  return result;
}
test("the delivered installation has one SQL file, no PDF and no duplicate HTML ids",async()=>{
  const paths=await files();
  assert.deepEqual(paths.filter(p=>p.pathname.endsWith(".sql")).map(p=>p.pathname.split("/").at(-1)),["database_complete.sql"]);
  assert.equal(paths.filter(p=>p.pathname.endsWith(".pdf")).length,0);
  const sql=await readFile(new URL("supabase/database_complete.sql",root),"utf8");
  assert.doesNotMatch(sql,/^\s*(?:--|\/\*)/m);
  const html=await readFile(new URL("index.html",root),"utf8");
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.match(html,/autocomplete="username"/);
});
test("all offline assets and every application module are available locally",async()=>{
  const source=await readFile(new URL("service-worker.js",root),"utf8");
  const context={self:{addEventListener(){}},URL,Set};
  vm.runInNewContext(source+";globalThis.assets=STATIC_ASSETS",context);
  const assets=[...context.assets];
  assert.equal(new Set(assets).size,assets.length);
  for(const path of assets){const url=new URL(path==="/"?"index.html":path.slice(1),root);assert.ok((await stat(url)).isFile(),path);}
  for(const path of await files(new URL("js/",root)))assert.ok(assets.includes("/js/"+path.pathname.split("/").at(-1)),path.pathname);
  for(const name of ["css/styles.css","css/login.css"]) {
    const url=new URL(name,root);const css=await readFile(url,"utf8");
    for(const m of css.matchAll(/url\(["']?([^\s)'";]+)["']?\)/g)) {
      if(m[1].startsWith("data:"))continue;
      assert.ok(!/^https?:/.test(m[1]),"font or image depends on external network");
      assert.ok((await stat(new URL(m[1],url))).isFile());
    }
  }
});
test("local Tajawal files are complete TrueType fonts with distinct weights",async()=>{
  const sizes=[];
  for(const weight of ["Regular","Medium","Bold","ExtraBold"]){
    const buffer=await readFile(new URL(`assets/fonts/Tajawal-${weight}.ttf`,root));
    assert.equal(buffer.readUInt32BE(0),0x00010000);
    const count=buffer.readUInt16BE(4);assert.ok(count>5&&count<100);
    for(let i=0;i<count;i++){const entry=12+i*16;assert.ok(buffer.readUInt32BE(entry+8)+buffer.readUInt32BE(entry+12)<=buffer.length);}
    sizes.push(buffer.length);
  }
  assert.equal(new Set(sizes).size,4);
  assert.match(await readFile(new URL("assets/fonts/OFL.txt",root),"utf8"),/SIL OPEN FONT LICENSE/);
});
test("local queues and cached sessions cannot cross Supabase projects or demo mode",()=>{
  const a={supabaseUrl:"https://one.supabase.co",demoMode:false};
  const b={supabaseUrl:"https://two.supabase.co",demoMode:false};
  for(const name of ["offline_queue","live_cache","offline_session"]){
    assert.notEqual(storageKey(name,a),storageKey(name,b));
    assert.notEqual(storageKey(name,a),storageKey(name,{...a,demoMode:true}));
    assert.equal(storageKey(name,a),storageKey(name,{...a,supabaseUrl:a.supabaseUrl+"/"}));
  }
});
