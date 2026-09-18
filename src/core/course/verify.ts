// ==========================================================================
// Ergalics Studio — FR-13 course mode: submission verification (pure TS)
//
// Result checking is lock-vs-lock, never code execution (FR-13 rule: "结果
// 核验基于 repro.lock 而非代码执行"). The assignment carries the expected
// repro.lock captured from the solved reference; the student submits the
// lock of their own project. Because student projects are fresh clones with
// their own ids, the comparison is identity-free: every expected DATA file
// must be present with the same fingerprint, and every expected RUN must be
// reproduced by some student run with matching params/seed and metrics
// inside the locked tolerance (extra student files/runs are ignored).
// ==========================================================================

import { parseLock, relativeMetricError, type LockedRun, type ReproLock } from '@/core/repro/lock';
import type { Assignment, Submission } from './model';

export type SubmissionState = 'pass' | 'drift' | 'not_submitted';

export interface SubmissionVerification {
  state: SubmissionState;
  /** Stable reason codes (UI localises via `course.verify.<code>` keys). */
  reasons: string[];
}

function dataSignature(lock: ReproLock): Map<string, string> {
  return new Map(lock.data.map((f) => [f.id, f.hash]));
}

function runMatches(expected: LockedRun, actual: LockedRun): boolean {
  if (expected.paramsHash !== actual.paramsHash) return false;
  if ((expected.seed ?? null) !== (actual.seed ?? null)) return false;
  const tolerance = Math.max(expected.tolerance, actual.tolerance ?? 0);
  for (const [name, value] of Object.entries(expected.metrics)) {
    const got = actual.metrics[name];
    if (typeof got !== 'number' || !Number.isFinite(got)) return false;
    const { abs, rel } = relativeMetricError(value, got);
    if (!(rel <= tolerance || abs <= tolerance)) return false;
  }
  return true;
}

/**
 * Verify one submission against the assignment's expected lock.
 * - `not_submitted` — no submission record.
 * - `pass` — expected data + every expected run reproduced within tolerance.
 * - `drift` — anything else (missing/changed data, unreproduced runs, an
 *   unparseable lock, or an assignment with no expectation to verify against).
 */
export function verifySubmission(
  assignment: Assignment,
  submission: Submission | undefined,
): SubmissionVerification {
  if (!submission) return { state: 'not_submitted', reasons: ['not-submitted'] };
  if (!assignment.expectedLockJson) {
    return { state: 'drift', reasons: ['no-expectation'] };
  }
  let expected: ReproLock;
  let actual: ReproLock;
  try {
    expected = parseLock(assignment.expectedLockJson);
  } catch {
    return { state: 'drift', reasons: ['bad-expected-lock'] };
  }
  try {
    actual = parseLock(submission.lockJson);
  } catch {
    return { state: 'drift', reasons: ['bad-submission-lock'] };
  }

  const reasons: string[] = [];
  const actualData = dataSignature(actual);
  for (const file of expected.data) {
    const hash = actualData.get(file.id);
    if (hash === undefined) {
      reasons.push(`missing-data:${file.name}`);
    } else if (hash !== file.hash) {
      reasons.push(`changed-data:${file.name}`);
    }
  }
  for (const run of expected.runs) {
    if (!actual.runs.some((r) => runMatches(run, r))) {
      reasons.push(`run-not-reproduced:${run.label ?? run.id}`);
    }
  }
  return reasons.length === 0 ? { state: 'pass', reasons: [] } : { state: 'drift', reasons };
}

// ---- completion matrix -------------------------------------------------------

export interface MatrixCell {
  assignmentId: string;
  student: string;
  state: SubmissionState;
  submittedAt?: number;
  graded: boolean;
}

export interface CourseMatrix {
  students: string[];
  assignments: Assignment[];
  cells: MatrixCell[];
}

/**
 * Student × assignment completion matrix for the teacher view: one cell per
 * (student, visible-or-submitted assignment) pair, verified against the
 * assignment's expected lock.
 */
export function buildCourseMatrix(
  courses: { assignments: Assignment[] }[],
  submissions: Submission[],
): CourseMatrix {
  const assignments = courses.flatMap((c) => c.assignments);
  const students = [...new Set(submissions.map((s) => s.student))].sort((a, b) =>
    a.localeCompare(b),
  );
  const cells: MatrixCell[] = [];
  for (const student of students) {
    for (const assignment of assignments) {
      const submission = submissions.find(
        (s) => s.student === student && s.assignmentId === assignment.id,
      );
      cells.push({
        assignmentId: assignment.id,
        student,
        state: verifySubmission(assignment, submission).state,
        ...(submission ? { submittedAt: submission.submittedAt } : {}),
        graded: submission?.review !== undefined,
      });
    }
  }
  return { students, assignments, cells };
}
