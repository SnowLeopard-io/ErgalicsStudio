// ==========================================================================
// Ergalics Studio — FR-13 course mode: project persistence wrapper (pure TS)
//
// Bridges the CourseData document (course/model.ts) to the IndexedDB
// `courses` partition (core/storage.ts). Reads degrade to an empty document
// when storage is unavailable (node tests, private mode); writes are
// best-effort with the result surfaced so the UI can show an error.
// ==========================================================================

import {
  getCoursePartition,
  saveCoursePartition,
  deleteCoursePartition,
} from '@/core/storage';
import {
  courseDataFromJson,
  courseDataToJson,
  emptyCourseData,
  type CourseData,
} from './model';

/** Load a project's course document (empty when nothing was stored yet). */
export async function loadCourseData(projectId: string): Promise<CourseData> {
  try {
    const partition = await getCoursePartition(projectId);
    if (!partition) return emptyCourseData(projectId);
    return courseDataFromJson(partition.json) ?? emptyCourseData(projectId);
  } catch {
    return emptyCourseData(projectId);
  }
}

/** Persist a course document; throws when storage is unavailable. */
export async function saveCourseData(data: CourseData): Promise<void> {
  const updatedAt = Date.now();
  await saveCoursePartition({
    projectId: data.projectId,
    json: courseDataToJson({ ...data, updatedAt }),
    updatedAt,
  });
}

/** Remove a project's course partition (cascade on project deletion). */
export async function clearCourseData(projectId: string): Promise<void> {
  try {
    await deleteCoursePartition(projectId);
  } catch {
    /* partition already gone or storage unavailable */
  }
}
