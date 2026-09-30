<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  NAlert, NButton, NCard, NEmpty, NInput, NModal, NTable, NTag, useMessage
} from "naive-ui";
import { useReviewStore } from "../stores/review";
import type { RankedRow, ReviewState, Viewer } from "../types";
import { formatTime } from "../utils/time";

const store = useReviewStore();
const message = useMessage();

const rankColumns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "退出排名", key: "excludedCount" },
  { title: "加权总分", key: "total" }
];
const sampleColumns = [
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "退出排名", key: "excludedCount" },
  { title: "说明", key: "note" }
];
const correctionColumns = [
  { title: "登记时间", key: "created" },
  { title: "评委", key: "judge" },
  { title: "方案", key: "code" },
  { title: "依据", key: "basis" }
];
const eventColumns = [
  { title: "时间", key: "time", width: 150 },
  { title: "操作人", key: "actor", width: 110 },
  { title: "动作", key: "action", width: 150 },
  { title: "详情", key: "detail" }
];

function withCounts(rows: RankedRow[]) {
  return rows.map((row) => ({ ...row, excludedCount: `${row.excluded.length} 条`, note: `仅 ${row.judgeCount} 名有效评委，不足两人，样本不足` }));
}
const lockedRows = computed(() => withCounts(store.ranking).map((row, index) => ({ ...row, rank: index + 1 })));
const lockedInsufficient = computed(() => withCounts(store.insufficientRanking));
const correctionRows = computed(() => store.correctionReviews.map((entry) => ({
  id: entry.id,
  created: formatTime(entry.createdAt),
  judge: entry.judge,
  code: `${store.schemes.find((scheme) => scheme.id === entry.schemeId)?.code ?? entry.schemeId}`,
  basis: entry.basis
})));
const eventRows = computed(() => store.events.slice(0, 12).map((event) => ({ ...event, time: formatTime(event.time) })));

// ---------- 复核工作台（锁定前） ----------

type RowState = ReviewState | "正常" | "未提交";

interface ReviewRow {
  id: string;
  judge: Viewer;
  schemeId: string;
  code: string;
  state: RowState;
  basis: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedVersion: number | null;
  note: string;
  scoreVersion: number;
}

/** 每个方案下评委已提交的评分及其最新复核状态 */
const reviewGroups = computed(() =>
  store.schemes.map((scheme) => {
    const rows: ReviewRow[] = store.judges.map((judgeName) => {
      const score = store.scores.find((item) => item.judge === judgeName && item.schemeId === scheme.id);
      const entry = store.reviewFor(judgeName, scheme.id);
      const state: RowState = !score?.submitted
        ? "未提交"
        : (store.reviewStateOf(entry) ?? (score.conflict ? "正常" : "正常"));
      return {
        id: entry?.id ?? `${judgeName}-${scheme.id}`,
        judge: judgeName,
        schemeId: scheme.id,
        code: scheme.code,
        state,
        basis: entry?.basis ?? "",
        createdAt: entry ? formatTime(entry.createdAt) : "",
        reviewedAt: entry?.reviewedAt ? formatTime(entry.reviewedAt) : null,
        reviewedVersion: entry?.reviewedVersion ?? null,
        note: entry?.reviewNote ?? "",
        scoreVersion: score?.version ?? 0
      };
    });
    const live = store.liveSplit.ranked.find((row) => row.schemeId === scheme.id)
      ?? store.liveSplit.insufficient.find((row) => row.schemeId === scheme.id);
    return {
      scheme,
      rows,
      live,
      insufficient: (live?.judgeCount ?? 0) < 2
    };
  })
);

const tagType: Record<RowState, "warning" | "success" | "error" | "info" | "default"> = {
  待处理: "warning", 待重新核对: "error", 已复核: "success", 待更正: "info", 正常: "success", 未提交: "default"
};

// ---------- 登记依据弹窗 ----------

