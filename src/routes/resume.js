import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';
import { extractResumeText } from '../services/resumeParser.js';
import { analyseResume } from '../services/gemini.js';
import { getLiveJobs } from '../services/liveJobs.js';

const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(here, '../../uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const allowed = new Set(['.pdf','.doc','.docx','.txt']);
const storage = multer.diskStorage({ destination: uploadDir, filename: (_req,file,cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits:{fileSize:Number(process.env.MAX_UPLOAD_MB || 10)*1024*1024}, fileFilter:(_req,file,cb) => allowed.has(path.extname(file.originalname).toLowerCase()) ? cb(null,true) : cb(new Error('Only PDF, DOCX and TXT files are supported.')) });

router.post('/upload', requireAuth, upload.single('resume'), async (req,res) => {
  if (!req.file) return res.status(400).json({error:'Choose a resume file first.'});
  try {
    const text = await extractResumeText(req.file);
    if (text.length < 40) throw new Error('The extracted resume text is too short. Please upload a readable resume.');
    const insert = db.prepare('INSERT INTO resumes (user_id,original_name,stored_name,extracted_text) VALUES (?,?,?,?)');
    const result = insert.run(req.user.id,req.file.originalname,req.file.filename,text);
    res.status(201).json({message:'Resume uploaded and text extracted.',resume:{id:result.lastInsertRowid,fileName:req.file.originalname,characterCount:text.length}});
  } catch(err) {
    fs.unlink(req.file.path,()=>{});
    console.error(err); res.status(400).json({error:err.message || 'Could not process this resume.'});
  }
});

router.post('/:id/analyse', requireAuth, async (req,res) => {
  const resume = db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!resume) return res.status(404).json({error:'Resume not found.'});
  try {
    const analysis = await analyseResume(resume.extracted_text);
    db.prepare('UPDATE resumes SET analysis_json=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),resume.id,req.user.id);
    const liveJobs = await getLiveJobs(analysis.skills || [], analysis.recommendedRoles?.[0] || '');
    const matches = liveJobs.jobs;
    const save = db.prepare(`INSERT INTO matches (user_id,resume_id,job_id,score,matched_skills_json,missing_skills_json)
      VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,resume_id,job_id) DO UPDATE SET score=excluded.score, matched_skills_json=excluded.matched_skills_json, missing_skills_json=excluded.missing_skills_json, created_at=datetime('now')`);
    const tx = db.transaction(() => matches.forEach(m => save.run(req.user.id,resume.id,m.id,m.score,JSON.stringify(m.matchedSkills),JSON.stringify(m.missingSkills))));
    tx();
    res.json({message:'Resume analysis complete.',analysis,matches,nextPageToken:liveJobs.nextPageToken || '',jobsError:liveJobs.error || null});
  } catch(err) { console.error(err); res.status(502).json({error:err.message || 'AI analysis failed. Check your Gemini API configuration.'}); }
});

router.get('/latest', requireAuth, (req,res) => {
  const resume = db.prepare('SELECT id,original_name,uploaded_at,analysis_json FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json({resume: resume ? {...resume,analysis:resume.analysis_json ? JSON.parse(resume.analysis_json):null} : null});
});

export default router;
