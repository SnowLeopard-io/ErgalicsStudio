// ==========================================================================
// FR-13 course mode — core tests
//
// Covers the domain model (factories, immutable operations, queries), the
// identity-free lock verification (pass / drift / not_submitted + reason
// codes), the class-package export structure (manifest + per-student
// folders through an injected writer), CourseData serialization round-trips,
// and the IndexedDB `courses` partition through a minimal fake (the store
// needs no indexes, so this fake is far smaller than the runs-suite one).
// Also guards zh/en key parity for the new `course` dictionary.
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssignment,
  createCourse,
  createSubmission,
  courseDataFromJson,
  courseDataToJson,
  deleteCourse,
  emptyCourseData,
  enrolledStudents,
  findAssignment,
  findCourse,
  findSubmission,
  isOverdue,
  recordSubmission,
  removeAssignment,
  reviewSubmission,
  submissionsFor,
  upsertAssignment,
  upsertCourse,
  visibleAssignments,
  type CourseData,
} from '@/core/course/model';
import { buildCourseMatrix, verifySubmission } from '@/core/course/verify';
import {
  buildCoursePackage,
  slugify,
  writePackage,
  type CoursePackageManifest,
} from '@/core/course/export';
import { clearCourseData, loadCourseData, saveCourseData } from '@/core/course/store';
import { __resetDbForTests } from '@/core/storage';
import { LOCK_SCHEMA } from '@/core/repro/lock';
import { courseEn, courseZh } from '@/i18n/dicts/course';

// ---- lock fixtures --------------------------------------------------------------

interface FixtureRun {
  id: string;
  paramsHash: string;
  seed: number | null;
  metrics: Record<string, number>;
  tolerance: number;
  label?: string;
}

/** Minimal structurally-valid repro.lock JSON (parseLock requirements only). */
function lockJson(
  data: Array<{ id: string; name: string; hash: string }>,
  runs: FixtureRun[],
): string {
  return JSON.stringify({
    schema: LOCK_SCHEMA,
    lockVersion: 2,
    projectId: 'proj-ref',
    projectName: 'reference',
    createdAt: '2026-01-01T00:00:00.000Z',
    versions: { studio: '0.1.0', projectFormat: '1.0' },
    data: data.map((f) => ({ id: f.id, name: f.name, size: 10, hash: f.hash })),
    code: { hash: 'ch', artifacts: [] },
    runs: runs.map((r) => ({
      id: r.id,
      source: 'flow',
      paramsHash: r.paramsHash,
      seed: r.seed,
      metrics: r.metrics,
      tolerance: r.tolerance,
      createdAt: 0,
      ...(r.label ? { label: r.label } : {}),
    })),
  });
}

const REF_DATA = [{ id: 'f1', name: 'measurements.csv', hash: 'h1' }];
const REF_RUN: FixtureRun = {
  id: 'r1',
  paramsHash: 'ph1',
  seed: 42,
  metrics: { loss: 1 },
  tolerance: 1e-9,
  label: 'baseline',
};

function assignmentWithExpectation(expected?: string) {
  return createAssignment({
    title: 'Fit the curve',
    templateId: 'bio-stats',
    expectedLockJson: expected ?? lockJson(REF_DATA, [REF_RUN]),
    id: 'a1',
    createdAt: 1,
  });
}

function submission(lock: string, student = 'alice'): CourseData['submissions'][number] {
  return createSubmission({
    courseId: 'c1',
    assignmentId: 'a1',
    student,
    lockJson: lock,
    id: `sub-${student}`,
    submittedAt: 2,
  });
}

// ---- model ------------------------------------------------------------------------