const modal = reactive({ show: false, judge: "" as Viewer | "", schemeId: "", code: "" });
const basis = ref("");
const finishModal = reactive({ show: false, reviewId: "" });
const finishNote = ref("复核通过，利益关系说明与评分内容核对一致。");

function openRegister(judge: Viewer, schemeId: string, code: string) {
  modal.judge = judge;
  modal.schemeId = schemeId;
  modal.code = code;
  basis.value = "";
  modal.show = true;
}
function confirmRegister() {
  if (basis.value.trim().length < 4) {
    message.warning("请填写利益关系说明等登记依据（至少 4 个字）");
    return;
  }
  const ok = store.registerReview(modal.judge as Viewer, modal.schemeId, basis.value);
  if (!ok) { message.warning("该评分尚未提交，或已有待处理复核"); return; }
  modal.show = false;
  message.success(store.published ? "已登记为待更正记录，锁定排名保持不变" : "依据已登记，对应评分在复核完成前退出排名");
}
function openFinish(row: ReviewRow) {
  finishModal.reviewId = row.id;
  finishNote.value = "复核通过，利益关系说明与评分内容核对一致。";
  finishModal.show = true;
}
function confirmFinish() {
  store.completeReview(finishModal.reviewId, finishNote.value || "复核通过");
  finishModal.show = false;
  message.success("复核完成，评分恢复进入排名口径");
}

function publish() {
  const complete = store.schemes.every((scheme) => store.allSubmittedFor(scheme.id));
  if (!complete) { message.warning("仍有评委未提交，不能锁定结果"); return; }
  store.publish();
  message.success("评分结果已锁定发布，排名版本已固化");
}
</script>

