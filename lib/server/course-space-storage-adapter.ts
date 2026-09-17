import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AGENT_SESSION_LIFECYCLE,
  type AgentSessionMeta,
  type PersistedAgentSessionEvent,
} from '@openmaic/storage';
import {
  ensureAgentSessionSchema,
  PgAgentSessionStore,
  type AgentSessionTableNames,
} from '@openmaic/storage/agent-session/pg';

import type {
  CourseArtifactJob,
  CourseArtifactRecord,
  CourseMaterialExtraction,
  CourseSpace,
  PublishedKnowledgePackage,
} from '@/lib/course-space/types';
import {
  ensureCourseDatabaseSchema,
  getCourseDatabasePool,
  isCourseDatabaseConfigured,
  listCourseArtifactsFromDatabase,
  deleteCourseArtifactDatabaseRecord,
  readPublishedKnowledgePackageFromDatabase,
  upsertCourseArtifactDatabaseRecord,
  upsertCourseDatabaseRecord,
  upsertCourseJobDatabaseRecord,
  upsertKnowledgePackageDatabaseRecord,
  upsertMaterialExtractionDatabaseRecord,
} from '@/lib/server/course-space-database';

const TEACHER_SESSION_TABLES: AgentSessionTableNames = {
  sessions: 'mentra_teacher_agent_sessions',
  events: 'mentra_teacher_agent_events',
  entries: 'mentra_teacher_agent_entries',
  ownerEventCounters: 'mentra_teacher_agent_owner_counters',
  ownerEvents: 'mentra_teacher_agent_owner_events',
  urls: 'mentra_teacher_agent_urls',
};

export interface TeacherAgentTurnLease {
  sessionId: string;
  workerId: string;
  attempt: number;
  resumed: boolean;
}

export interface CourseSpaceStorageAdapter {
  readonly kind: 'postgres-openmaic' | 'file-fallback';
  saveCourse(course: CourseSpace): Promise<void>;
  saveMaterialExtraction(extraction: CourseMaterialExtraction): Promise<void>;
  saveJob(job: CourseArtifactJob): Promise<void>;
  saveArtifact(artifact: CourseArtifactRecord): Promise<void>;
  deleteArtifact(artifactId: string): Promise<void>;
  saveKnowledgePackage(pkg: PublishedKnowledgePackage): Promise<void>;
  listArtifacts(
    courseId: string,
    statuses?: CourseArtifactRecord['status'][],
  ): Promise<CourseArtifactRecord[] | undefined>;
  readPublishedKnowledgePackage(courseId: string): Promise<PublishedKnowledgePackage | undefined>;
  beginTeacherTurn(input: {
    sessionId: string;
    teacherId: string;
    courseId: string;
    message: string;
  }): Promise<TeacherAgentTurnLease | undefined>;
  completeTeacherTurn(
    lease: TeacherAgentTurnLease | undefined,
    output: { text: string; mode: string; action?: unknown; plan?: unknown },
  ): Promise<void>;
  failTeacherTurn(lease: TeacherAgentTurnLease | undefined, error: unknown): Promise<void>;
  readTeacherEvents(sessionId: string, after?: number): Promise<PersistedAgentSessionEvent[]>;
  getTeacherSession(sessionId: string): Promise<AgentSessionMeta | null>;
  listTeacherSessions(courseId: string, teacherId: string): Promise<AgentSessionMeta[]>;
}

let agentStorePromise: Promise<PgAgentSessionStore | undefined> | undefined;