describe('course model', () => {
  it('creates entities with injected ids and trims names', () => {
    const course = createCourse({ id: 'c1', name: '  Biostats ', owner: ' prof ', createdAt: 5 });
    expect(course).toMatchObject({ id: 'c1', name: 'Biostats', owner: 'prof', createdAt: 5 });
    expect(course.assignments).toEqual([]);
    const assignment = createAssignment({ title: 'T1', id: 'a1', createdAt: 6 });
    expect(assignment.visible).toBe(true);
    expect(assignment.description).toBeUndefined();
    expect(assignment.templateId).toBeUndefined();
  });

  it('upserts and deletes courses; deleting a course takes its submissions', () => {
    let data = emptyCourseData('p1');
    const course = createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 });
    data = upsertCourse(data, course);
    data = upsertCourse(data, { ...course, name: 'B' });
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0]?.name).toBe('B');
    data = recordSubmission(data, submission('x'));
    data = deleteCourse(data, 'c1');
    expect(data.courses).toHaveLength(0);
    expect(data.submissions).toHaveLength(0);
  });

  it('upserts and removes assignments; withdrawal cascades submissions', () => {
    let data = emptyCourseData('p1');
    data = upsertCourse(data, createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 }));
    data = upsertAssignment(data, 'c1', assignmentWithExpectation());
    expect(findCourse(data, 'c1')?.assignments).toHaveLength(1);
    data = upsertAssignment(data, 'c1', createAssignment({ title: 'T2', id: 'a1', createdAt: 3 }));
    expect(findCourse(data, 'c1')?.assignments[0]?.title).toBe('T2');
    data = recordSubmission(data, submission('x'));
    data = removeAssignment(data, 'c1', 'a1');
    expect(findCourse(data, 'c1')?.assignments).toHaveLength(0);
    expect(data.submissions).toHaveLength(0);
    expect(findAssignment(createCourse({ id: 'c', name: 'n', owner: 'o' }), 'a1')).toBeUndefined();
  });

  it('keeps only the newest submission per (assignment, student)', () => {
    let data = emptyCourseData('p1');
    data = recordSubmission(data, { ...submission('old-lock'), submittedAt: 1 });
    data = recordSubmission(data, { ...submission('new-lock'), submittedAt: 2 });
    expect(data.submissions).toHaveLength(1);
    expect(data.submissions[0]?.lockJson).toBe('new-lock');
    // A different student is a different row.
    data = recordSubmission(data, submission('other', 'bob'));
    expect(data.submissions).toHaveLength(2);
  });

  it('reviews submissions and answers queries', () => {
    let data = emptyCourseData('p1');
    data = upsertCourse(data, createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 }));
    const hidden = createAssignment({ title: 'H', id: 'a2', visible: false, createdAt: 1 });
    data = upsertAssignment(data, 'c1', assignmentWithExpectation());
    data = upsertAssignment(data, 'c1', hidden);
    data = recordSubmission(data, submission('x', 'bob'));
    const bobSubmission = findSubmission(data, 'c1', 'a1', 'bob');
    expect(bobSubmission).toBeDefined();
    data = reviewSubmission(data, bobSubmission!.id, { grade: 90, comment: 'ok', reviewedAt: 3 });
    expect(findSubmission(data, 'c1', 'a1', 'bob')?.review?.grade).toBe(90);
    expect(enrolledStudents(data, 'c1')).toEqual(['bob']);
    expect(submissionsFor(data, 'c1')).toHaveLength(1);
    // Hidden assignment is invisible… until the student submitted to it.
    expect(visibleAssignments(findCourse(data, 'c1')!, 'alice', data).map((a) => a.id)).toEqual([
      'a1',
    ]);
    const withHidden = recordSubmission(
      data,
      createSubmission({ courseId: 'c1', assignmentId: 'a2', student: 'alice', lockJson: 'x' }),
    );
    expect(
      visibleAssignments(findCourse(withHidden, 'c1')!, 'alice', withHidden).map((a) => a.id),
    ).toEqual(['a1', 'a2']);
  });

  it('flags overdue assignments', () => {
    const a = createAssignment({ title: 'T', dueAt: 1000 });
    expect(isOverdue(a, 2000)).toBe(true);
    expect(isOverdue(a, 500)).toBe(false);
    expect(isOverdue(createAssignment({ title: 'T' }), 500)).toBe(false);
  });
});

// ---- serialization -----------------------------------------------------------------

