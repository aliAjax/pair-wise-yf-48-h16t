<script setup lang="ts">
import { computed, ref } from "vue";
import { NAlert, NButton, NCard, NEmpty, NInput, NSelect, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
import type { ReviewRecord, ReviewResult, Viewer } from "../types";

const store = useReviewStore();
const message = useMessage();

const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "利益冲突", key: "conflictCount" },
  { title: "加权总分", key: "total" }
];

const insufficientColumns = [
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "利益冲突", key: "conflictCount" },
  { title: "加权总分", key: "total" },
  { title: "状态", key: "insufficient" }
];

// 登记利益关系依据
const form = ref<{ schemeId: string; judge: Viewer | null; basis: string }>({ schemeId: "a", judge: null, basis: "" });
const schemeOptions = computed(() => store.schemes.map((scheme) => ({ label: `${scheme.code} ${scheme.title}`, value: scheme.id })));
const judgeOptions = computed(() => store.judges.map((judge) => ({ label: judge, value: judge })));

function register() {
  if (!form.value.judge) { message.warning("请选择涉及评委"); return; }
  if (!form.value.basis.trim()) { message.warning("请填写利益关系依据"); return; }
  store.registerReview(form.value.schemeId, form.value.judge, form.value.basis);
  message.success(store.published ? "已登记为待更正记录" : "已登记依据，对应评分暂停排名");
  form.value.basis = "";
}

function resolve(review: ReviewRecord, result: ReviewResult) {
  store.resolveReview(review.id, result);
  message.success(result === "成立" ? "已确认利益冲突，评分退出排名" : "已恢复评分排名");
}

function statusType(status: ReviewRecord["status"]): "warning" | "success" | "error" | "info" {
  if (status === "待处理") return "warning";
  if (status === "已复核") return "success";
  if (status === "已失效") return "error";
  return "info";
}

function reviewDetail(review: ReviewRecord): string {
  const scheme = store.schemes.find((item) => item.id === review.schemeId);
  return `${scheme?.code ?? review.schemeId} · ${review.judge}`;
}

function publish() {
  const complete = store.schemes.every((scheme) => store.allSubmittedFor(scheme.id));
  if (!complete) { message.warning("仍有评委未提交，不能锁定结果"); return; }
  store.publish();
  message.success("评分结果已锁定发布");
}
</script>

<template>
  <NAlert v-if="!store.published" type="warning" show-icon>结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度；登记利益关系依据后，对应评分将暂停排名。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度"><article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row"><div><b>{{ scheme.code }} {{ scheme.title }}</b><small>{{ store.judges.filter((judge) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judge && score.submitted)).length }} / {{ store.judges.length }} 已提交</small></div><NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}</NTag></article></NCard>
    <NCard title="评分纪律"><div class="discipline"><p>评委只能查看自己的评分，主办方在锁定前无法读取分值。</p><p>收到利益关系说明后可登记依据：待处理期间对应评分退出排名，复核后再恢复。</p><p>有效评委不足两人的方案单列「样本不足」，不参与排名。</p><p>锁定后新登记只生成待更正记录，原排名与锁定版本继续保留。</p></div><NButton type="primary" block :disabled="store.published" @click="publish">锁定并发布结果</NButton></NCard>
  </div>

  <NCard title="利益关系复核" class="review-card">
    <div class="review-form">
      <NSelect v-model:value="form.schemeId" :options="schemeOptions" />
      <NSelect v-model:value="form.judge" :options="judgeOptions" placeholder="涉及评委" />
      <NInput v-model:value="form.basis" type="textarea" placeholder="利益关系依据，如：评委与该方案作者存在师生关系（评分提交后才收到说明）" />
      <NButton type="primary" @click="register">登记依据</NButton>
    </div>
    <div v-if="!store.reviews.length" class="review-empty">暂无复核记录</div>
    <div v-else class="review-list">
      <article v-for="review in store.reviews" :key="review.id" class="review-row">
        <div class="review-head">
          <b>{{ reviewDetail(review) }}</b>
          <NTag :type="statusType(review.status)" size="small">{{ review.status }}<template v-if="review.status === '已复核'"> · {{ review.result }}</template></NTag>
        </div>
        <p class="review-basis">{{ review.basis }}</p>
        <div class="review-meta">
          <small>登记：{{ review.registeredBy }} · {{ new Date(review.registeredAt).toLocaleString() }}</small>
          <small v-if="review.reviewedAt">复核：{{ review.reviewedBy }} · {{ new Date(review.reviewedAt).toLocaleString() }}</small>
          <small v-if="review.invalidatedAt" class="invalid">已于 {{ new Date(review.invalidatedAt).toLocaleString() }} 失效，等待重新核对</small>
        </div>
        <div v-if="review.status === '待处理'" class="review-actions">
          <NButton size="small" type="error" @click="resolve(review, '成立')">确认冲突（退出排名）</NButton>
          <NButton size="small" @click="resolve(review, '不成立')">恢复评分</NButton>
        </div>
      </article>
    </div>
  </NCard>

  <NCard title="最终排名" class="ranking">
    <NEmpty v-if="!store.published" description="锁定后查看最终排名" />
    <template v-else>
      <NTable :columns="columns" :data="store.ranking.ranked.map((item, index) => ({ ...item, rank: index + 1 }))" :bordered="false" />
      <NAlert v-if="store.ranking.insufficient.length" type="warning" show-icon class="insufficient">以下方案有效评委不足 {{ 2 }} 人，单列样本不足，不参与排名：</NAlert>
      <NTable v-if="store.ranking.insufficient.length" :columns="insufficientColumns" :data="store.ranking.insufficient.map((item) => ({ ...item, insufficient: '样本不足' }))" :bordered="false" />
    </template>
  </NCard>
</template>

<style scoped>
.review-card { margin-bottom: 18px; }
.review-form { display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 10px; margin-bottom: 16px; }
.review-empty { color: #8f96a8; padding: 8px 0; }
.review-list { display: grid; gap: 10px; }
.review-row { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.review-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.review-basis { margin: 8px 0; color: #596171; }
.review-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #8f96a8; }
.review-meta .invalid { color: #c23030; }
.review-actions { display: flex; gap: 8px; margin-top: 10px; }
.insufficient { margin: 14px 0 10px; }
@media (max-width: 980px) { .review-form { grid-template-columns: 1fr; } }
</style>
