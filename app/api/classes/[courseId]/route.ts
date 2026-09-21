import { apiError, apiSuccess } from '@/lib/server/api-response';
import { listCourseArtifacts, readServerCourse } from '@/lib/server/course-space-storage';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  const course = await readServerCourse(courseId);
  if (!course || course.status !== 'active') {
    return apiError('INVALID_REQUEST', 404, '正在授课的课程不存在');
  }
  const artifacts = (await listCourseArtifacts(courseId)).filter((item) => item.classVisible);
  const materials = course.materials.filter((item) => item.classVisible);
  return apiSuccess({
    course: {
      id: course.id,
      title: course.title,
      subject: course.subject,
      gradeBand: course.gradeBand,
      term: course.term,
      description: course.description,
      modules: course.modules,
    },
    resources: [
      ...materials.map((item) => ({
        id: item.id,
        title: item.name,
        origin: 'teacher' as const,
        kind: 'material' as const,
        status: item.status,
        url: `/api/course-space/${courseId}/materials/${item.id}`,
        activatedAt: item.activatedAt,
      })),
      ...artifacts.map((item) => ({
        id: item.id,
        title: item.title,
        origin: 'agent' as const,
        kind: 'artifact' as const,
        type: item.type,
        status: item.status,
        url: item.classroomUrl || `/course-space/${courseId}/artifacts/${item.id}/view`,
        activatedAt: item.activatedAt,
      })),
    ].sort((a, b) => (b.activatedAt ?? 0) - (a.activatedAt ?? 0)),
    students: course.classStudents ?? [],
  });
}