describe('CourseData serialization', () => {
  it('round-trips a full document', () => {
    let data = emptyCourseData('p1');
    data = upsertCourse(data, createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 }));
    data = upsertAssignment(data, 'c1', assignmentWithExpectation());
    data = recordSubmission(data, submission('lock-text'));
    data = reviewSubmission(data, data.submissions[0]!.id, { grade: 88, comment: 'nice', reviewedAt: 9 });
    const back = courseDataFromJson(courseDataToJson(data));
    expect(back?.courses).toEqual(data.courses);
    expect(back?.submissions).toEqual(data.submissions);
    expect(back?.projectId).toBe('p1');
  });

  it('degrades safely on malformed documents', () => {
    expect(courseDataFromJson('not json')).toBeNull();
    expect(courseDataFromJson('"a string"')).toBeNull();
    expect(courseDataFromJson('{"projectId":"p"}')).toBeNull();
    const partial = courseDataFromJson(
      JSON.stringify({
        projectId: 'p1',
        courses: [{ id: 'c1', name: 'A', assignments: [] }, { id: 'bad' }],
        submissions: [
          { id: 's1', courseId: 'c1', assignmentId: 'a1', student: 'x', lockJson: 'l' },
          { id: 's2', courseId: 'ghost', assignmentId: 'a1', student: 'x', lockJson: 'l' },
          { id: 's3', courseId: 'c1', assignmentId: 'a1', student: 'x' },
        ],
      }),
    );
    expect(partial?.courses).toHaveLength(1);
    expect(partial?.submissions.map((s) => s.id)).toEqual(['s1']);
    expect(typeof partial?.updatedAt).toBe('number');
  });
});

// ---- verification -------------------------------------------------------------------

describe('verifySubmission', () => {
  const assignment = assignmentWithExpectation();

  it('reports not_submitted without a submission', () => {
    expect(verifySubmission(assignment, undefined)).toEqual({
      state: 'not_submitted',
      reasons: ['not-submitted'],
    });
  });

  it('drifts when the assignment has no expectation lock', () => {
    const bare = createAssignment({ title: 'T', id: 'a1' });
    expect(verifySubmission(bare, submission('whatever'))).toEqual({
      state: 'drift',
      reasons: ['no-expectation'],
    });
  });

  it('passes on an exact reproduction from a differently-identified project', () => {
    const studentLock = lockJson(
      [
        { id: 'f1', name: 'measurements.csv', hash: 'h1' },
        { id: 'f-extra', name: 'notes.txt', hash: 'h9' }, // extra files ignored
      ],
      [
        { id: 'r-student', paramsHash: 'ph1', seed: 42, metrics: { loss: 1 }, tolerance: 1e-9 },
        { id: 'r-other', paramsHash: 'zz', seed: null, metrics: {}, tolerance: 1e-9 }, // extra runs ignored
      ],
    );
    expect(verifySubmission(assignment, submission(studentLock))).toEqual({
      state: 'pass',
      reasons: [],
    });
  });

  it('passes when metrics sit inside the locked tolerance', () => {
    const near = lockJson(REF_DATA, [
      { ...REF_RUN, metrics: { loss: 1 + 1e-12 }, tolerance: 1e-6 },
    ]);
    expect(verifySubmission(assignment, submission(near)).state).toBe('pass');
  });

  it('drifts on missing or changed data files', () => {
    const missing = verifySubmission(
      assignment,
      submission(lockJson([], [REF_RUN])),
    );
    expect(missing.state).toBe('drift');
    expect(missing.reasons).toEqual(['missing-data:measurements.csv']);
    const changed = verifySubmission(
      assignment,
      submission(lockJson([{ id: 'f1', name: 'measurements.csv', hash: 'h1-tampered' }], [REF_RUN])),
    );
    expect(changed.reasons).toEqual(['changed-data:measurements.csv']);
  });

  it('drifts when the expected run is not reproduced (params, seed or metrics)', () => {
    const cases: FixtureRun[] = [
      { ...REF_RUN, paramsHash: 'other' },
      { ...REF_RUN, seed: 7 },
      { ...REF_RUN, metrics: { loss: 1.5 } },
      { ...REF_RUN, metrics: {} },
    ];
    for (const run of cases) {
      const result = verifySubmission(assignment, submission(lockJson(REF_DATA, [run])));
      expect(result.state).toBe('drift');
      expect(result.reasons).toEqual(['run-not-reproduced:baseline']);
    }
  });

  it('labels unreproduced runs by id when no label exists', () => {
    const unlabeled: FixtureRun = { ...REF_RUN, label: undefined };
    const target = createAssignment({
      title: 'T',
      id: 'a1',
      expectedLockJson: lockJson(REF_DATA, [unlabeled]),
    });
    const result = verifySubmission(
      target,
      submission(lockJson(REF_DATA, [{ ...unlabeled, seed: 99 }])),
    );
    expect(result.reasons).toEqual(['run-not-reproduced:r1']);
  });

  it('drifts on unparseable locks (either side)', () => {
    expect(verifySubmission(assignment, submission('garbage')).reasons).toEqual([
      'bad-submission-lock',
    ]);
    const brokenExpected = createAssignment({ title: 'T', id: 'a1', expectedLockJson: 'garbage' });
    expect(verifySubmission(brokenExpected, submission('x')).reasons).toEqual([
      'bad-expected-lock',
    ]);
  });
});

