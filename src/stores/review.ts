import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { Criterion, LockedRanking, RankingRow, ReviewRecord, ReviewResult, Scheme, SchemeStatus, ScoreRecord, Viewer } from "../types";

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

interface PersistState {
  scores: ScoreRecord[];
  events: ReviewEventLike[];
  published: boolean;
  schemeStatuses: Record<string, SchemeStatus>;
  reviews: ReviewRecord[];
  lockedRanking: LockedRanking | null;
}
type ReviewEventLike = { id: string; time: string; actor: Viewer; action: string; detail: string };

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  const now = new Date().toISOString();
  const values = Object.fromEntries(criteria.map((item) => [item.id, 60]));
  return {
    id: `${judge}-${schemeId}`, judge, schemeId, values: { ...values }, comment: "", submitted: false, conflict: false,
    updatedAt: now, version: 1,
    revisions: [{ version: 1, values: { ...values }, comment: "", conflict: false, updatedAt: now, actor: judge }]
  };
}

function readState(): PersistState {
  const fallback: PersistState = { scores: [], events: [], published: false, schemeStatuses: {}, reviews: [], lockedRanking: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      scores: parsed.scores ?? [],
      events: parsed.events ?? [],
      published: parsed.published ?? false,
      schemeStatuses: { ...(parsed.schemeStatuses ?? {}) },
      reviews: parsed.reviews ?? [],
      lockedRanking: parsed.lockedRanking ?? null
    };
  } catch {
    return fallback;
  }
}

