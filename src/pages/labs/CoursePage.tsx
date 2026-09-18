// ==========================================================================
// Ergalics Studio — FR-13 course mode tool page (ToolShell)
//
// Pure-local teaching loop, no accounts: the user types a local identity
// string and picks teacher / student. Teachers create courses, publish
// assignments (optionally bound to a subject template, with deadline and
// visibility), capture the expected repro.lock from the solved reference
// project, review a student × assignment matrix and export the class
// package (one folder per student, zipped through fflate). Students join a
// course by id, claim tasks (opening the template project), and submit the
// current project's repro.lock snapshot. All domain logic lives in
// @/core/course; this file only orchestrates stores + renders.
//
// The identity is a *two-step* flow: the sign-in screen edits a local draft
// and only commits on Enter/button press, so typing a single character never
// yanks the user into the workbench, and re-editing the identity later can't
// wipe the persisted value mid-keystroke.
// ==========================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { useProjectStore } from '@/stores/projectStore';
import { SUBJECT_TEMPLATES, getTemplate, pickLocale } from '@/core/templates/catalog';
import { buildLock, lockToJson } from '@/core/repro/lock';
import { listRuns } from '@/core/storage';
import { zipSync, strToU8 } from 'fflate';
import { downloadBlob } from '@/core/download';
import { serializeProject } from '@/types/project';
import {
  createAssignment,
  createCourse,
  createSubmission,
  deleteCourse,
  findAssignment,
  findCourse,
  findSubmission,
  isOverdue,
  recordSubmission,
  removeAssignment,
  reviewSubmission,
  upsertAssignment,
  visibleAssignments,
  type CourseData,
} from '@/core/course/model';
import { loadCourseData, saveCourseData } from '@/core/course/store';
import { buildCoursePackage, writePackage, type PackageEntry } from '@/core/course/export';
import { buildCourseMatrix, verifySubmission, type SubmissionState } from '@/core/course/verify';

const IDENTITY_KEY = 'ergalics:course:identity';
const ROLE_KEY = 'ergalics:course:role';