<template>
  <NAlert v-if="!store.published" type="warning" show-icon>
    结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度与复核进展，看不到分值。
  </NAlert>
  <NAlert v-else type="success" show-icon class="state-alert">
    结果已于{{ formatTime(store.snapshot?.lockedAt) }}锁定，以下为锁定版本排名；锁定后新登记的依据只进入“待更正”清单，不改变本版本。
  </NAlert>

  <div class="result-grid">
    <NCard title="提交进度">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div><b>{{ scheme.code }} {{ scheme.title }}</b><small>{{ store.judges.filter((judgeName) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judgeName && score.submitted)).length }} / {{ store.judges.length }} 已提交</small></div>
        <NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}</NTag>
      </article>
    </NCard>
    <NCard title="评分纪律">
      <div class="discipline">
        <p>评委只能查看自己的评分，主办方在锁定前无法读取分值。</p>
        <p>登记利益关系依据后，对应评分在待处理期间退出排名；复核通过绑定评分版本后恢复。</p>
        <p>有效评委不足两人的方案单列为样本不足，不参与排名；复核期间评分被改动，旧复核自动失效需重新核对。</p>
        <p>锁定后新登记只生成待更正记录，原排名与锁定版本继续保留。</p>
      </div>
      <NButton type="primary" block :disabled="store.published" @click="publish">锁定并发布结果</NButton>
    </NCard>
  </div>

  <NCard v-if="store.isOrganizer && !store.published" title="评分复核工作台" class="ranking">
    <template #header-extra><NTag type="warning">锁定前：实时反映退出 / 恢复</NTag></template>
    <div class="review-scheme" v-for="group in reviewGroups" :key="group.scheme.id">
      <div class="review-head">
        <b>{{ group.scheme.code }} {{ group.scheme.title }}</b>
        <NTag :type="group.insufficient ? 'error' : 'success'">
          有效评委 {{ group.live?.judgeCount ?? 0 }} 人{{ group.insufficient ? " · 样本不足（不足 2 人）" : "" }}
        </NTag>
      </div>
      <div class="review-row" v-for="row in group.rows" :key="row.id">
        <div class="review-meta">
          <b>{{ row.judge }}</b>
          <NTag size="small" :type="tagType[row.state]">{{ row.state }}</NTag>
          <small v-if="row.state === '已复核'">复核于 {{ row.reviewedAt }}（评分 v{{ row.reviewedVersion }}）</small>
          <small v-else-if="row.state === '待重新核对'">原复核绑定 v{{ row.reviewedVersion }}，当前评分 v{{ row.scoreVersion }}</small>
          <small v-else-if="row.state === '待处理'">登记于 {{ row.createdAt }}，评分退出排名中</small>
          <small v-if="row.basis && (row.state === '待处理' || row.state === '待重新核对')">依据：{{ row.basis }}</small>
        </div>
        <div class="review-actions">
          <NButton size="small"
            :disabled="row.state === '未提交' || row.state === '待处理' || row.state === '待重新核对'"
            @click="openRegister(row.judge, row.schemeId, row.code)">
            {{ row.state === "已复核" ? "再次登记依据" : "登记依据" }}
          </NButton>
          <NButton size="small" type="primary"
            v-if="row.state === '待处理' || row.state === '待重新核对'"
            @click="openFinish(row)">{{ row.state === "待重新核对" ? "重新核对并恢复" : "复核通过并恢复" }}</NButton>
        </div>
      </div>
    </div>
  </NCard>

  <NCard title="最终排名（锁定版本）" class="ranking">
    <NEmpty v-if="!store.published" description="锁定后查看最终排名" />
    <template v-else>
      <h4>正式排名</h4>
      <NTable :columns="rankColumns" :data="lockedRows" :bordered="false" />
      <h4 v-if="lockedInsufficient.length" class="sample-title">样本不足（有效评委不足两人，不参与排名）</h4>
      <NTable v-if="lockedInsufficient.length" :columns="sampleColumns" :data="lockedInsufficient" :bordered="false" />
      <p class="lock-note">退出排名评分：{{ store.ranking.reduce((n, row) => n + row.excluded.length, 0) + store.insufficientRanking.reduce((n, row) => n + row.excluded.length, 0) }} 条；其中复核未完成的依据已在锁定瞬间固化，复核通过不追溯改变本版本。</p>
    </template>
  </NCard>

  <NCard v-if="store.published" title="锁定后待更正清单" class="ranking">
    <NEmpty v-if="!correctionRows.length" description="暂无锁定后新登记的利益关系依据" />
    <NTable v-else :columns="correctionColumns" :data="correctionRows" :bordered="false" />
  </NCard>

  <NCard title="操作记录" class="ranking">
    <NEmpty v-if="!eventRows.length" description="暂无操作记录" />
    <NTable v-else :columns="eventColumns" :data="eventRows" :bordered="false" />
  </NCard>

  <NModal v-model:show="modal.show" preset="card" title="登记复核依据" style="max-width: 520px">
    <p class="modal-line">{{ modal.judge }} · {{ modal.code }}</p>
    <p class="modal-hint">登记后该评分在复核完成前退出排名{{ store.published ? "；当前结果已锁定，本次仅生成待更正记录，不改变锁定排名" : "；有效评委不足两人时方案将单列为样本不足" }}。</p>
    <NInput v-model:value="basis" type="textarea" placeholder="请填写评分提交后收到的利益关系说明，例如：评委与某设计单位存在合作关系……" />
    <template #footer>
      <div class="modal-footer"><NButton @click="modal.show = false">取消</NButton><NButton type="primary" @click="confirmRegister">确认登记</NButton></div>
    </template>
  </NModal>

  <NModal v-model:show="finishModal.show" preset="card" title="复核确认" style="max-width: 520px">
    <NAlert type="info" show-icon class="state-alert">复核通过将绑定当前评分版本并恢复进入排名；此后该评分再被改动，复核会自动失效。</NAlert>
    <NInput v-model:value="finishNote" type="textarea" class="state-alert" />
    <template #footer>
      <div class="modal-footer"><NButton @click="finishModal.show = false">取消</NButton><NButton type="primary" @click="confirmFinish">确认复核通过</NButton></div>
    </template>
  </NModal>
</template>
