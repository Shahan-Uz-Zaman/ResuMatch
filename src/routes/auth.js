import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 2 * 60 * 60 * 1000 };
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (_req,file,cb) => ['image/jpeg','image/png','image/webp'].includes(file.mimetype) ? cb(null,true) : cb(new Error('Choose a JPG, PNG, or WebP profile photo.')) });
const profileQuery = db.prepare('SELECT id,name,email,institute,address,phone,headline,website,linkedin_url,bio,avatar_data FROM users WHERE id=?');
const publicProfile = user => ({ id:user.id,name:user.name,email:user.email,institute:user.institute,address:user.address,phone:user.phone,headline:user.headline,website:user.website,linkedin_url:user.linkedin_url,bio:user.bio,avatarData:user.avatar_data });

router.post('/register', authLimiter, async (req,res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must be 10–128 characters.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name,email,passwordHash);
    res.status(201).json({ message: 'Account created. You can now sign in.', userId: result.lastInsertRowid });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT_UNIQUE')) return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error(err); res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', authLimiter, async (req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '2h', issuer: 'resumatch' });
  res.cookie('resumatch_token', token, cookieOptions);
  res.json({ message: 'Signed in successfully.', user: { id:user.id, name:user.name, email:user.email } });
});

router.post('/logout', (req,res) => { res.clearCookie('resumatch_token', { ...cookieOptions, maxAge: undefined }); res.json({ message:'Signed out.' }); });
router.get('/me', requireAuth, (req,res) => res.json({ user:req.user }));
router.get('/profile', requireAuth, (req,res) => res.json({ profile:publicProfile(profileQuery.get(req.user.id)) }));
router.put('/profile', requireAuth, (req,res) => {
  const name=String(req.body.name||'').trim();
  const email=String(req.body.email||'').trim().toLowerCase();
  if(name.length<2||name.length>80)return res.status(400).json({error:'Name must be between 2 and 80 characters.'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
  const fields={
    institute:String(req.body.institute||'').trim(),address:String(req.body.address||'').trim(),phone:String(req.body.phone||'').trim(),
    headline:String(req.body.headline||'').trim(),website:String(req.body.website||'').trim(),linkedin_url:String(req.body.linkedin_url||'').trim(),bio:String(req.body.bio||'').trim()
  };
  const limits={institute:120,address:240,phone:32,headline:120,website:240,linkedin_url:240,bio:600};
  for(const [field,value] of Object.entries(fields))if(value.length>limits[field])return res.status(400).json({error:`${field.replace('_',' ')} must be ${limits[field]} characters or fewer.`});
  for(const field of ['website','linkedin_url'])if(fields[field]){try{const url=new URL(fields[field]);if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{return res.status(400).json({error:`Enter a valid ${field==='website'?'website':'LinkedIn'} URL, including https://.`});}}
  try{
    db.prepare(`UPDATE users SET name=?,email=?,institute=?,address=?,phone=?,headline=?,website=?,linkedin_url=?,bio=? WHERE id=?`).run(name,email,fields.institute,fields.address,fields.phone,fields.headline,fields.website,fields.linkedin_url,fields.bio,req.user.id);
    res.json({message:'Profile updated.',profile:publicProfile(profileQuery.get(req.user.id))});
  }catch(err){if(String(err.code).includes('SQLITE_CONSTRAINT_UNIQUE'))return res.status(409).json({error:'An account with this email already exists.'});console.error(err);res.status(500).json({error:'Could not update profile.'});}
});
router.post('/profile/photo', requireAuth, (req,res,next)=>photoUpload.single('photo')(req,res,err=>{
  if(!err)return next();
  if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Profile photo must be 2 MB or smaller.'});
  return res.status(400).json({error:err.message||'Could not upload profile photo.'});
}), (req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose an image first.'});
  const data=req.file.buffer,mime=req.file.mimetype;
  const isPng=mime==='image/png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg=mime==='image/jpeg'&&data[0]===255&&data[1]===216&&data[2]===255;
  const isWebp=mime==='image/webp'&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  if(!isPng&&!isJpeg&&!isWebp)return res.status(400).json({error:'The selected file is not a valid JPG, PNG, or WebP image.'});
  const avatarData=`data:${mime};base64,${data.toString('base64')}`;
  db.prepare('UPDATE users SET avatar_data=? WHERE id=?').run(avatarData,req.user.id);
  res.json({message:'Profile photo updated.',profile:publicProfile(profileQuery.get(req.user.id))});
});
router.delete('/profile/photo', requireAuth, (req,res)=>{
  db.prepare('UPDATE users SET avatar_data=NULL WHERE id=?').run(req.user.id);
  res.json({message:'Profile photo removed.',profile:publicProfile(profileQuery.get(req.user.id))});
});
router.post('/change-password', requireAuth, authLimiter, async (req,res)=>{
  const currentPassword=String(req.body.currentPassword||'');
  const newPassword=String(req.body.newPassword||'');
  const user=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if(!currentPassword||!(await bcrypt.compare(currentPassword,user.password_hash)))return res.status(400).json({error:'Current password is incorrect.'});
  if(newPassword.length<10||newPassword.length>128)return res.status(400).json({error:'New password must be between 10 and 128 characters.'});
  const passwordHash=await bcrypt.hash(newPassword,12);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,req.user.id);
  res.json({message:'Password changed successfully.'});
});
export default router;
