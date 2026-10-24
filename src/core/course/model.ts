// ==========================================================================
// Ergalics Studio — FR-13 course mode: domain model (pure TS)
//
// A local-first teaching loop: a teacher creates a Course (owned by a local
// identity string — no accounts), publishes Assignments (optionally bound to
// a subject-template id from @/core/templates/catalog), students claim the
// task, work in a project, and Submit a repro.lock snapshot of their run
// results. The teacher reviews a student × assignment matrix, records a
// grade + comment, and exports the whole class as a package with one folder
// per student. Persistence lives in the IndexedDB `courses` store (see
// core/storage.ts); this module is DOM-free and fully unit-testable.
// ==========================================================================

/** Which side of the course UI an identity is acting on (local, not enforced). */
export type CourseRole = 'teacher' | 'student';

export interface Course {
  id: string;
  name: string;
  /** Local identity string of the owning teacher. */
  owner: string;
  createdAt: number;
  assignments: Assignment[];
}

export interface Assignment {
  id: string;
  title: string;
  description?: string;
  /** Subject-template id (core/templates/catalog) the task is based on. */
  templateId?: string;
  /** Epoch ms deadline; undefined = no deadline. */
  dueAt?: number;
  /** Hidden assignments stay invisible to students. */
  visible: boolean;
  /**
   * Expected repro.lock JSON captured from the solved reference project.
   * `verifySubmission` compares student submissions against it; without an
   * expectation a submission can only be recorded, not verified.
   */
  expectedLockJson?: string;
  createdAt: number;
}

export interface SubmissionReview {
  /** 0–100 grade, null = pass/fail only (no numeric grade). */
  grade: number | null;
  comment: string;
  reviewedAt: number;
}

export interface Submission {
  id: string;
  courseId: string;
  assignmentId: string;
  /** Local identity string of the submitting student. */
  student: string;
  /** repro.lock snapshot taken at submit time (JSON text). */
  lockJson: string;
  submittedAt: number;
  review?: SubmissionReview;
}

/** The persisted course partition for one project. */
export interface CourseData {
  projectId: string;
  courses: Course[];
  submissions: Submission[];
  updatedAt: number;
}

export function emptyCourseData(projectId: string): CourseData {
  return { projectId, courses: [], submissions: [], updatedAt: Date.now() };
}

// ---- factories (ids/timestamps injectable for deterministic tests) ----------

export interface NewCourseInput {
  name: string;
  owner: string;
  id?: string;
  createdAt?: number;
}

export function createCourse(input: NewCourseInput): Course {
  return {
    id: input.id ?? newId(),
    name: input.name.trim(),
    owner: input.owner.trim(),
    createdAt: input.createdAt ?? Date.now(),
    assignments: [],
  };
}

export interface NewAssignmentInput {
  title: string;
  description?: string;
  templateId?: string;
  dueAt?: number;
  visible?: boolean;
  expectedLockJson?: string;
  id?: string;
  createdAt?: number;
}

export function createAssignment(input: NewAssignmentInput): Assignment {
  return {
    id: input.id ?? newId(),
    title: input.title.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    visible: input.visible ?? true,
    ...(input.expectedLockJson ? { expectedLockJson: input.expectedLockJson } : {}),
    createdAt: input.createdAt ?? Date.now(),
  };
}

export interface NewSubmissionInput {
  courseId: string;
  assignmentId: string;
  student: string;
  lockJson: string;
  id?: string;
  submittedAt?: number;
}

