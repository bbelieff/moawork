import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignOptOutPort, CampaignOutboxPort } from "./types";

export class SupabaseCampaignOptOut implements CampaignOptOutPort {
  constructor(private readonly client: SupabaseClient) {}
  async blockedPhones(orgId: string, phones: readonly string[]): Promise<ReadonlySet<string>> {
    if (phones.length === 0) return new Set();
    const { data, error } = await this.client.from("messaging_opt_outs")
      .select("phone_digits").eq("org_id", orgId).in("phone_digits", [...new Set(phones)]);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.phone_digits));
  }
}

export class SupabaseCampaignOutbox implements CampaignOutboxPort {
  constructor(private readonly client: SupabaseClient) {}
  async enqueue(input: Parameters<CampaignOutboxPort["enqueue"]>[0]): Promise<{ queued: number; duplicate: number }> {
    const template = await this.client.from("message_templates").select("id,channel,body,status")
      .eq("org_id", input.orgId).eq("id", input.templateId).eq("channel", input.channel).single();
    if (template.error) throw new Error(template.error.message);
    if (input.channel === "alimtalk" && !["approved", "승인"].includes(template.data.status)) {
      throw new Error("승인된 알림톡 템플릿이 아니에요.");
    }
    let queued = 0;
    let duplicate = 0;
    for (const target of input.targets) {
      const businessValue = `${input.campaignKey}:${input.filterSnapshotHash}`;
      const messageKey = [input.orgId, target.itemId, "retargeting", businessValue, input.templateId, input.channel].join(":");
      const row = {
        org_id: input.orgId, template_id: input.templateId, to_addr: target.phoneDigits,
        status: "queued", source_entity_id: target.itemId, channel: input.channel,
        from_addr: input.senderDigits, sender_profile_id: input.senderProfileId ?? null,
        body_snapshot: template.data.body,
        idempotency_key: messageKey, trigger_column_key: "retargeting", trigger_value: businessValue,
      };
      const inserted = await this.client.from("messages").upsert(row, {
        onConflict: "org_id,idempotency_key", ignoreDuplicates: true,
      }).select("id").maybeSingle();
      if (inserted.error) throw new Error(inserted.error.message);
      let messageId = inserted.data?.id as string | undefined;
      if (!messageId) {
        const existing = await this.client.from("messages").select("id")
          .eq("org_id", input.orgId).eq("idempotency_key", messageKey).single();
        if (existing.error) throw new Error(existing.error.message);
        messageId = existing.data.id;
      }
      const reservation = await this.client.rpc("enqueue_message_outbox", {
        p_org_id: input.orgId, p_message_id: messageId, p_source_entity_id: target.itemId,
        p_trigger_column_key: "retargeting", p_trigger_value_id: businessValue,
        p_template_id: input.templateId, p_channel: input.channel,
        p_actor_kind: "person", p_actor_id: input.actorId,
      });
      if (reservation.error) throw new Error(reservation.error.message);
      const wasInserted = Array.isArray(reservation.data) ? reservation.data[0]?.inserted : reservation.data?.inserted;
      if (wasInserted) queued += 1; else duplicate += 1;
    }
    return { queued, duplicate };
  }
}
