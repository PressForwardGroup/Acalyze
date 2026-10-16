import { Router } from 'express';
import { query } from '../lib/db.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const registrationRouter = Router();

// Public — anyone can submit this from the Acalyze landing page. No auth,
// and nothing here grants access to anything: it only ever creates a
// 'pending' row for a platform_admin to review (see routes/organizations.js).
registrationRouter.post('/', asyncHandler(async (req, res) => {
  const { schoolName, location, contactName, contactEmail, contactPhone, systemUsed, approxStudents } = req.body;
  if (!schoolName || !contactEmail) {
    return res.status(400).json({ error: 'School name and contact email are required.' });
  }
  const { rows } = await query(
    `INSERT INTO school_registrations (school_name, location, contact_name, contact_email, contact_phone, system_used, approx_students)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, submitted_at`,
    [schoolName.trim(), location || null, contactName || null, contactEmail.trim().toLowerCase(),
     contactPhone || null, systemUsed || null, approxStudents ? parseInt(approxStudents, 10) || null : null]
  );
  res.status(201).json({ ok: true, id: rows[0].id, message: "Thanks — we'll review this and get back to you within one working day." });
}));
