import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';
import { getLiveJobs } from '../services/liveJobs.js';
const router = Router();
router.get('/', requireAuth, async (req,res) => {
  const skills = String(req.query.skills || '').split(',').map(skill => skill.trim()).filter(Boolean).slice(0, 30);
  const role = String(req.query.role || '').trim().slice(0, 120);
  const query = String(req.query.q || '').trim().slice(0,120);
  const nextPageToken = String(req.query.nextPageToken || '').trim().slice(0,5000);
  const result = await getLiveJobs(skills, role, { query, nextPageToken });
  res.json(result);
});
router.post('/:id/save', requireAuth, (req,res) => {
  const job = db.prepare('SELECT id FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({error:'Job not found.'});
  db.prepare(`INSERT INTO applications (user_id,job_id,status) VALUES (?,?, 'Interested') ON CONFLICT(user_id,job_id) DO NOTHING`).run(req.user.id,job.id);
  res.status(201).json({message:'Job saved to your applications.'});
});
router.get('/applications', requireAuth, (req,res) => {
  const applications = db.prepare(`SELECT a.id,a.status,a.created_at,j.id AS job_id,j.title,j.company,j.location,j.apply_url FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? ORDER BY a.id DESC`).all(req.user.id);
  res.json({applications});
});
router.patch('/applications/:id', requireAuth, (req,res) => {
  const allowed = ['Interested','Applied','Interview','Rejected','Offer'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({error:'Invalid application status.'});
  const result = db.prepare('UPDATE applications SET status=? WHERE id=? AND user_id=?').run(req.body.status,req.params.id,req.user.id);
  if (!result.changes) return res.status(404).json({error:'Application not found.'});
  res.json({message:'Application status updated.'});
});
router.delete('/applications/:id', requireAuth, (req,res) => {
  const result = db.prepare('DELETE FROM applications WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
  if (!result.changes) return res.status(404).json({error:'Saved application not found.'});
  res.json({message:'Saved application removed.'});
});
export default router;
