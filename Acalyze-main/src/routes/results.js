import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeExamResults } from '../lib/results.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth, requireRole('admin', 'teacher'));

// Ranked results for one class in one exam. Rows come from the shared
// computeExamResults(), so this always matches the report cards.
resultsRouter.get('/', asyncHandler(async (req, res) => {
  const { examId, classId } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });
  const data = await computeExamResults({ organizationId: req.auth.organizationId, examId, classId });
  if (!data) return res.status(404).json({ error: 'Class not found at your school' });
  const rows = data.rows
    .filter((r) => r.classId === classId)
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.student.full_name.localeCompare(b.student.full_name));
  res.json({ scheme: data.scheme, subjects: data.subjects, rankedCount: data.rankedCount, rows });
}));
