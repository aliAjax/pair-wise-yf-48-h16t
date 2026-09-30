export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";

export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
  status: SchemeStatus;
}

export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  max: number;
}

export interface ScoreRevision {
  id: string;
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  updatedAt: string;
  /** 单调递增的评分版本，每次保存 / 提交 / 退回都会 +1，用于乐观并发与复核失效判断 */
  version: number;
  /** 本次修改来源的标签页标识 */
  source: string;
}

export interface ScoreRecord extends ScoreRevision {
  /** 历史版本（不含当前版本），并发保存时两个标签页的修订都会留存 */
  revisions: ScoreRevision[];
}

export type ReviewStatus = "待处理" | "已复核" | "待更正";
/** 待重新核对是派生状态：已复核绑定的评分版本发生变化即失效 */
export type ReviewState = ReviewStatus | "待重新核对";

export interface ScoreReview {
  id: string;
  judge: Viewer;
  schemeId: string;
  /** 登记依据，例如评分提交后才收到的利益关系说明 */
  basis: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  /** 复核通过时对应的评分版本，与当前评分版本不一致则复核失效 */
  reviewedVersion: number | null;
  reviewNote: string;
}

export interface ExcludedScore {
  judge: Viewer;
  reason: string;
  basis?: string;
}

export interface RankedRow {
  schemeId: string;
  code: string;
  title: string;
  total: number;
  judgeCount: number;
  conflictCount: number;
  excluded: ExcludedScore[];
}

export interface LockedSnapshot {
  lockedAt: string;
  ranked: RankedRow[];
  insufficient: RankedRow[];
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}
