import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'resumatch.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  analysis_json TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  apply_url TEXT,
  is_demo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  matched_skills_json TEXT NOT NULL,
  missing_skills_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, resume_id, job_id)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Interested',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, job_id)
);
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
for (const [name, definition] of [
  ['institute', 'TEXT NOT NULL DEFAULT \'\''],
  ['address', 'TEXT NOT NULL DEFAULT \'\''],
  ['phone', 'TEXT NOT NULL DEFAULT \'\''],
  ['headline', 'TEXT NOT NULL DEFAULT \'\''],
  ['website', 'TEXT NOT NULL DEFAULT \'\''],
  ['linkedin_url', 'TEXT NOT NULL DEFAULT \'\''],
  ['bio', 'TEXT NOT NULL DEFAULT \'\''],
  ['avatar_data', 'TEXT']
]) {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name));
if (!jobColumns.has('source')) db.exec("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'demo'");
if (!jobColumns.has('source_id')) db.exec('ALTER TABLE jobs ADD COLUMN source_id TEXT');
if (!jobColumns.has('posted_at')) db.exec('ALTER TABLE jobs ADD COLUMN posted_at TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_external_id ON jobs(source, source_id) WHERE source_id IS NOT NULL');

const count = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
if (count === 0) {
  const insert = db.prepare(`INSERT INTO jobs (title, company, location, description, skills_json, apply_url, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  const jobs = [
    ['Frontend Developer', 'Northstar Digital', 'Remote / India', 'Build accessible responsive interfaces with a product team.', ['HTML','CSS','JavaScript','React','Git'], 'https://example.com/jobs/frontend'],
    ['Junior Python Developer', 'ByteBridge Labs', 'Guwahati / Hybrid', 'Help build Python services, APIs and internal tools.', ['Python','SQL','REST APIs','Git','Django'], 'https://example.com/jobs/python'],
    ['Data Analyst', 'InsightWorks', 'Remote / India', 'Clean datasets, create reports and communicate business insights.', ['Python','SQL','Excel','Power BI','Statistics'], 'https://example.com/jobs/analyst'],
    ['Full Stack Developer Intern', 'LaunchPad Systems', 'Remote / India', 'Work across frontend and backend features with mentorship.', ['HTML','CSS','JavaScript','Node.js','SQL'], 'https://example.com/jobs/fullstack'],
    ['UI/UX Designer', 'PixelCraft Studio', 'Guwahati / On-site', 'Create user flows, wireframes and polished product interfaces.', ['Figma','Wireframing','Prototyping','User Research','Accessibility'], 'https://example.com/jobs/design']
  ];
  const seed = db.transaction(() => jobs.forEach(j => insert.run(j[0],j[1],j[2],j[3],JSON.stringify(j[4]),j[5])));
  seed();
}