function writeState(state: PersistState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function schemeListFromState(state: PersistState): Scheme[] {
  return seedSchemes.map((scheme) => ({ ...scheme, status: state.schemeStatuses[scheme.id] ?? scheme.status }));
}

/** 评分是否应退出排名：评委声明冲突，或存在待处理 / 复核成立的利益关系复核 */
function isScoreExcluded(score: ScoreRecord, reviewList: ReviewRecord[]): boolean {
  if (score.conflict) return true;
  return reviewList.some((review) => review.scoreId === score.id && (review.status === "待处理" || (review.status === "已复核" && review.result === "成立")));
}

function computeRanking(scoreList: ScoreRecord[], reviewList: ReviewRecord[], schemeList: Scheme[]): { ranked: RankingRow[]; insufficient: RankingRow[] } {
  const rows: RankingRow[] = schemeList.map((scheme) => {
    const submitted = scoreList.filter((score) => score.schemeId === scheme.id && score.submitted);
    const valid = submitted.filter((score) => !isScoreExcluded(score, reviewList));
    const total = valid.length
      ? valid.reduce((sum, row) => sum + criteria.reduce((value, criterion) => value + row.values[criterion.id] * criterion.weight / 100, 0), 0) / valid.length
      : 0;
    return { ...scheme, total: Number(total.toFixed(2)), judgeCount: valid.length, conflictCount: submitted.length - valid.length, insufficient: valid.length < 2 };
  });
  return { ranked: rows.filter((row) => !row.insufficient).sort((a, b) => b.total - a.total), insufficient: rows.filter((row) => row.insufficient) };
}

export const useReviewStore = defineStore("review", () => {
  const initial = readState();
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(schemeListFromState(initial));
  const scores = ref<ScoreRecord[]>(initial.scores);
  const events = ref<ReviewEventLike[]>(initial.events);
  const published = ref<boolean>(initial.published);
  const reviews = ref<ReviewRecord[]>(initial.reviews);
  const lockedRanking = ref<LockedRanking | null>(initial.lockedRanking);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  function syncFromState(state: PersistState) {
    scores.value = state.scores;
    events.value = state.events;
    published.value = state.published;
    reviews.value = state.reviews;
    lockedRanking.value = state.lockedRanking;
    schemes.value = schemeListFromState(state);
  }

  function persist(state: PersistState) {
    writeState(state);
    syncFromState(state);
  }

  function log(state: PersistState, action: string, detail: string) {
    state.events.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  /** 取当前评委在某方案上的评分；内存中不存在时返回一份未入库的空评分（不主动落库，避免覆盖他标签页已保存的版本） */
  function record(schemeId: string): ScoreRecord {
    const currentJudge = judge.value;
    const found = currentJudge ? scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId) : undefined;
    return found ?? emptyScore((currentJudge ?? "评委-林策") as Viewer, schemeId);
  }

  function touchSchemeStatus(state: PersistState, schemeId: string) {
    const current = state.schemeStatuses[schemeId] ?? seedSchemes.find((scheme) => scheme.id === schemeId)?.status ?? "待评分";
    if (current === "待评分") state.schemeStatuses[schemeId] = "评分中";
  }

  /** 评分一旦在复核期间被改动，旧复核失效，并按同一依据重新登记一份待处理复核（重新核对） */
  function invalidatePendingReviews(state: PersistState, scoreId: string, newVersion: number) {
    const pendings = state.reviews.filter((review) => review.scoreId === scoreId && review.status === "待处理");
    if (!pendings.length) return;
    for (const review of pendings) {
      review.status = "已失效";
      review.invalidatedAt = new Date().toISOString();
      state.reviews.push({
        ...review,
        id: crypto.randomUUID(),
        status: "待处理",
        result: undefined,
        registeredAt: new Date().toISOString(),
        registeredBy: viewer.value,
        reviewedAt: undefined,
        reviewedBy: undefined,
        invalidatedAt: undefined,
        scoreVersion: newVersion
      });
      const scheme = seedSchemes.find((item) => item.id === review.schemeId);
      log(state, "旧复核失效并重新核对", `${scheme?.code ?? review.schemeId}（${review.judge}）评分已更新至 v${newVersion}，原复核失效，已按原依据重新登记待处理`);
    }
  }

  interface SaveResult { status: "ok" | "conflict"; score?: ScoreRecord; latest?: ScoreRecord }

  function applySave(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, submitted: boolean, expectedVersion?: number): SaveResult {
    const currentJudge = judge.value;
    if (!currentJudge) return { status: "ok" };
    const state = readState();
    let score = state.scores.find((item) => item.judge === currentJudge && item.schemeId === schemeId);
    const scheme = seedSchemes.find((item) => item.id === schemeId);
    const now = new Date().toISOString();

    if (score) {
      // 乐观并发：后保存者若发现评分已被其他标签页更新，则不覆盖，返回最新版本
      if (expectedVersion !== undefined && score.version !== expectedVersion) {
        syncFromState(state);
        return { status: "conflict", latest: score };
      }
      score.values = { ...values };
      score.comment = comment;
      score.conflict = conflict;
      if (submitted) score.submitted = true;
      score.version += 1;
      score.updatedAt = now;
      score.revisions.push({ version: score.version, values: { ...values }, comment, conflict, updatedAt: now, actor: currentJudge });
      invalidatePendingReviews(state, score.id, score.version);
    } else {
      score = emptyScore(currentJudge, schemeId);
      score.values = { ...values };
      score.comment = comment;
      score.conflict = conflict;
      score.submitted = submitted;
      score.updatedAt = now;
      score.revisions = [{ version: 1, values: { ...values }, comment, conflict, updatedAt: now, actor: currentJudge }];
      state.scores.push(score);
    }

    touchSchemeStatus(state, schemeId);
    if (submitted) {
      const allIn = judges.every((name) => state.scores.some((item) => item.judge === name && item.schemeId === schemeId && item.submitted));
      state.schemeStatuses[schemeId] = allIn ? "已提交" : "评分中";
    }
    log(state, submitted ? "提交评分" : "保存评分草稿", `${scheme?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}`);
    persist(state);
    return { status: "ok", score };
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, expectedVersion?: number): SaveResult {
    const item = record(schemeId);
    if (item.submitted || published.value) return { status: "ok" };
    return applySave(schemeId, values, comment, conflict, false, expectedVersion);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, expectedVersion?: number): SaveResult {
    const item = record(schemeId);
    if (published.value) return { status: "ok" };
    return applySave(schemeId, values, comment, conflict, true, expectedVersion);
  }

  function recalled(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge || published.value) return;
    const state = readState();
    const score = state.scores.find((item) => item.judge === currentJudge && item.schemeId === schemeId);
    if (!score || !score.submitted) return;
    score.submitted = false;
    score.version += 1;
    score.updatedAt = new Date().toISOString();
    invalidatePendingReviews(state, score.id, score.version);
    log(state, "退回评分修改", seedSchemes.find((item) => item.id === schemeId)?.code ?? schemeId);
    persist(state);
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  const ranking = computed(() => {
    if (!published.value) return { ranked: [] as RankingRow[], insufficient: [] as RankingRow[] };
    if (lockedRanking.value) return lockedRanking.value;
    return computeRanking(scores.value, reviews.value, schemes.value);
  });

  /** 登记利益关系依据：锁定前为「待处理」（对应评分暂停排名）；锁定后只生成「待更正」，不触动已锁定排名 */
  function registerReview(schemeId: string, reviewJudge: Viewer, basis: string) {
    const state = readState();
    const scoreId = `${reviewJudge}-${schemeId}`;
    const score = state.scores.find((item) => item.id === scoreId);
    const now = new Date().toISOString();
    const review: ReviewRecord = {
      id: crypto.randomUUID(),
      schemeId,
      scoreId,
      judge: reviewJudge,
      basis: basis.trim(),
      status: state.published ? "待更正" : "待处理",
      registeredAt: now,
      registeredBy: viewer.value,
      scoreVersion: score?.version ?? 1
    };
    state.reviews.unshift(review);
    const scheme = seedSchemes.find((item) => item.id === schemeId);
    log(state, "登记利益关系依据", `${scheme?.code ?? schemeId}（${reviewJudge}）：${review.basis.slice(0, 24)}${state.published ? "，锁定后登记，列为待更正" : "，评分暂停排名"}`);
    persist(state);
  }

  /** 复核待处理依据：成立则评分继续退出排名；不成立则恢复排名 */
  function resolveReview(reviewId: string, result: ReviewResult) {
    const state = readState();
    const review = state.reviews.find((item) => item.id === reviewId);
    if (!review || review.status !== "待处理") return;
    review.status = "已复核";
    review.result = result;
    review.reviewedAt = new Date().toISOString();
    review.reviewedBy = viewer.value;
    const scheme = seedSchemes.find((item) => item.id === review.schemeId);
    log(state, result === "成立" ? "复核确认利益冲突" : "复核恢复评分", `${scheme?.code ?? review.schemeId}（${review.judge}）${result === "成立" ? "，评分退出排名" : "，评分恢复排名"}`);
    persist(state);
  }

  /** 取某评分最近一次复核记录（供评委端提示） */
  function reviewForScore(scoreId: string): ReviewRecord | undefined {
    return reviews.value.find((review) => review.scoreId === scoreId);
  }

  function publish() {
    const state = readState();
    if (!judges.every((name) => state.scores.some((score) => score.judge === name && score.schemeId && score.submitted))) return;
    state.published = true;
    seedSchemes.forEach((scheme) => { state.schemeStatuses[scheme.id] = "已锁定"; });
    state.lockedRanking = { ...computeRanking(state.scores, state.reviews, schemeListFromState(state)), lockedAt: new Date().toISOString() };
    log(state, "锁定并发布结果", `${seedSchemes.length} 个匿名方案`);
    persist(state);
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  return {
    viewer, schemes, criteria, judges, scores, events, published, reviews, lockedRanking, ranking, visibleScores,
    isOrganizer, judge, setViewer, record, saveDraft, submit, recalled, publish, allSubmittedFor,
    registerReview, resolveReview, reviewForScore, isScoreExcluded: (score: ScoreRecord) => isScoreExcluded(score, reviews.value)
  };
});
