export type ReminderKind = "recontact" | "reapply" | "review_end";

export interface DateReminderSource {
  kind: ReminderKind;
  sourceId: string;
  companyId: string;
  assigneeId: string;
  supervisorId?: string | null;
  dueDate: string;
  daysBefore: number;
}

export interface ReminderJob {
  key: string;
  kind: ReminderKind;
  sourceId: string;
  companyId: string;
  dueDate: string;
  notifyOn: string;
  recipientIds: string[];
}
