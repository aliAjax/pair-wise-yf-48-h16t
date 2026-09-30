import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type {
  Criterion,
  LockedSnapshot,
  RankedRow,
  ReviewEvent,
  ReviewState,
  ReviewStatus,
  Scheme,
  ScoreRecord,
  ScoreReview,
  ScoreRevision,
  Viewer
} from "../types";

const KEY = "pair-wise-yf-48/review";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];
const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];
const criteria: Criterion[] = [
  { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
  { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
];

/** 当前标签页标识：用于区分同一评分是在哪个标签页被改动 */
const tabId = Math.random().toString(36).slice(2, 8);

function snapshotOf(item: ScoreRecord, source: string): ScoreRevision {
  const { revisions: _revisions, ...snapshot } = item;
  return { ...snapshot, updatedAt: new Date().toISOString(), source };
}

interface PersistedState {
  scores: ScoreRecord[];
  events: ReviewEvent[];
  published: boolean;
  schemeStatuses: Record<string, Scheme["status"]>;
  reviews: ScoreReview[];
  snapshot: LockedSnapshot | null;
}

export interface SaveOutcome {
  ok: boolean;
  conflict: boolean;
  /** 后保存者保存时，标签页外读到的更新版本 */
  newer?: ScoreRevision;
  version: number;
}

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return {
    id: `${judge}-${schemeId}`, judge, schemeId,
    values: Object.fromEntries(criteria.map((item) => [item.id, 60])),
    comment: "", submitted: false, conflict: false,
    updatedAt: new Date().toISOString(), version: 0, source: tabId, revisions: []
  };
}

function migrate(raw: any): PersistedState {
  const scores: ScoreRecord[] = Array.isArray(raw?.scores) ? raw.scores : [];
  return {
    scores: scores.map((score: ScoreRecord) => ({
      ...score,
      source: score.source ?? "legacy",
      version: typeof score.version === "number" ? score.version : 1,
      revisions: Array.isArray(score.revisions) ? score.revisions : []
    })),
    events: Array.isArray(raw?.events) ? raw.events : [],
    published: Boolean(raw?.published),
    schemeStatuses: raw?.schemeStatuses ?? {},
    reviews: Array.isArray(raw?.reviews) ? raw.reviews : [],
    snapshot: raw?.snapshot ?? null
  };
}

export const useReviewStore = defineStore("review", () => {
  const saved = localStorage.getItem(KEY);
  const initial = migrate(saved ? JSON.parse(saved) : {});
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme, status: initial.schemeStatuses?.[scheme.id] ?? scheme.status })));
  const scores = ref<ScoreRecord[]>(initial.scores);
  const events = ref<ReviewEvent[]>(initial.events);
  const published = ref<boolean>(initial.published);
  const reviews = ref<ScoreReview[]>(initial.reviews);
  const snapshot = ref<LockedSnapshot | null>(initial.snapshot);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  function persist() {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      published: published.value,
      schemeStatuses: Object.fromEntries(schemes.value.map((scheme) => [scheme.id, scheme.status])),
      reviews: reviews.value,
      snapshot: snapshot.value
    } satisfies PersistedState));
  }

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  // ---------- 复核派生状态 ----------

  function reviewFor(judgeName: Viewer, schemeId: string): ScoreReview | undefined {
    return reviews.value
      .filter((entry) => entry.judge === judgeName && entry.schemeId === schemeId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  /** 复核真实状态：已复核但绑定的评分版本已变化 → 待重新核对 */
  function reviewStateOf(entry: ScoreReview | undefined): ReviewState | null {
    if (!entry) return null;
    if (entry.status === "已复核") {
      const score = scores.value.find((item) => item.judge === entry.judge && item.schemeId === entry.schemeId);
      if (score && entry.reviewedVersion !== null && score.version !== entry.reviewedVersion) return "待重新核对";
    }
    return entry.status;
  }

  function currentReviewState(judgeName: Viewer, schemeId: string): ReviewState | null {
    return reviewStateOf(reviewFor(judgeName, schemeId));
  }

  /** 该评分是否退出当前排名：利益冲突，或锁定前登记的复核未完成（待处理 / 待重新核对） */
  function isExcluded(score: ScoreRecord): { excluded: boolean; reason: string; basis?: string } {
    if (score.conflict) return { excluded: true, reason: "利益冲突" };
    const entry = reviewFor(score.judge, score.schemeId);
    const state = reviewStateOf(entry);
    if (state === "待处理" || state === "待重新核对") {
      return { excluded: true, reason: state, basis: entry?.basis };
    }
    return { excluded: false, reason: "" };
  }

  // ---------- 方案行（实时口径，锁定前仅用于复核影响预览） ----------

  function weighted(score: ScoreRecord) {
    return criteria.reduce((value, criterion) => value + (score.values[criterion.id] ?? 0) * criterion.weight / 100, 0);
  }

  function liveRows(): RankedRow[] {
    return schemes.value.map((scheme) => {
      const rows = scores.value.filter((score) => score.schemeId === scheme.id && score.submitted);
      const excluded = rows
        .map((score) => ({ score, flag: isExcluded(score) }))
        .filter(({ flag }) => flag.excluded)
        .map(({ score, flag }) => ({ judge: score.judge, reason: flag.reason, basis: flag.basis }));
      const valid = rows.filter((score) => !isExcluded(score).excluded);
      const total = valid.length ? valid.reduce((sum, row) => sum + weighted(row), 0) / valid.length : 0;
      return {
        schemeId: scheme.id, code: scheme.code, title: scheme.title,
        total: Number(total.toFixed(2)),
        judgeCount: valid.length,
        conflictCount: rows.filter((score) => score.conflict).length,
        excluded
      };
    });
  }

  /** 有效评委不足两人 → 单列样本不足，不参与排名 */
  function splitRows(rows: RankedRow[]) {
    return {
      ranked: rows.filter((row) => row.judgeCount >= 2).sort((a, b) => b.total - a.total),
      insufficient: rows.filter((row) => row.judgeCount < 2)
    };
  }

  const liveSplit = computed(() => splitRows(liveRows()));

  const ranking = computed<RankedRow[]>(() => snapshot.value?.ranked ?? []);
  const insufficientRanking = computed<RankedRow[]>(() => snapshot.value?.insufficient ?? []);

  /** 锁定后登记、且尚未处理的依据记录（待更正），用于主办方后续追正，不影响锁定版本 */
  const correctionReviews = computed(() => reviews.value.filter((entry) => entry.status === "待更正"));

  // ---------- 评委评分（带版本与修订历史） ----------

  function record(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  function applyScore(
    schemeId: string,
    values: Record<string, number>,
    comment: string,
    conflictFlag: boolean,
    submitted: boolean,
    baseVersion: number
  ): SaveOutcome {
    const currentJudge = judge.value;
    if (!currentJudge) return { ok: false, conflict: false, version: baseVersion };

    // 先并入其它标签页写入的最新状态，再判断乐观并发
    ingestRemoteState();
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    const priorState = currentReviewState(currentJudge, schemeId);
    // 版本不一致：另一标签页已保存，先把对方那一版收入修订历史，再写入当前版本，两版都留痕
    const saveConflict = item.version !== baseVersion;
    const other = snapshotOf(item, item.source);
    if ((saveConflict || other.version > 0) && !item.revisions.some((rev) => rev.version === other.version)) {
      item.revisions.push(other);
    }
    const newer = saveConflict ? other : undefined;

    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflictFlag;
    item.submitted = submitted;
    item.version += 1;
    item.source = tabId;
    item.updatedAt = new Date().toISOString();

    // 复核期间评分被改动：旧复核绑定的版本与当前版本不再一致，自动转为待重新核对
    if (priorState === "已复核") {
      log("复核失效", `${currentJudge} · ${schemeCode(schemeId)}：复核依据的评分版本已被改动，需重新核对`);
    }

    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (submitted) {
      if (scheme) scheme.status = allSubmittedFor(schemeId) ? "已提交" : "评分中";
      log("提交评分", `${scheme?.code ?? schemeId}${saveConflict ? "，检测到另一标签页更新，两版修订均已保留" : item.revisions.length ? `，并存 ${item.revisions.length + 1} 版修订` : ""}`);
    } else {
      if (scheme && scheme.status === "待评分") scheme.status = "评分中";
      log("保存评分草稿", `${scheme?.code ?? schemeId}${saveConflict ? "，检测到另一标签页更新，两版修订均已保留" : conflictFlag ? "，声明利益冲突" : ""}`);
    }
    persist();
    return { ok: true, conflict: saveConflict, newer, version: item.version };
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflictFlag: boolean, baseVersion: number) {
    const existing = scores.value.find((score) => score.judge === judge.value && score.schemeId === schemeId);
    if (existing?.submitted) return { ok: false, conflict: false, version: existing.version };
    return applyScore(schemeId, values, comment, conflictFlag, false, baseVersion);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflictFlag: boolean, baseVersion: number) {
    return applyScore(schemeId, values, comment, conflictFlag, true, baseVersion);
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || published.value) return;
    const priorState = currentReviewState(item.judge, schemeId);
    item.submitted = false;
    item.version += 1;
    item.source = tabId;
    if (item.version > 1) item.revisions.push(snapshotOf(item, tabId));
    item.updatedAt = new Date().toISOString();
    // 复核进行中退回修改：评分版本变化，已复核结论同步失效
    if (priorState === "已复核") {
      log("复核失效", `${item.judge} · ${schemeCode(schemeId)}：评分退回修改，原复核需重新核对`);
    }
    log("退回评分修改", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
    persist();
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  // ---------- 主办方复核 ----------

  function schemeCode(schemeId: string) {
    return schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
  }

  /** 登记复核依据；锁定后只生成待更正记录，原排名与锁定版本不动 */
  function registerReview(judgeName: Viewer, schemeId: string, basis: string): boolean {
    const score = scores.value.find((item) => item.judge === judgeName && item.schemeId === schemeId);
    if (!score || !score.submitted) return false;
    const state = currentReviewState(judgeName, schemeId);
    if (state === "待处理" || state === "待重新核对") return false;
    const status: ReviewStatus = published.value ? "待更正" : "待处理";
    const now = new Date().toISOString();
    reviews.value.push({
      id: crypto.randomUUID(), judge: judgeName, schemeId, basis: basis.trim(),
      status, createdAt: now, updatedAt: now, reviewedAt: null, reviewedVersion: null, reviewNote: ""
    });
    log(published.value ? "登记待更正依据" : "登记复核依据", `${judgeName} · ${schemeCode(schemeId)}：${basis.trim()}${published.value ? "（锁定后登记，不影响锁定排名）" : "，对应评分退出排名"}`);
    persist();
    return true;
  }

  /** 复核通过：绑定当前评分版本，评分恢复进入排名 */
  function completeReview(reviewId: string, note: string) {
    const entry = reviews.value.find((item) => item.id === reviewId);
    if (!entry) return;
    const score = scores.value.find((item) => item.judge === entry.judge && item.schemeId === entry.schemeId);
    entry.status = "已复核";
    entry.reviewedVersion = score?.version ?? null;
    entry.reviewedAt = new Date().toISOString();
    entry.reviewNote = note.trim();
    entry.updatedAt = entry.reviewedAt;
    log("复核通过", `${entry.judge} · ${schemeCode(entry.schemeId)}：依据评分 v${entry.reviewedVersion ?? "?"}，恢复进入排名`);
    persist();
  }

  function publish() {
    if (!schemes.value.every((scheme) => allSubmittedFor(scheme.id))) return;
    const split = splitRows(liveRows());
    snapshot.value = { lockedAt: new Date().toISOString(), ranked: split.ranked, insufficient: split.insufficient };
    published.value = true;
    schemes.value.forEach((scheme) => { scheme.status = "已锁定"; });
    const pending = reviews.value.filter((entry) => ["待处理", "待重新核对"].includes(currentReviewState(entry.judge, entry.schemeId) ?? ""));
    log("锁定并发布结果", `${schemes.value.length} 个方案，正式排名 ${split.ranked.length} 个、样本不足 ${split.insufficient.length} 个${pending.length ? `，仍有 ${pending.length} 条复核待处理（保留在锁定版本外）` : ""}`);
    persist();
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  // 静默合并其它标签页状态：仅当并入了更新内容才允许深度 watch 落盘，避免标签页间事件回环
  let silentIngest = false;

  // ---------- 跨标签页合并（幂等并集，按 id/版本取新；无变化不落盘，杜绝事件回环） ----------

  /** 由 storage 事件触发合并期间置位，深度 watch 据此跳过持久化 */
  let suppressPersist = false;

  function ingestRemoteState(): boolean {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const remote = migrate(JSON.parse(raw));
    let changed = false;
    suppressPersist = true;
    try {
      for (const incoming of remote.scores) {
        const local = scores.value.find((item) => item.id === incoming.id);
        if (!local) {
          scores.value.push(incoming);
          changed = true;
        } else if (incoming.version > local.version) {
          // 修订历史按版本取并集：并发保存时两个标签页各自留存的对方版本都不能丢
          const merged = [...local.revisions];
          for (const rev of incoming.revisions) {
            if (!merged.some((item) => item.version === rev.version)) merged.push(rev);
          }
          if (!merged.some((item) => item.version === local.version)) {
            const { revisions: _omit, ...currentSnapshot } = local;
            merged.push(currentSnapshot as ScoreRevision);
          }
          merged.sort((a, b) => a.version - b.version);
          Object.assign(local, incoming, { revisions: merged });
          changed = true;
        } else if (incoming.version === local.version && incoming.revisions.length > local.revisions.length) {
          // 同版本（后保存事件回传）：补齐对端新增的历史修订
          const merged = [...local.revisions];
          for (const rev of incoming.revisions) {
            if (!merged.some((item) => item.version === rev.version)) merged.push(rev);
          }
          if (merged.length !== local.revisions.length) {
            merged.sort((a, b) => a.version - b.version);
            local.revisions = merged;
            changed = true;
          }
        }
      }
      for (const incoming of remote.reviews) {
        const local = reviews.value.find((item) => item.id === incoming.id);
        if (!local) {
          reviews.value.push(incoming);
          changed = true;
        } else if (incoming.updatedAt.localeCompare(local.updatedAt) > 0) {
          Object.assign(local, incoming);
          changed = true;
        }
      }
      let addedEvents = false;
      for (const incoming of remote.events) {
        if (!events.value.some((item) => item.id === incoming.id)) {
          events.value.push(incoming);
          addedEvents = true;
        }
      }
      if (addedEvents) {
        events.value.sort((a, b) => b.time.localeCompare(a.time));
        changed = true;
      }
      if (remote.snapshot && snapshot.value?.lockedAt !== remote.snapshot.lockedAt) {
        snapshot.value = remote.snapshot;
        changed = true;
      }
      if (remote.published && !published.value) {
        published.value = true;
        schemes.value.forEach((scheme) => { scheme.status = "已锁定"; });
        changed = true;
      }
    } finally {
      suppressPersist = false;
    }
    return changed;
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== KEY || !event.newValue) return;
    ingestRemoteState();
  }
  window.addEventListener("storage", onStorage);

  watch([scores, events, published, schemes, reviews, snapshot], () => {
    if (!suppressPersist) persist();
  }, { deep: true });

  return {
    viewer, schemes, criteria, judges, scores, events, published, reviews, snapshot, tabId,
    ranking, insufficientRanking, correctionReviews, liveSplit, visibleScores,
    isOrganizer, judge, setViewer, record, saveDraft, submit, recalled, publish, allSubmittedFor,
    reviewFor, reviewStateOf, currentReviewState, isExcluded, registerReview, completeReview
  };
});
