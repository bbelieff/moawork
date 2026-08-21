export interface DateScheduleQueryPort {
  query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export class PostgresDateScheduleStore {
  constructor(private readonly db: DateScheduleQueryPort) {}

  async dispatchDue(limit: number): Promise<{ dispatched: number; duplicates: number }> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.db.query<{ schedule_id: string; inserted: boolean }>(
      "select * from public.dispatch_due_board_column_date_schedules($1)", [safeLimit],
    );
    return {
      dispatched: result.rows.filter((row) => row.inserted).length,
      duplicates: result.rows.filter((row) => !row.inserted).length,
    };
  }
}
