import { db } from '../db.js';

const cache = new Map();
const cacheTtlMs = 60 * 60 * 1000;
const location = process.env.GOOGLE_JOBS_LOCATION || 'India';
const googleDomain = process.env.GOOGLE_JOBS_DOMAIN || 'google.co.in';
const country = (process.env.GOOGLE_JOBS_COUNTRY || 'in').toLowerCase();
const language = (process.env.GOOGLE_JOBS_LANGUAGE || 'en').toLowerCase();

const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9+#.]/g, '');

function salaryRangeInLpa(value='') {
  const salary=String(value||'');
  const numbers=[...salary.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(match=>Number(match[0].replace(/,/g,''))).filter(Number.isFinite);
  if(!numbers.length)return {min:null,max:null};
  let multiplier=1;
  if(/lpa|lakhs?|lac/i.test(salary))multiplier=1;
  else if(/₹|\bINR\b|\bRs\.?\b/i.test(salary)){
    if(/month|monthly|\/mo\b/i.test(salary))multiplier=12/100000;
    else if(/year|annual|annually|\/yr\b/i.test(salary))multiplier=1/100000;
    else return {min:null,max:null};
  }else return {min:null,max:null};
  if(multiplier===1&&/lpa|lakhs?|lac/i.test(salary))return {min:Math.min(...numbers),max:Math.max(...numbers)};
  const annual=numbers.map(number=>number*multiplier);
  return {min:Math.min(...annual),max:Math.max(...annual)};
}

function jobWorkMode(job) {
  const details=job.detected_extensions||{};
  const searchable=`${job.location||''} ${job.title||''} ${job.description||''} ${details.work_from_home||''}`.toLowerCase();
  if(details.work_from_home||/\bremote\b|work from home|wfh/.test(searchable))return 'remote';
  if(/\bhybrid\b/.test(searchable))return 'hybrid';
  if(/\bon[- ]?site\b|\bonsite\b|\bin.office\b/.test(searchable))return 'onsite';
  return 'unspecified';
}

function upsertGoogleJob(job) {
  const sourceId = String(job.id);
  const title = String(job.title || 'Job opportunity').slice(0, 250);
  const company = String(job.company_name || 'Company not listed').slice(0, 200);
  const place = String(job.location || location).slice(0, 200);
  const description = String(job.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const applyUrl = String(job.apply_options?.find(option => option.link)?.link || job.share_link || '');
  const postedAt = String(job.detected_extensions?.posted_at || '');
  db.prepare(`INSERT INTO jobs (title,company,location,description,skills_json,apply_url,is_demo,source,source_id,posted_at)
    VALUES (?,?,?,?,?,?,0,'google-jobs',?,?)
    ON CONFLICT(source,source_id) WHERE source_id IS NOT NULL DO UPDATE SET
      title=excluded.title, company=excluded.company, location=excluded.location,
      description=excluded.description, apply_url=excluded.apply_url, posted_at=excluded.posted_at, is_demo=0`)
    .run(title, company, place, description, '[]', applyUrl, sourceId, postedAt);
  return db.prepare('SELECT id,title,company,location,description,apply_url,posted_at FROM jobs WHERE source=? AND source_id=?')
    .get('google-jobs', sourceId);
}

export async function getLiveJobs(profileSkills = [], preferredRole = '', options = {}) {
  if (!process.env.SERPAPI_API_KEY) {
    return { jobs: [], error: 'Google Jobs search needs a SerpApi key. Add SERPAPI_API_KEY to your .env file.' };
  }

  const requestedQuery = String(options.query || '').trim().slice(0,120);
  const skills = [...new Set([...profileSkills.map(skill => String(skill).trim()).filter(Boolean), ...(requestedQuery ? [requestedQuery] : [])])];
  const nextPageToken = String(options.nextPageToken || '').trim().slice(0,5000);
  const queries = requestedQuery ? [requestedQuery] : [...new Set([
    String(preferredRole || '').trim(),
    skills[0] ? `${skills[0]} jobs` : '',
    'software developer jobs'
  ].filter(Boolean))];
  const cacheKey = `${country}:${location}:${queries[0].toLowerCase()}:${nextPageToken}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { jobs: cached.jobs, nextPageToken: cached.nextPageToken };

  const url = new URL('https://serpapi.com/search.json');
  try {
    let payload;
    for (const query of queries) {
      url.search = new URLSearchParams({
        engine: 'google_jobs',
        api_key: process.env.SERPAPI_API_KEY,
        q: query,
        location,
        google_domain: googleDomain,
        gl: country,
        hl: language
      }).toString();
      if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('SerpApi rejected the API key. Check SERPAPI_API_KEY in .env.');
        if (response.status === 429) throw new Error('SerpApi search limit reached. Check your SerpApi account quota.');
        throw new Error(`Google Jobs search returned HTTP ${response.status}.`);
      }
      payload = await response.json();
      if (payload.error && !/hasn't returned any results|no results/i.test(payload.error)) throw new Error(payload.error);
      if ((payload.jobs_results || []).length) break;
    }
    const jobs = (payload?.jobs_results || []).filter(job => job.job_id && (job.apply_options?.length || job.share_link)).map(job => {
      const saved = upsertGoogleJob({ ...job, id: job.job_id });
      const searchable = `${saved.title} ${saved.description}`.toLowerCase();
      const matchedSkills = skills.filter(skill => searchable.includes(skill.toLowerCase()));
      const matched = new Set(matchedSkills.map(normalize));
      const salary=String(job.detected_extensions?.salary||job.salary||'');
      const salaryRange=salaryRangeInLpa(salary);
      return {
        id: saved.id,
        title: saved.title,
        company: saved.company,
        location: saved.location,
        description: saved.description,
        applyUrl: saved.apply_url,
        postedAt: saved.posted_at,
        salary,
        salaryMinLpa:salaryRange.min,
        salaryMaxLpa:salaryRange.max,
        jobType:String(job.detected_extensions?.schedule_type||''),
        workMode:jobWorkMode(job),
        source: 'Google Jobs',
        sourceUrl: job.share_link || payload?.search_metadata?.google_jobs_url || 'https://www.google.com/search?ibp=htl;jobs',
        isDemo: false,
        score: skills.length ? Math.round((matchedSkills.length / skills.length) * 100) : 0,
        matchedSkills,
        missingSkills: skills.filter(skill => !matched.has(normalize(skill)))
      };
    });
    const sortedJobs = jobs.sort((a, b) => b.score - a.score);
    if (!sortedJobs.length) return { jobs: [], nextPageToken:'', error: `Google Jobs returned no listings for ${location}. Try a broader role or location.` };
    const token = payload?.serpapi_pagination?.next_page_token || '';
    cache.set(cacheKey, { jobs: sortedJobs, nextPageToken:token, expiresAt: Date.now() + cacheTtlMs });
    return { jobs: sortedJobs, nextPageToken:token };
  } catch (error) {
    console.error('Google Jobs search failed:', error.message);
    return { jobs: [], error: error.message || 'Google Jobs search failed. Please try again shortly.' };
  }
}
