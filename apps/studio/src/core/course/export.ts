// ==========================================================================
// Ergalics Studio — FR-13 course mode: class export (pure TS)
//
// Builds the whole-class homework package: one folder per student, one
// subfolder per assignment, holding the submitted repro.lock plus a review
// card (grade + comment + verification state). The manifest is the complete
// inventory (course, assignments, students, files). `buildCoursePackage`
// only produces the entry LIST (path → text) so unit tests can assert the
// structure without a zip library; the browser side feeds those entries to
// an injected writer callback (fflate zipSync in the page — no new deps).
// ==========================================================================

import { lockToJson, parseLock } from '@/core/repro/lock';
import {
  enrolledStudents,
  findAssignment,
  findCourse,
  type CourseData,
  type Submission,
} from './model';
import { verifySubmission, type SubmissionVerification } from './verify';

/** One file in the export package: zip-relative path + text content. */
export interface PackageEntry {
  path: string;
  content: string;
}

export interface ManifestAssignment {
  id: string;
  title: string;
  templateId?: string;
  dueAt?: number;
  hasExpectation: boolean;
}

export interface ManifestSubmission {
  assignmentId: string;
  student: string;
  submittedAt: number;
  state: SubmissionVerification['state'];
  reasons: string[];
  grade: number | null;
  comment: string;
}

export interface CoursePackageManifest {
  generator: string;
  generatedAt: string;
  course: { id: string; name: string; owner: string };
  assignments: ManifestAssignment[];
  students: string[];
  submissions: ManifestSubmission[];
  /** Relative paths of every file in the package (excluding the manifest). */
  files: string[];
}

/** Folder-safe name segment (students are free-text local identities). */
export function slugify(name: string, fallback = 'unnamed'): string {
  const s = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.length > 0 ? s : fallback;
}

function reviewCard(submission: Submission, verification: SubmissionVerification): string {
  const review = submission.review;
  const lines = [
    `assignment: ${submission.assignmentId}`,
    `student: ${submission.student}`,
    `submitted_at: ${new Date(submission.submittedAt).toISOString()}`,
    `verification: ${verification.state}`,
  ];
  for (const reason of verification.reasons) lines.push(`  - ${reason}`);
  if (review) {
    lines.push(`grade: ${review.grade ?? '—'}`);
    lines.push(`comment: ${review.comment || '—'}`);
    lines.push(`reviewed_at: ${new Date(review.reviewedAt).toISOString()}`);
  } else {
    lines.push('grade: (not graded)');
  }
  return lines.join('\n') + '\n';
}

/** Pretty-print a stored lock (fall back to raw text when unparseable). */
function formatLock(lockJson: string): string {
  try {
    return lockToJson(parseLock(lockJson));
  } catch {
    return lockJson;
  }
}

/**
 * Build the export entry list for one course: `manifest.json` plus, per
 * student × submission, `<student>/<assignment>/repro.lock` and
 * `review.txt`. Paths are `/`-separated and zip-safe.
 */
export function buildCoursePackage(
  data: CourseData,
  courseId: string,
  now: Date = new Date(),
): PackageEntry[] {
  const course = findCourse(data, courseId);
  if (!course) throw new Error(`course ${courseId} not found`);

  const students = enrolledStudents(data, courseId);
  const submissions = data.submissions.filter((s) => s.courseId === courseId);
  const entries: PackageEntry[] = [];
  const files: string[] = [];

  for (const submission of submissions) {
    const assignment = findAssignment(course, submission.assignmentId);
    if (!assignment) continue;
    const verification = verifySubmission(assignment, submission);
    const dir = `${slugify(submission.student)}/${slugify(assignment.title, submission.assignmentId)}`;
    const lockPath = `${dir}/repro.lock`;
    const reviewPath = `${dir}/review.txt`;
    entries.push({ path: lockPath, content: formatLock(submission.lockJson) });
    entries.push({ path: reviewPath, content: reviewCard(submission, verification) });
    files.push(lockPath, reviewPath);
  }

  const manifest: CoursePackageManifest = {
    generator: 'ergalics-studio/course-export',
    generatedAt: now.toISOString(),
    course: { id: course.id, name: course.name, owner: course.owner },
    assignments: course.assignments.map((a) => ({
      id: a.id,
      title: a.title,
      ...(a.templateId ? { templateId: a.templateId } : {}),
      ...(a.dueAt !== undefined ? { dueAt: a.dueAt } : {}),
      hasExpectation: a.expectedLockJson !== undefined,
    })),
    students,
    submissions: submissions.map((s) => {
      const assignment = findAssignment(course, s.assignmentId);
      const verification = assignment
        ? verifySubmission(assignment, s)
        : { state: 'drift' as const, reasons: ['assignment-missing'] };
      return {
        assignmentId: s.assignmentId,
        student: s.student,
        submittedAt: s.submittedAt,
        state: verification.state,
        reasons: verification.reasons,
        grade: s.review?.grade ?? null,
        comment: s.review?.comment ?? '',
      };
    }),
    files,
  };
  entries.unshift({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  return entries;
}

/**
 * Zip a package through an injected writer (keeps the core free of the zip
 * library and the DOM). The page passes an fflate-backed writer; tests pass
 * a recorder. Returns the writer's output (e.g. the zip bytes).
 */
export function writePackage<R>(entries: PackageEntry[], writer: (entries: PackageEntry[]) => R): R {
  return writer(entries);
}
