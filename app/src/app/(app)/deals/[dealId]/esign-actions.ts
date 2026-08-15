"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EsignActionState = { ok: boolean; message: string };
const text=(fd:FormData,key:string)=>typeof fd.get(key)==="string"?String(fd.get(key)).trim():"";
export async function requestEsignAction(_: EsignActionState, fd: FormData): Promise<EsignActionState> {
  const dealId=text(fd,"dealId"),templateId=text(fd,"templateId"),signerReference=text(fd,"signerReference");
  if (!dealId || !templateId || !signerReference) return { ok:false,message:"요청 정보를 모두 입력해 주세요." };
  const client=await createClient();
  const { data,error }=await client.rpc("enqueue_esign_request",{p_deal_id:dealId,p_template_id:templateId,p_signer_reference:signerReference,p_request_id:randomUUID()});
  if(error) return {ok:false,message:"전자계약 요청을 저장하지 못했어요. 권한과 연결 상태를 확인해 주세요."};
  revalidatePath(`/deals/${dealId}`);
  const row=Array.isArray(data)?data[0]:data;
  return {ok:true,message:row?.inserted?"서명 요청이 안전하게 대기열에 등록됐어요.":"같은 계약 요청이 이미 등록되어 있어요."};
}