describe('buildCourseMatrix', () => {
  it('spans students × assignments with verification states', () => {
    const course = createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 });
    const assignment = assignmentWithExpectation();
    let data = upsertCourse(emptyCourseData('p1'), course);
    data = upsertAssignment(data, 'c1', assignment);
    data = recordSubmission(data, submission(lockJson(REF_DATA, [REF_RUN]), 'alice'));
    data = recordSubmission(data, submission(lockJson([], [REF_RUN]), 'bob'));
    const matrix = buildCourseMatrix([findCourse(data, 'c1')!], data.submissions);
    expect(matrix.students).toEqual(['alice', 'bob']);
    expect(matrix.cells).toHaveLength(2);
    const alice = matrix.cells.find((c) => c.student === 'alice');
    expect(alice?.state).toBe('pass');
    expect(alice?.graded).toBe(false);
    expect(matrix.cells.find((c) => c.student === 'bob')?.state).toBe('drift');
  });
});

// ---- export ---------------------------------------------------------------------------

describe('class package export', () => {
  function populatedData(): CourseData {
    let data = upsertCourse(
      emptyCourseData('p1'),
      createCourse({ id: 'c1', name: 'Biostats', owner: 'prof X', createdAt: 1 }),
    );
    data = upsertAssignment(data, 'c1', assignmentWithExpectation());
    data = recordSubmission(data, submission(lockJson(REF_DATA, [REF_RUN]), 'Ada Lovelace'));
    data = recordSubmission(data, submission(lockJson([], [REF_RUN]), 'bob'));
    data = reviewSubmission(data, data.submissions[0]!.id, { grade: 95, comment: 'excellent', reviewedAt: 4 });
    return data;
  }

  it('slugifies folder names safely', () => {
    expect(slugify('Ada Lovelace')).toBe('Ada_Lovelace');
    expect(slugify('a/b:c*d?')).toBe('a_b_c_d');
    expect(slugify('   ')).toBe('unnamed');
    expect(slugify('', 'fallback-id')).toBe('fallback-id');
  });

  it('builds manifest + per-student folders with locks and review cards', () => {
    const entries = buildCoursePackage(populatedData(), 'c1', new Date('2026-02-01T00:00:00Z'));
    expect(entries[0]?.path).toBe('manifest.json');
    const manifest = JSON.parse(entries[0]!.content) as CoursePackageManifest;
    expect(manifest.course).toEqual({ id: 'c1', name: 'Biostats', owner: 'prof X' });
    expect(manifest.students).toEqual(['Ada Lovelace', 'bob']);
    expect(manifest.assignments[0]).toMatchObject({ id: 'a1', title: 'Fit the curve', hasExpectation: true });
    expect(manifest.submissions.map((s) => [s.student, s.state])).toEqual([
      ['Ada Lovelace', 'pass'],
      ['bob', 'drift'],
    ]);
    expect(manifest.files).toEqual([
      'Ada_Lovelace/Fit_the_curve/repro.lock',
      'Ada_Lovelace/Fit_the_curve/review.txt',
      'bob/Fit_the_curve/repro.lock',
      'bob/Fit_the_curve/review.txt',
    ]);
    // Paths in the manifest match the actual entries.
    expect(entries.slice(1).map((e) => e.path)).toEqual(manifest.files);
    const review = entries.find((e) => e.path === 'Ada_Lovelace/Fit_the_curve/review.txt');
    expect(review?.content).toContain('verification: pass');
    expect(review?.content).toContain('grade: 95');
    expect(review?.content).toContain('comment: excellent');
    const ungraded = entries.find((e) => e.path === 'bob/Fit_the_curve/review.txt');
    expect(ungraded?.content).toContain('grade: (not graded)');
    expect(ungraded?.content).toContain('  - missing-data:measurements.csv');
  });

  it('feeds entries through the injected writer without touching it internally', () => {
    const entries = buildCoursePackage(populatedData(), 'c1');
    const seen = writePackage(entries, (list) => list.map((e) => e.path));
    expect(seen).toContain('manifest.json');
    expect(seen).toHaveLength(entries.length);
  });

  it('throws for an unknown course', () => {
    expect(() => buildCoursePackage(emptyCourseData('p1'), 'nope')).toThrow(/not found/);
  });
});