function readLocal(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Split a verify reason code `missing-data:name` into key + param. */
function reasonText(t: (k: string, p?: Record<string, string | number>) => string, reason: string): string {
  const [code, ...rest] = reason.split(':');
  const name = rest.join(':');
  const key = `course.reason.${code}`;
  const text = t(key, name ? { name } : undefined);
  return text === key ? reason : text;
}

const STATE_CLASS: Record<SubmissionState, string> = {
  pass: 'course-state-pass',
  drift: 'course-state-drift',
  not_submitted: 'course-state-missing',
};

export default function CoursePage() {
  const t = useT();
  const { locale } = useLocale();
  const project = useProjectStore((s) => s.project);

  // Committed identity + role (persisted). `showSetup` gates the sign-in
  // screen; the draft input never touches `identity` until confirmed.
  const [identity, setIdentity] = useState(() => readLocal(IDENTITY_KEY, ''));
  const [role, setRole] = useState<'teacher' | 'student'>(() =>
    readLocal(ROLE_KEY, 'teacher') === 'student' ? 'student' : 'teacher',
  );
  const [showSetup, setShowSetup] = useState(() => !readLocal(IDENTITY_KEY, '').trim());
  const [draft, setDraft] = useState(() => readLocal(IDENTITY_KEY, ''));

  const [data, setData] = useState<CourseData | null>(null);
  const [note, setNote] = useState('');
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');

  // New-course / new-assignment forms
  const [courseName, setCourseName] = useState('');
  const [asgTitle, setAsgTitle] = useState('');
  const [asgDesc, setAsgDesc] = useState('');
  const [asgTemplate, setAsgTemplate] = useState('');
  const [asgDue, setAsgDue] = useState('');
  const [asgVisible, setAsgVisible] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{ submissionId: string } | null>(null);
  const [gradeText, setGradeText] = useState('');
  const [commentText, setCommentText] = useState('');

  const projectId = project?.id ?? null;
  const reload = useCallback(async () => {
    if (!projectId) {
      setData(null);
      return;
    }
    setData(await loadCourseData(projectId));
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async (next: CourseData) => {
      setData(next);
      try {
        await saveCourseData(next);
        setNote(t('course.saved'));
      } catch {
        setNote(t('course.storage_error'));
      }
    },
    [t],
  );

  const openCourse = openCourseId && data ? findCourse(data, openCourseId) : undefined;
  const isTeacher = openCourse ? openCourse.owner === identity : false;
  const matrix = useMemo(
    () =>
      data && openCourse
        ? buildCourseMatrix(
            [openCourse],
            data.submissions.filter((s) => s.courseId === openCourse.id),
          )
        : null,
    [data, openCourse],
  );

  /** Confirm the sign-in screen: commit the draft identity + role. */
  const commitIdentity = () => {
    const value = draft.trim();
    if (!value) return;
    setIdentity(value);
    writeLocal(IDENTITY_KEY, value);
    writeLocal(ROLE_KEY, role);
    setShowSetup(false);
    setNote('');
  };

  /** Open the sign-in screen again to re-edit the identity (drafting, safe). */
  const editIdentityClick = () => {
    setDraft(identity);
    setShowSetup(true);
  };

  // ---- teacher actions ------------------------------------------------------

  const createCourseClick = async () => {
    if (!data || !identity.trim() || !courseName.trim()) return;
    const course = createCourse({ name: courseName, owner: identity });
    await persist({ ...data, courses: [...data.courses, course] });
    setCourseName('');
    setOpenCourseId(course.id);
  };

  const deleteCourseClick = async () => {
    if (!data || !openCourse) return;
    await persist(deleteCourse(data, openCourse.id));
    setOpenCourseId(null);
  };

  const saveAssignment = async () => {
    if (!data || !openCourse || !asgTitle.trim()) return;
    const assignment = createAssignment({
      title: asgTitle,
      description: asgDesc,
      templateId: asgTemplate || undefined,
      dueAt: asgDue ? Date.parse(asgDue) : undefined,
      visible: asgVisible,
    });
    await persist(upsertAssignment(data, openCourse.id, assignment));
    setAsgTitle('');
    setAsgDesc('');
    setAsgTemplate('');
    setAsgDue('');
  };

  const captureExpectation = async (assignmentId: string) => {
    if (!data || !project) {
      setNote(t('course.lock_failed'));
      return;
    }
    try {
      const runs = await listRuns(project.id);
      const lock = buildLock(project, { runs });
      const course = findCourse(data, openCourseId ?? '');
      const assignment = course ? findAssignment(course, assignmentId) : undefined;
      if (!course || !assignment) return;
      await persist(
        upsertAssignment(data, course.id, { ...assignment, expectedLockJson: lockToJson(lock) }),
      );
      setNote(t('course.expectation_set', { n: lock.runs.length }));
    } catch {
      setNote(t('course.lock_failed'));
    }
  };

  const withdrawAssignment = async (assignmentId: string) => {
    if (!data || !openCourse) return;
    await persist(removeAssignment(data, openCourse.id, assignmentId));
  };

  const saveReview = async () => {
    if (!data || !reviewTarget) return;
    const parsed = Number(gradeText);
    const grade = gradeText.trim() === '' || !Number.isFinite(parsed) ? null : Math.max(0, Math.min(100, parsed));
    await persist(
      reviewSubmission(data, reviewTarget.submissionId, {
        grade,
        comment: commentText.trim(),
        reviewedAt: Date.now(),
      }),
    );
    setReviewTarget(null);
    setNote(t('course.review_saved'));
  };

  const exportPackage = async () => {
    if (!data || !openCourse) return;
    if (data.submissions.every((s) => s.courseId !== openCourse.id)) {
      setNote(t('course.export_empty'));
      return;
    }
    try {
      const entries = buildCoursePackage(data, openCourse.id);
      const zip = writePackage(entries, (list: PackageEntry[]) =>
        zipSync(
          Object.fromEntries(list.map((e) => [e.path, strToU8(e.content)])),
          { level: 6 },
        ),
      );
      downloadBlob(
        `${openCourse.name.replace(/[^\w.-]+/g, '_')}-submissions.zip`,
        new Blob([zip], { type: 'application/zip' }),
      );
      setNote(t('course.exported', { n: entries.length }));
    } catch (err) {
      setNote(t('course.export_failed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ---- student actions --------------------------------------------------------

  const claimTask = async (templateId?: string) => {
    if (!templateId) return;
    const tpl = getTemplate(templateId);
    if (!tpl) return;
    try {
      await useProjectStore.getState().loadProjectFromText(serializeProject(tpl.buildProject()));
      setNote(t('course.claimed'));
    } catch {
      setNote(t('course.claim_failed'));
    }
  };

  const submitCurrent = async (assignmentId: string) => {
    if (!data || !openCourse || !project || !identity.trim()) return;
    try {
      const runs = await listRuns(project.id);
      const lock = buildLock(project, { runs });
      const submission = createSubmission({
        courseId: openCourse.id,
        assignmentId,
        student: identity,
        lockJson: lockToJson(lock),
      });
      await persist(recordSubmission(data, submission));
      setNote(t('course.submitted', { time: fmtTime(submission.submittedAt) }));
    } catch {
      setNote(t('course.lock_failed'));
    }
  };

  // ---- render ---------------------------------------------------------------

  // Sign-in screen: edits a local draft; commits on Enter / button only.
  if (showSetup) {
    return (
      <ToolShell toolId="course">
        <div className="course-shell course-signin">
          <div className="course-signin-card">
            <h2 className="course-signin-title">{t('course.title')}</h2>
            <p className="course-signin-desc">{t('course.signin_desc')}</p>

            <label className="course-field">
              <span className="course-field-label">{t('course.identity')}</span>
              <input
                className="input"
                value={draft}
                placeholder={t('course.identity_placeholder')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitIdentity();
                }}
                autoFocus
              />
            </label>

            <div className="course-field">
              <span className="course-field-label">{t('course.role')}</span>
              <div className="course-role-options">
                <button
                  type="button"
                  className={`course-role-option${role === 'teacher' ? ' is-active' : ''}`}
                  onClick={() => setRole('teacher')}
                >
                  <span className="course-role-name">{t('course.role.teacher')}</span>
                  <span className="course-role-hint">{t('course.role_hint_teacher')}</span>
                </button>
                <button
                  type="button"
                  className={`course-role-option${role === 'student' ? ' is-active' : ''}`}
                  onClick={() => setRole('student')}
                >
                  <span className="course-role-name">{t('course.role.student')}</span>
                  <span className="course-role-hint">{t('course.role_hint_student')}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary course-signin-cta"
              onClick={commitIdentity}
              disabled={!draft.trim()}
            >
              {t('course.enter')}
            </button>

            {identity.trim() !== '' && (
              <button type="button" className="btn course-signin-back" onClick={() => setShowSetup(false)}>
                {t('course.cancel')}
              </button>
            )}
          </div>
        </div>
      </ToolShell>
    );
  }

  return (
    <ToolShell toolId="course">
      <div className="analysis-body course-shell">
        {/* ---- identity bar + global alerts ---- */}
        <div className="course-identitybar">
          <span className="course-identity-chip">
            <span className={`course-chip-role course-chip-${role}`}>{t(`course.role.${role}`)}</span>
            {identity}
          </span>
          <button type="button" className="btn btn-sm course-change-btn" onClick={editIdentityClick}>
            {t('course.change')}
          </button>
        </div>
        {note && <p className="analysis-note">{note}</p>}
        {!project && <p className="analysis-note course-warn">{t('course.submit_need_project')}</p>}

        {!data ? null : !openCourse ? (
          <>
            {/* ---- course list / create / join ---- */}
            {role === 'teacher' ? (
              <section className="course-section">
                <h4 className="share-section-title">{t('course.new')}</h4>
                <div className="analysis-row">
                  <input
                    className="input"
                    value={courseName}
                    placeholder={t('course.course_name_placeholder')}
                    onChange={(e) => setCourseName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void createCourseClick()}
                    disabled={!courseName.trim()}
                  >
                    {t('course.create')}
                  </button>
                </div>
              </section>
            ) : (
              <section className="course-section">
                <h4 className="share-section-title">{t('course.enroll')}</h4>
                <div className="analysis-row">
                  <input
                    className="input"
                    value={joinCode}
                    placeholder={t('course.course_code')}
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const c = data.courses.find((x) => x.id === joinCode.trim());
                      if (c) setOpenCourseId(c.id);
                    }}
                    disabled={!joinCode.trim()}
                  >
                    {t('course.join')}
                  </button>
                </div>
              </section>
            )}

            <section className="course-section">
              <h4 className="share-section-title">{t('course.my_courses')}</h4>
              {data.courses.length === 0 && <p className="analysis-note">{t('course.no_courses')}</p>}
              <ul className="course-list">
                {data.courses.map((c) => (
                  <li key={c.id} className="course-list-item">
                    <button type="button" className="btn btn-sm" onClick={() => setOpenCourseId(c.id)}>
                      {c.name}
                    </button>
                    <span className="analysis-note">{t('course.owner', { name: c.owner })}</span>
                    <span className="analysis-note course-meta">{c.assignments.length} · {c.id.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <>
            {/* ---- open course ---- */}
            <div className="course-openbar">
              <button type="button" className="btn btn-sm" onClick={() => setOpenCourseId(null)}>
                {t('course.leave')}
              </button>
              <h4 className="share-section-title course-open-title">{openCourse.name}</h4>
              <span className="analysis-note">{t('course.owner', { name: openCourse.owner })}</span>
            </div>

            {isTeacher ? (
              <>
                {/* ---- teacher: assignment editor ---- */}
                <section className="course-section">
                  <h4 className="share-section-title">{t('course.new_assignment')}</h4>
                  <div className="analysis-row course-assignment-form">
                    <input className="input" value={asgTitle} placeholder={t('course.assignment_title')} onChange={(e) => setAsgTitle(e.target.value)} />
                    <select className="input" value={asgTemplate} onChange={(e) => setAsgTemplate(e.target.value)}>
                      <option value="">{t('course.template_none')}</option>
                      {SUBJECT_TEMPLATES.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {pickLocale(tpl.title, locale)}
                        </option>
                      ))}
                    </select>
                    <input className="input" type="datetime-local" value={asgDue} onChange={(e) => setAsgDue(e.target.value)} title={t('course.due_at')} />
                    <label className="analysis-label">
                      <input type="checkbox" checked={asgVisible} onChange={(e) => setAsgVisible(e.target.checked)} /> {t('course.visible')}
                    </label>
                    <button type="button" className="btn btn-primary" onClick={() => void saveAssignment()} disabled={!asgTitle.trim()}>
                      {t('course.save_assignment')}
                    </button>
                  </div>
                  <textarea className="input course-assignment-desc" rows={2} value={asgDesc} placeholder={t('course.assignment_desc')} onChange={(e) => setAsgDesc(e.target.value)} />
                </section>

                <section className="course-section">
                  <h4 className="share-section-title">{t('course.assignments')}</h4>
                  {openCourse.assignments.length === 0 && <p className="analysis-note">{t('course.no_tasks')}</p>}
                  {openCourse.assignments.map((a) => {
                    const subs = data.submissions.filter((s) => s.assignmentId === a.id);
                    return (
                      <div key={a.id} className="course-assignment-card">
                        <div className="course-card-head">
                          <strong>{a.title}</strong>
                          <span className="course-card-badges">
                            {!a.visible && <span className="course-badge">{t('course.hidden')}</span>}
                            {a.dueAt !== undefined && (
                              <span className={`course-badge ${isOverdue(a) ? 'course-overdue' : ''}`}>
                                {isOverdue(a) ? t('course.overdue') : t('course.due_left', { n: Math.max(0, Math.ceil((a.dueAt - Date.now()) / 86_400_000)) })}
                              </span>
                            )}
                            {a.templateId && <span className="course-badge">{getTemplate(a.templateId)?.title.en ?? a.templateId}</span>}
                          </span>
                        </div>
                        {a.description && <p className="analysis-note">{a.description}</p>}
                        <div className="analysis-row">
                          <span className="analysis-note">
                            {a.expectedLockJson ? t('course.expectation_set', { n: subs.length }) : t('course.expectation_none')}
                          </span>
                          <button type="button" className="btn btn-sm" onClick={() => void captureExpectation(a.id)}>
                            {t('course.set_expectation')}
                          </button>
                          <button type="button" className="btn btn-sm course-danger" onClick={() => void withdrawAssignment(a.id)}>
                            {t('course.remove_assignment')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>

                {/* ---- teacher: review matrix ---- */}
                <section className="course-section">
                  <h4 className="share-section-title">{t('course.review_matrix')}</h4>
                  {matrix && matrix.students.length > 0 ? (
                    <table className="course-matrix">
                      <thead>
                        <tr>
                          <th>{t('course.student')}</th>
                          {matrix.assignments.map((a) => (
                            <th key={a.id}>{a.title}</th>
                          ))}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.students.map((student) => (
                          <tr key={student}>
                            <td>{student}</td>
                            {matrix.assignments.map((a) => {
                              const cell = matrix.cells.find((c) => c.student === student && c.assignmentId === a.id);
                              const sub = findSubmission(data, openCourse.id, a.id, student);
                              return (
                                <td key={a.id}>
                                  <button
                                    type="button"
                                    className={`course-cell ${STATE_CLASS[cell?.state ?? 'not_submitted']}`}
                                    onClick={() => {
                                      if (!sub) return;
                                      setReviewTarget({ submissionId: sub.id });
                                      setGradeText(sub.review?.grade != null ? String(sub.review.grade) : '');
                                      setCommentText(sub.review?.comment ?? '');
                                    }}
                                  >
                                    {t(`course.state.${cell?.state ?? 'not_submitted'}`)}
                                    {cell?.graded ? ` · ${t('course.graded')}` : ''}
                                  </button>
                                </td>
                              );
                            })}
                            <td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="analysis-note">{t('course.no_submissions')}</p>
                  )}
                </section>

                {reviewTarget && (
                  <section className="course-section">
                    <h4 className="share-section-title">{t('course.review')}</h4>
                    <div className="analysis-row">
                      <input className="input" style={{ maxWidth: 120 }} type="number" min={0} max={100} value={gradeText} placeholder={t('course.grade')} onChange={(e) => setGradeText(e.target.value)} />
                      <button type="button" className="btn btn-primary" onClick={() => void saveReview()}>{t('course.save_review')}</button>
                      <button type="button" className="btn" onClick={() => setReviewTarget(null)}>{t('course.cancel')}</button>
                    </div>
                    <textarea className="input" rows={2} value={commentText} placeholder={t('course.comment')} onChange={(e) => setCommentText(e.target.value)} />
                  </section>
                )}

                <div className="course-foot-actions">
                  <button type="button" className="btn" onClick={() => void exportPackage()}>{t('course.export')}</button>
                  <button type="button" className="btn course-danger" onClick={() => void deleteCourseClick()}>{t('course.delete')}</button>
                </div>
              </>
            ) : (
              <>
                {/* ---- student: visible tasks ---- */}
                <section className="course-section">
                  <h4 className="share-section-title">{t('course.tasks')}</h4>
                  {visibleAssignments(openCourse, identity, data).length === 0 && (
                    <p className="analysis-note">{t('course.no_tasks')}</p>
                  )}
                  {visibleAssignments(openCourse, identity, data).map((a) => {
                    const sub = findSubmission(data, openCourse.id, a.id, identity);
                    const verification = verifySubmission(a, sub);
                    return (
                      <div key={a.id} className="course-assignment-card">
                        <div className="course-card-head">
                          <strong>{a.title}</strong>
                          <span className="course-card-badges">
                            {a.dueAt !== undefined && <span className={`course-badge ${isOverdue(a) ? 'course-overdue' : ''}`}>{fmtTime(a.dueAt)}</span>}
                            {sub && (
                              <span className={`course-badge ${STATE_CLASS[verification.state]}`}>
                                {t(`course.state.${verification.state}`)}
                              </span>
                            )}
                          </span>
                        </div>
                        {a.description && <p className="analysis-note">{a.description}</p>}
                        {verification.reasons.length > 0 && (
                          <p className="analysis-note course-reasons">
                            {t('course.reasons')}: {verification.reasons.map((r) => reasonText(t, r)).join('; ')}
                          </p>
                        )}
                        {sub && (
                          <p className="analysis-note">
                            {t('course.submitted', { time: fmtTime(sub.submittedAt) })}
                            {sub.review ? ` · ${t('course.grade')}: ${sub.review.grade ?? '—'}${sub.review.comment ? ` — ${sub.review.comment}` : ''}` : ''}
                          </p>
                        )}
                        <div className="course-actions">
                          {a.templateId && (
                            <button type="button" className="btn btn-sm" onClick={() => void claimTask(a.templateId)}>
                              {t('course.claim')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={!project}
                            onClick={() => void submitCurrent(a.id)}
                          >
                            {sub ? t('course.resubmit') : t('course.submit')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}