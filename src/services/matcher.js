const normalise = value => String(value).toLowerCase().replace(/[^a-z0-9+#.]/g, '').trim();

export function matchJobs(skills = [], jobs = []) {
  const candidate = new Set(skills.map(normalise).filter(Boolean));
  return jobs.map(job => {
    const required = JSON.parse(job.skills_json);
    const matched = required.filter(skill => candidate.has(normalise(skill)));
    const missing = required.filter(skill => !candidate.has(normalise(skill)));
    const score = required.length ? Math.round((matched.length / required.length) * 100) : 0;
    return { ...job, skills: required, matchedSkills: matched, missingSkills: missing, score };
  }).sort((a,b) => b.score - a.score);
}
