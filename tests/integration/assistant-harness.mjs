import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadAssistant() {
  const sourceUrl = new URL("../../supabase/functions/gemini-assistant/index.ts", import.meta.url);
  let source = await readFile(sourceUrl, "utf8");
  source = source.replace(/import \{ createClient \} from "https:[^"]+";/, 'const createClient = () => { throw new Error("External services are not available in this local test"); };');
  source = source.replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, sourceUrl).href)}`);
  source = 'const Deno = { serve() {} };\n' + stripTypeScriptTypes(source);
  const dir = await mkdtemp(join(tmpdir(), "zakat-assistant-qa-"));
  try {
    const file = join(dir,"assistant.mjs");
    await writeFile(file,source);
    return await import(pathToFileURL(file));
  } finally { await rm(dir,{recursive:true,force:true}); }
}

const identifier = value => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(value)) throw Error("Unsafe test identifier");
  return `"${value}"`;
};
export function sqlClient(db, role = "authenticated") {
  function request(table) {
    const state = { operation:"select",columns:"*",filters:[],values:[],limit:undefined,order:[],one:false,count:false };
    const query = {
      select(columns = "*", options = {}) { state.columns=columns;state.count=!!options.count;return query; },
      insert(row) {state.operation="insert";state.row=row;return query;},
      update(row) {state.operation="update";state.row=row;return query;},
      delete() {state.operation="delete";return query;},
      eq(field,value) {state.values.push(value);state.filters.push(`${identifier(field)}=$${state.values.length}`);return query;},
      in(field,values) {const placeholders=values.map(value=>{state.values.push(value);return `$${state.values.length}`;});state.filters.push(`${identifier(field)} IN (${placeholders.join(",")})`);return query;},
      ilike(field,value) {state.values.push(value);state.filters.push(`${identifier(field)} ILIKE $${state.values.length}`);return query;},
      order(field,options={}) {state.order.push(identifier(field)+(options.ascending===false?" DESC":" ASC"));return query;},
      limit(value) {state.limit=Number(value);return query;},
      maybeSingle() {state.one=true;return query;},
      single() {state.one=true;state.required=true;return query;},
      async then(resolve,reject) {
        const columns=state.columns==="*"?"*":state.columns.split(",").map(identifier).join(",");
        const qualified="public."+identifier(table);
        let sql;
        if(state.operation==="insert") {
          const pairs=Object.entries(state.row).filter(([,value])=>value!==undefined);
          const placeholders=pairs.map(([,value])=>{state.values.push(value&&typeof value==="object"?JSON.stringify(value):value);return `$${state.values.length}`;});
          sql=`INSERT INTO ${qualified} (${pairs.map(([key])=>identifier(key)).join(",")}) VALUES (${placeholders.join(",")}) RETURNING ${columns}`;
        } else {
          const where=state.filters.length?" WHERE "+state.filters.join(" AND "):"";
          if(state.operation==="update") {
            const assignments=Object.entries(state.row).map(([key,value])=>{state.values.push(value);return `${identifier(key)}=$${state.values.length}`;});
            sql=`UPDATE ${qualified} SET ${assignments.join(",")}${where} RETURNING ${columns}`;
          } else if(state.operation==="delete") sql=`DELETE FROM ${qualified}${where} RETURNING ${columns}`;
          else sql=`SELECT ${state.count?"count(*)::int AS total":columns} FROM ${qualified}${where}${state.order.length?" ORDER BY "+state.order.join(","):""}${state.limit!==undefined?" LIMIT "+state.limit:""}`;
        }
        try {
          const result=await db.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${identifier(role)}`);return tx.query(sql,state.values);});
          const rows=JSON.parse(JSON.stringify(result.rows));
          if(state.required&&rows.length!==1)throw Error("Expected one row");
          return resolve({data:state.one?(rows[0]||null):rows,error:null,count:state.count?rows[0].total:undefined});
        } catch(error) {return resolve({data:null,error});}
      },
    };
    return query;
  }
  return {
    from:request,
    async rpc(name,args={}) {
      try {
        const pairs=Object.entries(args);
        const placeholders=pairs.map(([key],i)=>identifier(key)+" => $"+(i+1));
        const tableResult=name === "financial_integrity_report";
        const result=await db.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${identifier(role)}`);return tx.query(tableResult ? `SELECT * FROM public.${identifier(name)}(${placeholders.join(",")})` : `SELECT public.${identifier(name)}(${placeholders.join(",")}) AS value`,pairs.map(([,value])=>value&&typeof value==="object"?JSON.stringify(value):value));});
        return {data:tableResult ? result.rows : result.rows[0]?.value,error:null};
      } catch(error) {return {data:null,error};}
    },
  };
}