export function createSubmission(input: NewSubmissionInput): Submission {
  return {
    id: input.id ?? newId(),
    courseId: input.courseId,
    assignmentId: input.assignmentId,
    student: input.student.trim(),
    lockJson: input.lockJson,
    submittedAt: input.submittedAt ?? Date.now(),
  };
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ---- immutable data operations ------------------------------------------------

export function upsertCourse(data: CourseData, course: Course): CourseData {
  const exists = data.courses.some((c) => c.id === course.id);
  return {
    ...data,
    courses: exists
      ? data.courses.map((c) => (c.id === course.id ? course : c))
      : [...data.courses, course],
    updatedAt: Date.now(),
  };
}

export function deleteCourse(data: CourseData, courseId: string): CourseData {
  return {
    ...data,
    courses: data.courses.filter((c) => c.id !== courseId),
    submissions: data.submissions.filter((s) => s.courseId !== courseId),
    updatedAt: Date.now(),
  };
}

/** Add or replace an assignment inside a course (immutable). */
export function upsertAssignment(data: CourseData, courseId: string, assignment: Assignment): CourseData {
  return {
    ...data,
    courses: data.courses.map((course) => {
      if (course.id !== courseId) return course;
      const exists = course.assignments.some((a) => a.id === assignment.id);
      return {
        ...course,
        assignments: exists
          ? course.assignments.map((a) => (a.id === assignment.id ? assignment : a))
          : [...course.assignments, assignment],
      };
    }),
    updatedAt: Date.now(),
  };
}

export function removeAssignment(data: CourseData, courseId: string, assignmentId: string): CourseData {
  return {
    ...data,
    courses: data.courses.map((course) =>
      course.id === courseId
        ? { ...course, assignments: course.assignments.filter((a) => a.id !== assignmentId) }
        : course,
    ),
    // A withdrawn assignment takes its submissions with it.
    submissions: data.submissions.filter(
      (s) => !(s.courseId === courseId && s.assignmentId === assignmentId),
    ),
    updatedAt: Date.now(),
  };
}

/** Record a submission: the newest submit per (assignment, student) wins. */
export function recordSubmission(data: CourseData, submission: Submission): CourseData {
  const submissions = data.submissions.filter(
    (s) => !(s.assignmentId === submission.assignmentId && s.student === submission.student),
  );
  return { ...data, submissions: [...submissions, submission], updatedAt: Date.now() };
}

export function reviewSubmission(
  data: CourseData,
  submissionId: string,
  review: SubmissionReview,
): CourseData {
  return {
    ...data,
    submissions: data.submissions.map((s) => (s.id === submissionId ? { ...s, review } : s)),
    updatedAt: Date.now(),
  };
}

// ---- queries -------------------------------------------------------------------

export function findCourse(data: CourseData, courseId: string): Course | undefined {
  return data.courses.find((c) => c.id === courseId);
}

export function findAssignment(course: Course, assignmentId: string): Assignment | undefined {
  return course.assignments.find((a) => a.id === assignmentId);
}

/** Assignments a given student may see (visible, or already submitted). */
export function visibleAssignments(course: Course, student: string, data: CourseData): Assignment[] {
  return course.assignments.filter(
    (a) =>
      a.visible ||
      data.submissions.some((s) => s.assignmentId === a.id && s.student === student),
  );
}

/** Every distinct student identity that submitted to the course, sorted. */
export function enrolledStudents(data: CourseData, courseId: string): string[] {
  const set = new Set<string>();
  for (const s of data.submissions) if (s.courseId === courseId) set.add(s.student);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function submissionsFor(data: CourseData, courseId: string): Submission[] {
  return data.submissions.filter((s) => s.courseId === courseId);
}

export function findSubmission(
  data: CourseData,
  courseId: string,
  assignmentId: string,
  student: string,
): Submission | undefined {
  return data.submissions.find(
    (s) => s.courseId === courseId && s.assignmentId === assignmentId && s.student === student,
  );
}

export function isOverdue(assignment: Assignment, now: number = Date.now()): boolean {
  return assignment.dueAt !== undefined && assignment.dueAt < now;
}

// ---- serialization (storage round-trip) ------------------------------------------

export function courseDataToJson(data: CourseData): string {
  return JSON.stringify(data);
}

/** Parse a persisted CourseData; malformed / partial documents degrade safely. */
export function courseDataFromJson(raw: string): CourseData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const d = parsed as Partial<CourseData>;
  if (typeof d.projectId !== 'string' || !Array.isArray(d.courses) || !Array.isArray(d.submissions)) {
    return null;
  }
  const courses = d.courses.filter(
    (c): c is Course =>
      !!c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.assignments),
  );
  const courseIds = new Set(courses.map((c) => c.id));
  const submissions = d.submissions.filter(
    (s): s is Submission =>
      !!s &&
      typeof s.id === 'string' &&
      typeof s.student === 'string' &&
      typeof s.assignmentId === 'string' &&
      typeof s.lockJson === 'string' &&
      courseIds.has(s.courseId),
  );
  return {
    projectId: d.projectId,
    courses,
    submissions,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
  };
}
