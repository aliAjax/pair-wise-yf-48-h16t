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
  version: number;
  values: Record<string, number>;
  comment: string;
  conflict: boolean;
  updatedAt: string;
  actor: Viewer;
}

export interface ScoreRecord {
  id: string;
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  updatedAt: string;
  version: number;
  revisions: ScoreRevision[];
}

/** 利益关系复核状态：待处理（暂停排名）/ 已复核（出结论）/ 已失效（评分改动，需重新核对）/ 待更正（锁定后登记，不影响锁定版本） */
export type ReviewStatus = "待处理" | "已复核" | "已失效" | "待更正";
export type ReviewResult = "成立" | "不成立";

export interface ReviewRecord {
  id: string;
  schemeId: string;
  scoreId: string;
  judge: Viewer;
  basis: string;
  status: ReviewStatus;
  result?: ReviewResult;
  registeredAt: string;
  registeredBy: Viewer;
  reviewedAt?: string;
  reviewedBy?: Viewer;
  invalidatedAt?: string;
  /** 登记依据时所对应的评分版本；评分一旦改动，旧复核据此失效 */
  scoreVersion: number;
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}

export interface RankingRow extends Scheme {
  total: number;
  judgeCount: number;
  conflictCount: number;
  insufficient: boolean;
}

export interface LockedRanking {
  ranked: RankingRow[];
  insufficient: RankingRow[];
  lockedAt: string;
}
