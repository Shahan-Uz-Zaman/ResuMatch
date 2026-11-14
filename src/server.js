import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import resumeRoutes from './routes/resume.js';
import jobRoutes from './routes/jobs.js';
import { db } from './db.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random value at least 32 characters long.'); process.exit(1);
}
const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here,'../public');
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","https://fonts.googleapis.com"],fontSrc:["'self'","https://fonts.gstatic.com"],imgSrc:["'self'","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'100kb'}));
app.use(cookieParser());
app.use(express.static(publicDir));
app.get('/api/health',(_req,res)=>res.json({ok:true,database:'connected'}));
app.use('/api/auth',authRoutes);
app.use('/api/resume',resumeRoutes);
app.use('/api/jobs',jobRoutes);
app.use((err,_req,res,_next)=>{
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({error:`File is too large. Maximum size is ${process.env.MAX_UPLOAD_MB || 10} MB.`});
  if (err) return res.status(400).json({error:err.message || 'Request failed.'});
  res.status(500).json({error:'Unexpected server error.'});
});
app.get('*path',(_req,res)=>res.sendFile(path.join(publicDir,'index.html')));
const port = Number(process.env.PORT || 3000);
const server = app.listen(port,()=>console.log(`ResuMatch running at http://localhost:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close(()=>{db.close();process.exit(0);});});