async function createAgentStore(): Promise<PgAgentSessionStore | undefined> {
  const pool = getCourseDatabasePool();
  if (!pool) return undefined;
  await ensureCourseDatabaseSchema();
  await ensureAgentSessionSchema(pool, TEACHER_SESSION_TABLES);
  return new PgAgentSessionStore(pool, {
    tableNames: TEACHER_SESSION_TABLES,
    withTransaction: async <T>(operation: (transaction: PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

async function getAgentStore() {
  if (!isCourseDatabaseConfigured()) return undefined;
  agentStorePromise ??= createAgentStore().catch((error) => {
    agentStorePromise = undefined;
    throw error;
  });
  return agentStorePromise;
}

const adapter: CourseSpaceStorageAdapter = {
  get kind() {
    return isCourseDatabaseConfigured() ? 'postgres-openmaic' : 'file-fallback';
  },
  async saveCourse(course) { await upsertCourseDatabaseRecord(course); },
  async saveMaterialExtraction(extraction) { await upsertMaterialExtractionDatabaseRecord(extraction); },
  async saveJob(job) { await upsertCourseJobDatabaseRecord(job); },
  async saveArtifact(artifact) { await upsertCourseArtifactDatabaseRecord(artifact); },
  async deleteArtifact(artifactId) { await deleteCourseArtifactDatabaseRecord(artifactId); },
  async saveKnowledgePackage(pkg) { await upsertKnowledgePackageDatabaseRecord(pkg); },
  listArtifacts: listCourseArtifactsFromDatabase,
  readPublishedKnowledgePackage: readPublishedKnowledgePackageFromDatabase,

  async beginTeacherTurn({ sessionId, teacherId, courseId, message }) {
    const store = await getAgentStore();
    if (!store) return undefined;
    let session = await store.getSession(sessionId);
    if (!session) {
      session = await store.createSession({
        id: sessionId,
        ownerId: teacherId,
        prompt: `教师课程工作区：${courseId}`,
        stageId: courseId,
        skillId: 'mentra-teacher-workspace',
        origin: 'course-space',
        existingCourse: true,
        status: 'succeeded',
      });
    }
    if (session.ownerId !== teacherId || session.stageId !== courseId) {
      throw new Error('教师会话与当前课程不匹配');
    }
    await store.postUserMessage(sessionId, { text: message }, { expectedOwnerId: teacherId });
    const resumed = await store.hasSessionRunHistory(sessionId);
    const workerId = `teacher-api-${process.pid}-${randomUUID()}`;
    const claimed = await store.claimNextSession(workerId, process.pid, {
      sessionId,
      leaseTtlMs: 2 * 60_000,
      maxAttempts: 3,
    });
    if (!claimed) throw new Error('该教师会话正在处理另一项请求，请稍后重试');
    await store.appendRunEvent(sessionId, workerId, {
      ts: Date.now(),
      attempt: claimed.attempt,
      type: resumed ? AGENT_SESSION_LIFECYCLE.sessionResumed : AGENT_SESSION_LIFECYCLE.sessionStart,
      data: { courseId },
    });
    return { sessionId, workerId, attempt: claimed.attempt, resumed };
  },

  async completeTeacherTurn(lease, output) {
    if (!lease) return;
    const store = await getAgentStore();
    if (!store) return;
    await store.appendRunEvent(lease.sessionId, lease.workerId, {
      ts: Date.now(), attempt: lease.attempt, type: 'message_end', data: output,
    });
    await store.appendRunEvent(lease.sessionId, lease.workerId, {
      ts: Date.now(), attempt: lease.attempt, type: AGENT_SESSION_LIFECYCLE.checkpoint,
      data: { recoverable: true },
    });
    await store.finishSession(lease.sessionId, lease.workerId, {
      status: 'succeeded', expectedAttempt: lease.attempt, resetAttempt: true,
    });
  },

  async failTeacherTurn(lease, error) {
    if (!lease) return;
    const store = await getAgentStore();
    if (!store) return;
    const message = error instanceof Error ? error.message : String(error);
    await store.appendRunEvent(lease.sessionId, lease.workerId, {
      ts: Date.now(), attempt: lease.attempt, type: AGENT_SESSION_LIFECYCLE.sessionInterrupted,
      data: { error: message, recoverable: true },
    }).catch(() => undefined);
    await store.finishSession(lease.sessionId, lease.workerId, {
      status: 'failed', error: message, expectedAttempt: lease.attempt,
    }).catch(() => undefined);
  },

  async readTeacherEvents(sessionId, after = 0) {
    const store = await getAgentStore();
    return store ? store.readEventsAfterForReplay(sessionId, after, 500).then((item) => item.events) : [];
  },

  async getTeacherSession(sessionId) {
    const store = await getAgentStore();
    return store ? store.getSession(sessionId) : null;
  },

  async listTeacherSessions(courseId, teacherId) {
    const store = await getAgentStore();
    if (!store) return [];
    const sessions = await store.listSessionsByOwner(teacherId);
    return sessions
      .filter((session) => session.stageId === courseId && session.origin === 'course-space')
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
};

export function getCourseSpaceStorageAdapter(): CourseSpaceStorageAdapter {
  return adapter;
}
