// appendHistory_ の移植。

import { nowStr } from '../util/date';

export async function appendHistory(
  db: D1Database,
  employeeId: string,
  docKey: string,
  action: string,
  detail: string,
  actorEmail: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO submission_history (Timestamp, EmployeeId, DocKey, Action, Detail, ActorEmail)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(nowStr(), employeeId, docKey || '', action, detail || '', actorEmail || '')
    .run();
}
