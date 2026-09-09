import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { platform } from "./platform.mjs";
import { loadAssistant, sqlClient } from "./assistant-harness.mjs";

const require = createRequire(process.env.ZAKAT_QA_PACKAGE || new URL("./package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
let db = new PGlite({ extensions: { pgcrypto } });
const installer = await readFile(new URL("../../supabase/database_complete.sql", import.meta.url), "utf8");
let phase = "clean installation";
const userId="00000000-0000-4000-8000-000000000001";
const approvedHeaders='{"x-device-fingerprint":"qa-approved-device"}';
const scalar=async(sql,values=[])=>Object.values((await db.query(sql,values)).rows[0])[0];
let passes=0;
function pass(message){passes++;console.log("PASS:",message);}
try {
  await db.exec(platform);
  await db.exec(installer);
  assert.deepEqual((await db.query("select * from public.system_contract_check() where status<>'ok'")).rows,[]);
  assert.deepEqual((await db.query("select * from public.rls_contract_check() where not rls_enabled")).rows,[]);
  assert.equal(Number(await scalar("select count(*) from auth.users")),0);
  assert.equal(Number(await scalar("select count(*) from public.cash_receipts")),0);
  assert.equal(Number(await scalar("select current_balance from public.cashboxes where code='CASH-MAIN-YER'")),0);
  assert.equal(Number(await scalar("select count(*) from public.health_conditions")),11);
  assert.equal(Number(await scalar("select count(*) from public.beneficiary_categories")),10);
  assert.equal(Number(await scalar("select count(*) from information_schema.columns where table_schema='public' and table_name='items' and column_name='unit'")),0);
  const definitions=(await db.query("select pg_get_functiondef(p.oid) source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prokind='f'")).rows;
  assert.ok(definitions.every(row=>!(/\b(wallet_providers|bulk_disbursements|disbursement_results|message_templates)\b/.test(row.source))));
  pass("clean schema, RLS, linked units and real zero-balance seed data");

  await db.query("insert into auth.users(id,email) values($1,'u777123456@zakat.local')",[userId]);
  await db.exec("select public.bootstrap_first_admin('777123456','مدير الاختبار','qa-approved-device')");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]);
  await db.query("select set_config('request.headers',$1,false)",[approvedHeaders]);
  const caller=sqlClient(db),admin=sqlClient(db,"service_role");
  const api=await loadAssistant();
  const profile={id:userId,full_name:"مدير الاختبار",role:"admin"};
  const conversationId=await scalar("insert into public.ai_conversations(user_id,title) values($1,'QA') returning id",[userId]);
  const context=()=>({caller,admin,profile,userId,conversationId,lastAction:null});
  const visitedWorkflows=new Set();
  const read=async(table,id)=>(await db.query(`select * from public.${table} where id=$1`,[id])).rows[0];
  async function propose(tool,args){const ctx=context();const result=await api.executeTool(tool,args,ctx);assert.equal(result.pending_confirmation,true);if(tool==="propose_workflow_action")visitedWorkflows.add(args.operation);return read("ai_action_requests",result.action_request.id);}
  async function execute(action){return api.executeConfirmedAction(action,context());}
  async function create(entity,fields){return (await execute(await propose("propose_mutation",{entity,operation:"create",fields}))).record;}
  async function workflow(operation,record_id,reason="اختبار محاسبي موثق"){return execute(await propose("propose_workflow_action",{operation,record_id,reason}));}
  const health=await caller.rpc("get_system_health");
  assert.ifError(health.error);assert.equal(health.data.status,"ok");assert.equal(health.data.financial_checks_total,14);
  for(const view of (await db.query("select object_name from system_contract_check() where object_type='view'")).rows){const result=await caller.from(view.object_name).select("*").limit(1);assert.ifError(result.error);}
  for(const [entity,[table,columns,search]]of Object.entries(api.SEARCH_REGISTRY)) {const result=await caller.from(table).select(columns).ilike(search,"%اختبار%").limit(1);assert.ifError(result.error);}
  for(const spec of Object.values(api.ACTION_REGISTRY)){const result=await caller.from(spec.table).select(spec.allowedFields.join(",")).limit(0);assert.ifError(result.error);}
  pass("approved admin health; all screen views, assistant search queries and mutation columns exist");

  const capability=await api.executeTool("list_assistant_capabilities",{},context());
  assert.equal(capability.records.length,20);assert.equal(capability.documents.length,4);assert.equal(capability.workflows.length,27);
  const auditor=await api.executeTool("list_assistant_capabilities",{},{...context(),profile:{role:"auditor"}});
  assert.equal(auditor.records.length,0);assert.equal(auditor.workflows.length,0);assert.equal(auditor.documents.length,0);
  await assert.rejects(api.executeTool("propose_mutation",{entity:"donor",operation:"create",fields:{name:"ممنوع",donor_type:"individual"}},{...context(),profile:{role:"auditor"}}),/صلاحية/);
  const sar=await scalar("select id from public.currencies where code='SAR'");
  const currencyAction=await propose("propose_mutation",{entity:"currency",operation:"update",record_id:sar,fields:{rate_to_base:140.123456}});
  await execute(currencyAction);assert.equal(Number((await read("currencies",sar)).rate_to_base),140.123456);
  pass("role-filtered capabilities, denied auditor writes and six-decimal exchange rates");

  phase="assistant confirmed financial creation";
  const cashbox=(await db.query("select * from public.cashboxes where code='CASH-MAIN-YER'")).rows[0];
  const donor=await create("donor",{name:"متبرع الاختبار",donor_type:"individual"});
  const receiptAction=await propose("propose_mutation",{entity:"cash_receipt",operation:"create",fields:{donor_id:donor.id,cashbox_id:cashbox.id,amount:1000,currency:"YER",method:"cash"}});
  assert.equal(Number(await scalar("select count(*) from cash_receipts")),0);
  const receipt=(await execute(receiptAction)).record;
  assert.equal(receipt.status,"draft");
  await execute(receiptAction);assert.equal(Number(await scalar("select count(*) from cash_receipts")),1);
  const posting=await propose("propose_workflow_action",{operation:"post_cash_receipt",record_id:receipt.id});
  await execute(posting);await execute(posting);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[cashbox.id])),1000);
  const target=await create("cashbox",{name:"صندوق اختبار",branch_id:cashbox.branch_id,currency:"YER",opening_balance:0});
  const transfer=await create("cash_transfer",{from_cashbox_id:cashbox.id,to_cashbox_id:target.id,amount:200});
  await workflow("post_cash_transfer",transfer.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[target.id])),200);
  await workflow("cancel_cash_transfer",transfer.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[target.id])),0);
  pass("proposal changes no business data; confirmed receipt and transfer post once and cancellation reverses balances");

  phase="cash funding, allocation and beneficiary payment";
  const campaign=await create("campaign",{name:"حملة اختبار",campaign_type:"mixed",start_date:"2026-09-01",end_date:"2026-09-30",currency:"YER"});
  await workflow("open_campaign",campaign.id);
  const funding=await create("campaign_funding",{campaign_id:campaign.id,cashbox_id:cashbox.id,amount:500,currency:"YER"});
  await workflow("post_campaign_funding",funding.id);
  const delegate=await create("delegate",{full_name:"موزع الاختبار",phone:"777987654",delegate_type:"both"});
  const assignment=await create("campaign_distributor",{campaign_id:campaign.id,delegate_id:delegate.id,cashbox_id:cashbox.id,area_name:"صنعاء",allocated_amount:300});
  const category=await scalar("select id from beneficiary_categories limit 1");
  const beneficiary=await create("beneficiary",{full_name:"مستفيد الاختبار",category_id:category,family_size:2,delegate_id:delegate.id});
  await workflow("reject_beneficiary",beneficiary.id);
  await workflow("approve_beneficiary",beneficiary.id);
  await workflow("toggle_beneficiary",beneficiary.id);
  await workflow("toggle_beneficiary",beneficiary.id);
  const payment=await create("cash_payment",{campaign_id:campaign.id,cashbox_id:cashbox.id,delegate_id:delegate.id,beneficiary_id:beneficiary.id,amount:100,currency:"YER",delivery_method:"cash"});
  await workflow("approve_cash_payment",payment.id);
  await workflow("post_cash_payment",payment.id);
  assert.equal(Number(await scalar("select spent_amount from campaign_distributors where campaign_id=$1",[campaign.id])),100);
  await workflow("cancel_cash_payment",payment.id);
  assert.equal(Number(await scalar("select spent_amount from campaign_distributors where campaign_id=$1",[campaign.id])),0);
  pass("campaign funding, distributor allocation, beneficiary approval, cash payment and reversal");

  phase="atomic in-kind document, valuation and stock";
  const unit=await scalar("select id from units where name='قطعة'");
  const currency=await scalar("select id from currencies where code='YER'");
  const warehouse=await scalar("select id from warehouses where code='WH-MAIN'");
  const item=await create("item",{name:"صنف اختبار",category:"غذاء",unit_id:unit,purchase_price:20,purchase_currency_id:currency});
  const documentAction=await propose("propose_document",{entity:"in_kind_receipt",fields:{donor_id:donor.id,warehouse_id:warehouse,received_by_name:"أمين المخزن"},details:[{item_id:item.id,quantity:10,damaged_qty:2}]});
  const document=(await execute(documentAction)).record;
  await execute(documentAction);assert.equal(Number(await scalar("select count(*) from in_kind_receipts")),1);
  const details=await api.executeTool("get_document_details",{entity:"in_kind_receipt",record_id:document.id},context());
  await execute(await propose("propose_document",{entity:"in_kind_receipt",record_id:document.id,fields:{donor_id:donor.id,warehouse_id:warehouse,received_by_name:"مستلم الاختبار"},details:details.details}));
  await db.query("update items set purchase_price=99 where id=$1",[item.id]);
  assert.equal(Number(await scalar("select unit_cost from in_kind_receipt_details where receipt_id=$1",[document.id])),20);
  await workflow("post_in_kind_receipt",document.id);
  assert.equal(Number(await scalar("select available_qty from v_items_inventory where id=$1",[item.id])),8);
  const inkindFunding=(await execute(await propose("propose_document",{entity:"campaign_in_kind_funding",fields:{campaign_id:campaign.id,warehouse_id:warehouse},details:[{item_id:item.id,quantity:3}]}))).record;
  await workflow("post_campaign_in_kind_funding",inkindFunding.id);
  const basket=(await execute(await propose("propose_document",{entity:"basket",fields:{name:"سلة اختبار",campaign_id:campaign.id},details:[{item_id:item.id,quantity:1,required:true}]}))).record;
  assert.equal(Number(await scalar("select count(*) from basket_items where basket_id=$1",[basket.id])),1);
  const inkindPayment=(await execute(await propose("propose_document",{entity:"in_kind_payment",fields:{campaign_id:campaign.id,delegate_id:delegate.id,beneficiary_id:beneficiary.id},details:[{item_id:item.id,quantity:1}]}))).record;
  await workflow("approve_in_kind_payment",inkindPayment.id);
  await workflow("post_in_kind_payment",inkindPayment.id);
  assert.equal(Number(await scalar("select available_qty from v_items_inventory where id=$1",[item.id])),7);
  await workflow("cancel_in_kind_payment",inkindPayment.id);
  await workflow("cancel_campaign_in_kind_funding",inkindFunding.id);
  await workflow("cancel_in_kind_receipt",document.id);
  assert.equal(Number(await scalar("select available_qty from v_items_inventory where id=$1",[item.id])),0);
  pass("all four atomic document types; fixed historical price, stock posting and complete reversal");

  phase="settlement, currency exchange and account closing";
  await workflow("toggle_campaign_distributor",assignment.id);
  await workflow("toggle_campaign_distributor",assignment.id);
  await workflow("settle_campaign_distributor",assignment.id);
  assert.equal(Number((await read("campaign_distributors",assignment.id)).remaining_amount),0);
  await workflow("reopen_campaign_distributor",assignment.id);
  assert.equal(Number((await read("campaign_distributors",assignment.id)).remaining_amount),300);
  await workflow("settle_campaign_distributor",assignment.id);
  await workflow("cancel_campaign_funding",funding.id);
  const foreignBox=await create("cashbox",{name:"صندوق سعودي للاختبار",branch_id:cashbox.branch_id,currency:"SAR",opening_balance:0});
  const exchange=await create("currency_exchange",{from_cashbox_id:cashbox.id,to_cashbox_id:foreignBox.id,from_amount:700,exchange_rate:.007143,to_amount:5,fees:1});
  await workflow("post_currency_exchange",exchange.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[foreignBox.id])),5);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[cashbox.id])),299);
  const foreignTarget=await create("cashbox",{name:"صندوق تحويل سعودي",branch_id:cashbox.branch_id,currency:"SAR",opening_balance:0});
  const revisedTransfer=await create("cash_transfer",{from_cashbox_id:cashbox.id,to_cashbox_id:target.id,amount:1});
  await execute(await propose("propose_mutation",{entity:"cash_transfer",operation:"update",record_id:revisedTransfer.id,fields:{from_cashbox_id:foreignBox.id,to_cashbox_id:foreignTarget.id}}));
  assert.equal((await read("cash_transfers",revisedTransfer.id)).currency,"SAR");
  await workflow("post_cash_transfer",revisedTransfer.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[foreignTarget.id])),1);
  await workflow("cancel_cash_transfer",revisedTransfer.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[foreignBox.id])),5);
  await workflow("cancel_currency_exchange",exchange.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[cashbox.id])),1000);
  await workflow("cancel_cash_receipt",receipt.id);
  assert.equal(Number(await scalar("select current_balance from cashbox_balances where id=$1",[cashbox.id])),0);
  const closing=await create("account_closing",{campaign_id:campaign.id,closing_type:"full",notes:"إقفال اختباري"});
  assert.equal((await read("campaigns",campaign.id)).status,"closed");
  await workflow("reopen_account_closing",closing.id);
  assert.equal((await read("account_closings",closing.id)).status,"reopened");
  const otherDevice=await scalar("insert into authorized_devices(user_id,device_name,fingerprint,platform,status) values($1,'جهاز اختبار إضافي','qa-other-device','test','pending') returning id",[userId]);
  await workflow("toggle_authorized_device",otherDevice);
  await workflow("toggle_authorized_device",otherDevice);
  assert.equal((await read("authorized_devices",otherDevice)).status,"blocked");
  const currentDevice=await scalar("select id from authorized_devices where fingerprint='qa-approved-device'");
  await assert.rejects(workflow("toggle_authorized_device",currentDevice),/لا يمكن حظر الجهاز/);
  assert.equal(visitedWorkflows.size,27);
  pass("all 27 workflow actions exercised, including exchange fees, settlement, closing, approvals and device status");

  phase="reference creation and guarded deletion";
  const extraBranch=await create("branch",{name:"فرع اختبار",governorate:"صنعاء"});
  const extraWarehouse=await create("warehouse",{name:"مخزن اختبار",branch_id:extraBranch.id,address:"صنعاء",manager_name:"أمين"});
  const extraUnit=await create("unit",{name:"وحدة اختبار",symbol:"و"});
  const extraCategory=await create("beneficiary_category",{name:"فئة اختبار",priority:2});
  const extraHealth=await create("health_condition",{name:"حالة اختبار",priority:3});
  const extraCurrency=await create("currency",{code:"TST",name:"عملة اختبار",symbol:"ت",rate_to_base:2.123456,decimal_places:2});
  const assignmentPermission=await create("cashbox_user",{cashbox_id:cashbox.id,user_id:userId,can_receive:true,can_pay:true,daily_limit:100});
  for(const [entity,row]of [["warehouse",extraWarehouse],["branch",extraBranch],["unit",extraUnit],["beneficiary_category",extraCategory],["health_condition",extraHealth],["cashbox_user",assignmentPermission]]) {
    await execute(await propose("propose_mutation",{entity,operation:"delete",record_id:row.id}));
  }
  const spareDonor=await create("donor",{name:"متبرع غير مرتبط",donor_type:"individual"});
  const oldDelete=await propose("propose_mutation",{entity:"donor",operation:"delete",record_id:spareDonor.id});
  await db.query("update donors set name='اسم محدث' where id=$1",[spareDonor.id]);
  await assert.rejects(execute(oldDelete),/تغير السجل/);
  assert.ok(await read("donors",spareDonor.id));
  await execute(await propose("propose_mutation",{entity:"donor",operation:"delete",record_id:spareDonor.id}));
  assert.equal(await read("donors",spareDonor.id),undefined);
  await assert.rejects(execute(await propose("propose_mutation",{entity:"donor",operation:"delete",record_id:donor.id})),error=>["23001","23503"].includes(error.code)&&/cash_receipts_donor_id_fkey/.test(error.message));
  assert.ok(await read("donors",donor.id));
  await assert.rejects(api.prepareMutation(caller,{role:"supervisor"},"donor","delete",donor.id,{}),/مدير النظام/);
  pass("all 20 record types created; atomic admin-only deletion respects changes and referenced financial records");

  phase="stale proposal and atomic rollback";
  const pendingReceipt=await create("cash_receipt",{donor_id:donor.id,cashbox_id:cashbox.id,amount:50,currency:"YER",method:"cash"});
  const stale=await propose("propose_workflow_action",{operation:"post_cash_receipt",record_id:pendingReceipt.id});
  await db.query("update cash_receipts set amount=75 where id=$1",[pendingReceipt.id]);
  await assert.rejects(execute(stale),/تغير السجل/);
  assert.equal((await read("cash_receipts",pendingReceipt.id)).status,"draft");
  const badDoc=await propose("propose_document",{entity:"in_kind_receipt",fields:{donor_id:donor.id,warehouse_id:warehouse,received_by_name:"أمين"},details:[{item_id:crypto.randomUUID(),quantity:1}]});
  const oldCount=Number(await scalar("select count(*) from in_kind_receipts"));
  await assert.rejects(execute(badDoc));
  assert.equal(Number(await scalar("select count(*) from in_kind_receipts")),oldCount);
  pass("changed records reject confirmation; invalid detail rolls back the document header");

  phase="financial integrity and backup export";
  const integrity=await caller.rpc("financial_integrity_report");
  assert.ifError(integrity.error);
  assert.ok(integrity.data.every(check=>check.ok===true),JSON.stringify(integrity.data));
  const session=(await caller.rpc("backup_v3_start_export",{p_scope:"business",p_consistent:false}));
  assert.ifError(session.error);
  for(const table of session.data.tables) {
    const result=await caller.rpc("backup_v3_export_part",{p_session_id:session.data.session_id,p_table:table.table,p_after_id:null,p_limit:150});
    assert.ifError(result.error);assert.equal(result.data.failed,undefined);
  }
  const finished=await caller.rpc("backup_v3_finish_export",{p_session_id:session.data.session_id});
  assert.ifError(finished.error);assert.equal(finished.data.ready,true);
  pass("14 financial integrity checks and every current business backup table");

  phase="missing view diagnostics";
  await db.exec("alter view campaign_balances rename to qa_missing_campaign_balances");
  const partial=await caller.rpc("get_system_health");
  assert.ifError(partial.error);assert.equal(partial.data.status,"partial");assert.ok(partial.data.database_bytes>0);assert.equal(partial.data.financial_integrity_failures,undefined);
  assert.ok(partial.data.diagnostic_errors.some(error=>error.section==="financial"&&error.code==="42P01"));
  await db.exec("alter view qa_missing_campaign_balances rename to campaign_balances");
  pass("missing dependencies show their cause while available status metrics remain visible");

  phase="unapproved device cannot call privileged RPCs";
  await db.query("select set_config('request.headers','{}',false)");
  for(const [name,args]of [["get_system_health",{}],["backup_v3_start_export",{p_scope:"business",p_include_security:false}],["assistant_apply_workflow",{p_operation:"post_cash_receipt",p_id:pendingReceipt.id,p_expected_status:"draft"}],["assistant_save_document",{p_entity:"in_kind_payment",p_record:{},p_details:[]}],["save_system_settings",{p_settings:{organization_name:"ممنوع"}}],["set_authorized_device_status",{p_id:crypto.randomUUID(),p_status:"approved"}],["post_cash_payment",{p_id:payment.id}],["post_in_kind_payment",{p_id:inkindPayment.id}]]) {
    const result=await caller.rpc(name,args);assert.ok(result.error,name+" must deny an unapproved caller");
  }
  await db.query("select set_config('request.headers',$1,false)",[approvedHeaders]);
  await db.query("update profiles set is_active=false where id=$1",[userId]);
  assert.ok((await caller.rpc("get_system_health")).error);
  await db.query("update profiles set is_active=true where id=$1",[userId]);
  pass("unapproved devices and inactive users cannot exploit null roles");

  phase="existing data installation guard";
  await assert.rejects(db.exec(installer),/قاعدة جديدة فارغة/);
  await db.exec("rollback");
  assert.equal(Number(await scalar("select count(*) from cash_receipts")),2);
  assert.equal(Number(await scalar("select count(*) from health_conditions")),11);
  pass("full installer refuses an existing database without changing its data");
  await db.close();
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(platform);
  await db.exec("create extension pgcrypto with schema public");
  await db.exec(installer);
  assert.equal(await scalar("select public.sha256_text('abc')"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  pass("pgcrypto works in either public or extensions schema");
  console.log("Completed",passes,"integration groups on local PostgreSQL. Supabase Auth, Storage HTTP and Gemini network were not invoked.");
} catch(error) {
  console.error(JSON.stringify({phase,code:error.code,message:error.message,detail:error.detail,where:error.where,stack:error.stack},null,2));
  process.exitCode=1;
} finally {await db.close();}