// ---- storage partition ------------------------------------------------------------------

interface FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function settle(result: unknown): FakeRequest {
  const req: FakeRequest = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

class FakeStore {
  private rows = new Map<string, Record<string, unknown>>();
  constructor(private keyPath: string) {}
  createIndex(): void {
    /* courses store never uses indexes */
  }
  put(value: Record<string, unknown>): FakeRequest {
    this.rows.set(value[this.keyPath] as string, value);
    return settle(undefined);
  }
  get(key: string): FakeRequest {
    return settle(this.rows.get(key));
  }
  delete(key: string): FakeRequest {
    this.rows.delete(key);
    return settle(undefined);
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(private stores: Map<string, FakeStore>) {
    queueMicrotask(() => {
      setTimeout(() => this.oncomplete?.(), 0);
    });
  }
  objectStore(name: string): FakeStore {
    const store = this.stores.get(name);
    if (!store) throw new Error(`no store ${name}`);
    return store;
  }
}

class FakeDb {
  objectStoreNames: { contains: (name: string) => boolean };
  private stores = new Map<string, FakeStore>();
  constructor() {
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }
  createObjectStore(name: string, opts: { keyPath: string }): FakeStore {
    const store = new FakeStore(opts.keyPath);
    this.stores.set(name, store);
    return store;
  }
  transaction(names: string | string[]): FakeTransaction {
    void names; // storage.ts passes a single store name; mode is ignored.
    return new FakeTransaction(this.stores);
  }
}

function installFakeIndexedDB(): void {
  const g = globalThis as unknown as {
    indexedDB: {
      open: (name: string, version: number) => {
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        result: FakeDb;
      };
    };
  };
  g.indexedDB = {
    open: (_name: string, _version: number) => {
      const req = {
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        result: new FakeDb(),
      };
      // storage.ts creates every missing store idempotently on the upgrade
      // pass, so the fake only needs to fire the callbacks in order.
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

describe('course storage partition', () => {
  beforeEach(() => {
    installFakeIndexedDB();
    __resetDbForTests();
  });

  afterEach(() => {
    const g = globalThis as unknown as { indexedDB?: unknown };
    delete g.indexedDB;
    __resetDbForTests();
  });

  it('saves and loads back a course document', async () => {
    let data = upsertCourse(
      emptyCourseData('p1'),
      createCourse({ id: 'c1', name: 'A', owner: 't', createdAt: 1 }),
    );
    data = upsertAssignment(data, 'c1', assignmentWithExpectation());
    data = recordSubmission(data, submission('lock-x'));
    await saveCourseData(data);
    const loaded = await loadCourseData('p1');
    expect(loaded.courses).toEqual(data.courses);
    expect(loaded.submissions).toEqual(data.submissions);
    expect(loaded.updatedAt).toBeGreaterThanOrEqual(data.updatedAt);
  });

  it('returns an empty document for unknown projects', async () => {
    const loaded = await loadCourseData('missing');
    expect(loaded.projectId).toBe('missing');
    expect(loaded.courses).toEqual([]);
  });

  it('clears the partition', async () => {
    await saveCourseData(emptyCourseData('p1'));
    await clearCourseData('p1');
    const loaded = await loadCourseData('p1');
    expect(loaded.submissions).toEqual([]);
    expect(loaded.courses).toEqual([]);
  });
});

// ---- dictionary parity -------------------------------------------------------------------

describe('course dictionary', () => {
  it('keeps zh and en key sets identical', () => {
    const zh = Object.keys(courseZh).sort();
    const en = Object.keys(courseEn).sort();
    expect(zh).toEqual(en);
    expect(zh.length).toBeGreaterThan(60);
  });

  it('every key uses the documented prefix', () => {
    for (const key of Object.keys(courseZh)) {
      expect(key.startsWith('course.') || key.startsWith('tool.')).toBe(true);
    }
  });
});
