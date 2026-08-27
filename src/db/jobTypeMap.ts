// 「職種法人マスタ」相当(gas-app-liff/Repo.gs の getJobTypeCompanyMap_ / getJobTypeOptions_)

export async function getJobTypeCompanyMap(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT JobType, Company FROM job_type_company_map').all<{ JobType: string; Company: string }>();
  const map: Record<string, string> = {};
  for (const r of results ?? []) {
    const jobType = String(r.JobType || '').trim();
    if (jobType) map[jobType] = String(r.Company || '').trim();
  }
  return map;
}

export async function getJobTypeOptions(db: D1Database): Promise<string[]> {
  return Object.keys(await getJobTypeCompanyMap(db));
}

export async function setJobTypeCompany(db: D1Database, jobType: string, company: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO job_type_company_map (JobType, Company) VALUES (?, ?)
       ON CONFLICT(JobType) DO UPDATE SET Company = excluded.Company`
    )
    .bind(jobType, company)
    .run();
}

export async function removeJobType(db: D1Database, jobType: string): Promise<void> {
  await db.prepare('DELETE FROM job_type_company_map WHERE JobType = ?').bind(jobType).run();
}
