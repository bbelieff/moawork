import { Pool } from "pg";
import type PgBoss from "pg-boss";
import { ModusignProvider } from "./modusign.js";
import { ESIGN_SEND_QUEUE, type EsignSendDeps } from "./send.js";
import { registerEsignWorker } from "./register.js";
import type { EsignRequestLoader, EsignRequestStatusSink, PendingEsignRequest, SigningLinkDelivery } from "./types.js";

type Db={query<T extends Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[]}>};
export class PostgresEsignRuntime implements EsignRequestLoader,EsignRequestStatusSink,SigningLinkDelivery{
 constructor(private readonly db:Db,private readonly messageTemplateId:string,private readonly channel:"sms"|"alimtalk",private readonly sender:string){}
 async queued(limit=100){return (await this.db.query<{request_id:string}>("select * from public.list_queued_esign_requests($1)",[limit])).rows.map(r=>r.request_id);}
 async loadPending(id:string):Promise<PendingEsignRequest|null>{const r=(await this.db.query<{request_id:string;org_id:string;deal_id:string;template_id:string;signer_reference:string}>("select * from public.start_esign_delivery($1)",[id])).rows[0];return r?{requestId:r.request_id,orgId:r.org_id,dealId:r.deal_id,templateId:r.template_id,signerReference:r.signer_reference}:null;}
 async markAwaitingSignature(id:string,doc:string){await this.db.query("select public.mark_esign_awaiting($1,$2)",[id,doc]);}
 async markFailed(id:string,error:string){await this.db.query("select public.mark_esign_delivery_unknown($1,$2)",[id,error]);}
 async sendSigningLink(input:Parameters<SigningLinkDelivery["sendSigningLink"]>[0]){const row=(await this.db.query<{inserted:boolean}>("select * from public.enqueue_esign_signing_link($1,$2,$3,$4,$5)",[input.requestId,this.messageTemplateId,this.channel,this.sender,input.signingUrl])).rows[0];return row?{ok:true as const}:{ok:false as const,retryable:false,error:"outbox_handoff_failed"};}
}
export async function registerEsignFromEnv(boss:PgBoss,env:NodeJS.ProcessEnv=process.env):Promise<false|{stop():Promise<void>}>{
 const dbUrl=env.ESIGN_DATABASE_URL?.trim(),apiUrl=env.MOAWORK_MODUSIGN_API_URL?.trim(),apiKey=env.MOAWORK_MODUSIGN_API_KEY?.trim(),template=env.MOAWORK_ESIGN_MESSAGE_TEMPLATE_ID?.trim(),sender=env.MOAWORK_ESIGN_SENDER?.trim(),channel=env.MOAWORK_ESIGN_CHANNEL==="alimtalk"?"alimtalk":"sms";
 if(!dbUrl||!apiUrl||!apiKey||!template||!sender)return false;
 const pool=new Pool({connectionString:dbUrl,max:2});const runtime=new PostgresEsignRuntime(pool,template,channel,sender);const deps:EsignSendDeps={loader:runtime,provider:new ModusignProvider(apiUrl,apiKey),delivery:runtime,sink:runtime};
 await registerEsignWorker(boss,deps);
 const pump=async()=>{for(const requestId of await runtime.queued())await boss.send(ESIGN_SEND_QUEUE,{requestId},{singletonKey:`esign:${requestId}`});};
 await pump();const timer=setInterval(()=>void pump().catch(()=>undefined),5000);timer.unref();return{async stop(){clearInterval(timer);await pool.end();}};
}
